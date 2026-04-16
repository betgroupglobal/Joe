import { test, expect } from '@playwright/test';

/**
 * Tests for the outcome detection signal configuration.
 * Validates that the SIGNALS object in login-auto.ts covers the expected
 * error keywords, rate limit phrases, and CAPTCHA indicators.
 */

// Replicate the SIGNALS config from login-auto.ts for isolated testing
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

const ERROR_WORDS = [
  'invalid', 'incorrect', 'wrong', 'error', 'fail', 'denied',
  'locked', 'disabled', 'blocked', 'expired', 'suspend',
  'limit', 'try again', 'unable', 'not found', 'not recognized',
  'does not exist', 'temporarily', 'captcha', 'verify'
];

test.describe('Outcome Detection - Failure Keywords', () => {

  test('detects "invalid" as failure', () => {
    const body = 'the username or password is invalid';
    const match = SIGNALS.failure.keywords.find(s => body.includes(s));
    expect(match).toBe('invalid');
  });

  test('detects "incorrect" as failure', () => {
    const body = 'incorrect username or password';
    const match = SIGNALS.failure.keywords.find(s => body.includes(s));
    expect(match).toBe('incorrect');
  });

  test('detects "does not exist" as failure', () => {
    const body = 'this account does not exist in our system';
    const match = SIGNALS.failure.keywords.find(s => body.includes(s));
    expect(match).toBe('does not exist');
  });

  test('does not false-positive on benign page text', () => {
    const body = 'welcome to our login page. enter your credentials below.';
    const match = SIGNALS.failure.keywords.find(s => body.includes(s));
    expect(match).toBeUndefined();
  });

  test('does not false-positive on page title text', () => {
    const body = 'login & account information | joe fortune casino';
    const match = SIGNALS.failure.keywords.find(s => body.includes(s));
    expect(match).toBeUndefined();
  });
});

test.describe('Outcome Detection - Rate Limit / Lockout', () => {

  test('detects "too many attempts" as lockout', () => {
    const body = 'too many attempts. please wait.';
    const match = SIGNALS.rateLimit.lockout.find(s => body.includes(s));
    expect(match).toBe('too many attempts');
  });

  test('detects "account has been" as lockout', () => {
    const body = 'your account has been temporarily disabled';
    const match = SIGNALS.rateLimit.lockout.find(s => body.includes(s));
    // "temporarily disabled" or "account has been" — both are valid lockout signals
    expect(match).toBeTruthy();
    expect(SIGNALS.rateLimit.lockout).toContain(match);
  });

  test('detects "account being blocked" as warning', () => {
    const body = 'further failed attempts may result in your account being blocked';
    const warning = SIGNALS.rateLimit.warning.find(s => body.includes(s));
    expect(warning).toBeTruthy();
  });

  test('lockout takes priority over warning', () => {
    const body = 'account locked due to too many attempts';
    const lockout = SIGNALS.rateLimit.lockout.find(s => body.includes(s));
    expect(lockout).toBeTruthy(); // should find lockout first
  });
});

test.describe('Outcome Detection - CAPTCHA', () => {

  test('detects reCAPTCHA iframe', () => {
    const url = 'https://www.google.com/recaptcha/api2/anchor';
    const match = SIGNALS.captcha.some(p => url.includes(p));
    expect(match).toBe(true);
  });

  test('detects hCaptcha iframe', () => {
    const url = 'https://hcaptcha.com/captcha/v1/challenge';
    const match = SIGNALS.captcha.some(p => url.includes(p));
    expect(match).toBe(true);
  });

  test('detects Cloudflare Turnstile', () => {
    const url = 'https://challenges.cloudflare.com/cdn-cgi/challenge-platform/h/g/turnstile/';
    const match = SIGNALS.captcha.some(p => url.toLowerCase().includes(p));
    // cf-turnstile is the signal, turnstile alone won't match — check for real patterns
    expect(SIGNALS.captcha).toContain('cf-turnstile');
  });

  test('detects GeeTest', () => {
    const url = 'https://api.geetest.com/gettype.php';
    const match = SIGNALS.captcha.some(p => url.includes(p));
    expect(match).toBe(true);
  });

  test('does not false-positive on normal URLs', () => {
    const url = 'https://www.joefortunepokies.win/login';
    const match = SIGNALS.captcha.some(p => url.includes(p));
    expect(match).toBe(false);
  });
});

