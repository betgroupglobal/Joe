import { test, expect, chromium } from '@playwright/test';
import * as path from 'path';

const { STEALTH_LAUNCH_ARGS, getStealthContextOptions, injectDeepStealth } = require('../../stealth-utils');

/**
 * Integration tests: Verify scanner logic can detect login form elements
 * on a local HTML fixture (no network required).
 */

const LOGIN_FIXTURE = `data:text/html,
<!DOCTYPE html>
<html>
<head><title>Test Login Page</title></head>
<body>
  <div role="alert">Login &amp; Account Information | Joe Fortune Casino</div>
  <form id="loginForm">
    <input id="username" name="username" type="email" placeholder="Email" />
    <input id="password" name="password" type="password" placeholder="Password" />
    <button id="loginSubmit" type="submit">LOGIN</button>
  </form>
</body>
</html>`;

const LOGIN_FIXTURE_WRONG_CREDS = `data:text/html,
<!DOCTYPE html>
<html>
<body>
  <div role="alert">Login Page</div>
  <div class="ol-alert">Invalid username or password</div>
  <form>
    <input id="username" name="username" type="email" />
    <input id="password" name="password" type="password" />
    <button id="loginSubmit" type="submit">LOGIN</button>
  </form>
</body>
</html>`;

const LOGIN_FIXTURE_LOCKED = `data:text/html,
<!DOCTYPE html>
<html>
<body>
  <p>Your account has been temporarily disabled due to too many failed login attempts.</p>
  <form>
    <input id="username" name="username" type="email" />
    <input id="password" name="password" type="password" />
    <button id="loginSubmit" type="submit">LOGIN</button>
  </form>
</body>
</html>`;

test.describe('Scanner — Form Element Detection on Local Fixture', () => {

  test('detects username field by id', async () => {
    const browser = await chromium.launch({ headless: true, args: STEALTH_LAUNCH_ARGS });
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(LOGIN_FIXTURE);

    const usernameField = await page.$('#username');
    expect(usernameField).toBeTruthy();

    const type = await usernameField!.getAttribute('type');
    expect(type).toBe('email');
    await browser.close();
  });

  test('detects password field by id', async () => {
    const browser = await chromium.launch({ headless: true, args: STEALTH_LAUNCH_ARGS });
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(LOGIN_FIXTURE);

    const passwordField = await page.$('#password');
    expect(passwordField).toBeTruthy();

    const type = await passwordField!.getAttribute('type');
    expect(type).toBe('password');
    await browser.close();
  });

  test('detects submit button by id', async () => {
    const browser = await chromium.launch({ headless: true, args: STEALTH_LAUNCH_ARGS });
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(LOGIN_FIXTURE);

    const submitBtn = await page.$('#loginSubmit');
    expect(submitBtn).toBeTruthy();

    const text = await submitBtn!.innerText();
    expect(text).toBe('LOGIN');
    await browser.close();
  });

  test('scanner $$eval finds all form elements with correct roles', async () => {
    const browser = await chromium.launch({ headless: true, args: STEALTH_LAUNCH_ARGS });
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(LOGIN_FIXTURE);

    const selectors = await page.$$eval(
      'input, button, [role="button"], .login, .auth, [class*="login"], [id*="login"]',
      (els) => {
        const findings: any[] = [];
        els.forEach((el: Element) => {
          const id = (el as HTMLElement).id || '';
          const name = (el as HTMLInputElement).name || '';
          const type = (el as HTMLInputElement).type?.toLowerCase() || '';
          const placeholder = (el as HTMLInputElement).getAttribute('placeholder') || '';
          const text = (el as HTMLElement).innerText?.toLowerCase() || '';
          const combined = [id, name, type, placeholder, text].join(' ').toLowerCase();

          let role: string | null = null;
          if (type === 'password' || combined.includes('pass') || combined.includes('password')) role = 'password_field';
          else if (combined.includes('email') || combined.includes('user') || combined.includes('username') || combined.includes('mail')) role = 'username_field';
          else if (['submit', 'button'].includes(type) || combined.includes('submit') || combined.includes('sign') || combined.includes('login')) role = 'submit_button';

          if (role) {
            findings.push({ role, id, name, type });
          }
        });
        return findings;
      }
    );

    const usernameEl = selectors.find((s: any) => s.role === 'username_field');
    expect(usernameEl).toBeTruthy();
    expect(usernameEl.id).toBe('username');

    const passwordEl = selectors.find((s: any) => s.role === 'password_field');
    expect(passwordEl).toBeTruthy();
    expect(passwordEl.id).toBe('password');

    const submitEls = selectors.filter((s: any) => s.role === 'submit_button');
    expect(submitEls.length).toBeGreaterThan(0);
    const loginSubmit = submitEls.find((s: any) => s.id === 'loginSubmit');
    expect(loginSubmit).toBeTruthy();

    await browser.close();
  });

  test('email validation bypass works — type changed from email to text', async () => {
    const browser = await chromium.launch({ headless: true, args: STEALTH_LAUNCH_ARGS });
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(LOGIN_FIXTURE);

    // Verify initially email type
    const beforeType = await page.$eval('#username', (el: any) => el.type);
    expect(beforeType).toBe('email');

    // Apply the bypass
    await page.evaluate(() => {
      const el = document.querySelector('#username') as HTMLInputElement;
      if (el && el.type === 'email') el.type = 'text';
    });

    const afterType = await page.$eval('#username', (el: any) => el.type);
    expect(afterType).toBe('text');

    // Now a non-email value can be entered
    await page.fill('#username', '344578584');
    const val = await page.$eval('#username', (el: any) => el.value);
    expect(val).toBe('344578584');

    await browser.close();
  });
});

test.describe('Scanner — Visible Error Detection with ERROR_WORDS Filter', () => {
  const ERROR_WORDS = [
    'invalid', 'incorrect', 'wrong', 'error', 'fail', 'denied',
    'locked', 'disabled', 'blocked', 'expired', 'suspend',
    'limit', 'try again', 'unable', 'not found', 'not recognized',
    'does not exist', 'temporarily', 'captcha', 'verify'
  ];

  test('role=alert with page title text is NOT flagged as error', async () => {
    const browser = await chromium.launch({ headless: true, args: STEALTH_LAUNCH_ARGS });
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(LOGIN_FIXTURE);

    const alertText = await page.locator('[role="alert"]').first().innerText();
    const hasErrorWord = ERROR_WORDS.some(w => alertText.toLowerCase().includes(w));
    expect(hasErrorWord).toBe(false);
    await browser.close();
  });

  test('ol-alert with real error text IS flagged as error', async () => {
    const browser = await chromium.launch({ headless: true, args: STEALTH_LAUNCH_ARGS });
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(LOGIN_FIXTURE_WRONG_CREDS);

    const alertText = await page.locator('.ol-alert').first().innerText();
    const hasErrorWord = ERROR_WORDS.some(w => alertText.toLowerCase().includes(w));
    expect(hasErrorWord).toBe(true);
    await browser.close();
  });

  test('detects account lockout text in page body', async () => {
    const browser = await chromium.launch({ headless: true, args: STEALTH_LAUNCH_ARGS });
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(LOGIN_FIXTURE_LOCKED);

    const bodyText = await page.locator('body').innerText();
    const LOCKOUT_SIGNALS = [
      "too many attempts", "rate limit", "temporarily locked",
      "temporarily disabled", "account locked", "account has been",
      "try again later", "blocked", "suspended", "re-enable", "account disabled"
    ];
    const lockoutMatch = LOCKOUT_SIGNALS.find(s => bodyText.toLowerCase().includes(s));
    expect(lockoutMatch).toBeTruthy();
    await browser.close();
  });
});