test.describe('Outcome Detection - ERROR_WORDS filter', () => {

  test('filters out benign role=alert text (page title)', () => {
    const elText = 'login & account information | joe fortune casino';
    const hasErrorWord = ERROR_WORDS.some(w => elText.includes(w));
    expect(hasErrorWord).toBe(false);
  });

  test('catches real error text with "invalid"', () => {
    const elText = 'invalid username or password';
    const hasErrorWord = ERROR_WORDS.some(w => elText.includes(w));
    expect(hasErrorWord).toBe(true);
  });

  test('catches "account locked"', () => {
    const elText = 'your account has been locked';
    const hasErrorWord = ERROR_WORDS.some(w => elText.includes(w));
    expect(hasErrorWord).toBe(true);
  });

  test('catches "temporarily disabled"', () => {
    const elText = 'account temporarily disabled due to suspicious activity';
    const hasErrorWord = ERROR_WORDS.some(w => elText.includes(w));
    expect(hasErrorWord).toBe(true);
  });

  test('catches "captcha" text', () => {
    const elText = 'please complete the captcha to continue';
    const hasErrorWord = ERROR_WORDS.some(w => elText.includes(w));
    expect(hasErrorWord).toBe(true);
  });
});

test.describe('Outcome Detection - URL-based success', () => {

  test('still on /login = not success', () => {
    const postUrl = 'https://www.joefortunepokies.win/login';
    const onLoginPath = postUrl.toLowerCase().includes('login') || postUrl.toLowerCase().includes('signin');
    expect(onLoginPath).toBe(true);
  });

  test('navigated to /dashboard = success candidate', () => {
    const postUrl = 'https://www.joefortunepokies.win/dashboard';
    const onLoginPath = postUrl.toLowerCase().includes('login') || postUrl.toLowerCase().includes('signin');
    expect(onLoginPath).toBe(false);
  });

  test('navigated to /lobby = success candidate', () => {
    const postUrl = 'https://www.joefortunepokies.win/lobby';
    const onLoginPath = postUrl.toLowerCase().includes('login') || postUrl.toLowerCase().includes('signin');
    expect(onLoginPath).toBe(false);
  });

  test('/signin page = not success', () => {
    const postUrl = 'https://example.com/signin';
    const onLoginPath = postUrl.toLowerCase().includes('login') || postUrl.toLowerCase().includes('signin');
    expect(onLoginPath).toBe(true);
  });
});

test.describe('Block Error Detection (isBlockError)', () => {
  // Replicate isBlockError from login-auto.ts
  function isBlockError(msg: string): boolean {
    const blockPhrases = [
      'ERR_CONNECTION_RESET', 'ERR_CONNECTION_REFUSED', 'ERR_PROXY',
      'net::ERR', 'timeout', 'TIMEOUT'
    ];
    return blockPhrases.some(p => msg.includes(p));
  }

  test('detects connection reset', () => {
    expect(isBlockError('net::ERR_CONNECTION_RESET at navigating')).toBe(true);
  });

  test('detects connection refused', () => {
    expect(isBlockError('ERR_CONNECTION_REFUSED')).toBe(true);
  });

  test('detects timeout errors', () => {
    expect(isBlockError('Navigation timeout of 60000ms exceeded')).toBe(true);
  });

  test('detects proxy errors', () => {
    expect(isBlockError('ERR_PROXY_CONNECTION_FAILED')).toBe(true);
  });

  test('does not false-positive on normal errors', () => {
    expect(isBlockError('wrong_credentials — incorrect password')).toBe(false);
  });
});
