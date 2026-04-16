import { test, expect, chromium } from '@playwright/test';

const { STEALTH_LAUNCH_ARGS, getStealthContextOptions, injectDeepStealth, simulateHuman } = require('../../stealth-utils');

/**
 * Live tests: Run against real anti-bot detection test sites to validate
 * that our stealth evasion actually works in the wild.
 *
 * These tests require network access but NOT a VPN.
 * They test against public bot-detection test pages.
 *
 * Run with: npx playwright test --project=live
 */

const TARGET_URL = process.env.TARGET_URL || 'https://www.joefortunepokies.win/login';

test.describe('Anti-Detection — Public Bot Test Sites', () => {

  test('passes basic bot detection on bot.sannysoft.com', async () => {
    const browser = await chromium.launch({ headless: true, args: STEALTH_LAUNCH_ARGS });
    const ctxOpts = getStealthContextOptions();
    const context = await browser.newContext(ctxOpts);
    const page = await context.newPage();
    await injectDeepStealth(page, 'bottest-' + Date.now(), {
      navPlatform: ctxOpts._navPlatform,
      uaDataPlatform: ctxOpts._uaDataPlatform,
      chromeVersion: ctxOpts._chromeVersion,
    });

    await page.goto('https://bot.sannysoft.com/', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(3000);

    // Check key detection tests
    const results = await page.evaluate(() => {
      const rows = document.querySelectorAll('table tr');
      const data: Record<string, string> = {};
      rows.forEach(row => {
        const cells = row.querySelectorAll('td');
        if (cells.length >= 2) {
          const key = cells[0].textContent?.trim() || '';
          const val = cells[1].textContent?.trim() || '';
          if (key) data[key] = val;
        }
      });
      return data;
    });

    // Critical checks — these MUST pass
    if (results['User Agent']) {
      expect(results['User Agent']).not.toContain('HeadlessChrome');
    }
    if (results['WebDriver']) {
      expect(results['WebDriver']).not.toMatch(/^true$/i);
    }

    await page.screenshot({ path: './test-results/bot-sannysoft.png', fullPage: true }).catch(() => {});
    await browser.close();
  });

  test('passes CreepJS basic checks on abrahamjuliot.github.io', async () => {
    const browser = await chromium.launch({ headless: true, args: STEALTH_LAUNCH_ARGS });
    const ctxOpts = getStealthContextOptions();
    const context = await browser.newContext(ctxOpts);
    const page = await context.newPage();
    await injectDeepStealth(page, 'creepjs-' + Date.now(), {
      navPlatform: ctxOpts._navPlatform,
      uaDataPlatform: ctxOpts._uaDataPlatform,
      chromeVersion: ctxOpts._chromeVersion,
    });

    await page.goto('https://abrahamjuliot.github.io/creepjs/', { waitUntil: 'domcontentloaded', timeout: 45000 });
    // CreepJS takes time to run all fingerprinting
    await page.waitForTimeout(10000);

    // Just verify page loaded and we weren't blocked
    const title = await page.title();
    expect(title).toContain('CreepJS');

    await page.screenshot({ path: './test-results/creepjs.png', fullPage: true }).catch(() => {});
    await browser.close();
  });

  test('navigator.webdriver is hidden on external page', async () => {
    const browser = await chromium.launch({ headless: true, args: STEALTH_LAUNCH_ARGS });
    const ctxOpts = getStealthContextOptions();
    const context = await browser.newContext(ctxOpts);
    const page = await context.newPage();
    await injectDeepStealth(page, 'wd-live-' + Date.now(), {
      navPlatform: ctxOpts._navPlatform,
      uaDataPlatform: ctxOpts._uaDataPlatform,
      chromeVersion: ctxOpts._chromeVersion,
    });

    await page.goto('https://httpbin.org/headers', { waitUntil: 'domcontentloaded', timeout: 30000 });

    const webdriver = await page.evaluate(() => navigator.webdriver);
    expect(webdriver).toBeUndefined();

    // Verify UA is being sent correctly in headers
    const bodyText = await page.locator('body').innerText();
    expect(bodyText).toContain('Chrome/');
    expect(bodyText).not.toContain('HeadlessChrome');

    await browser.close();
  });
});

test.describe('Anti-Detection — Target Site Reachability', () => {

  test('target site loads and shows login form', async () => {
    test.skip(!process.env.RUN_TARGET_TESTS, 'Set RUN_TARGET_TESTS=1 to run against the live target');

    const browser = await chromium.launch({ headless: true, args: STEALTH_LAUNCH_ARGS });
    const ctxOpts = getStealthContextOptions();
    const context = await browser.newContext(ctxOpts);
    const page = await context.newPage();
    await injectDeepStealth(page, 'target-reach-' + Date.now(), {
      navPlatform: ctxOpts._navPlatform,
      uaDataPlatform: ctxOpts._uaDataPlatform,
      chromeVersion: ctxOpts._chromeVersion,
    });
    await simulateHuman(page);

    await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(3000);

    // Try clicking Login nav button if needed
    const genericBtn = await page.$('a:has-text("Login"), button:has-text("Login"), a:has-text("Log In")');
    if (genericBtn && await genericBtn.isVisible()) {
      await genericBtn.click();
      await page.waitForTimeout(2000);
    }

    // Check for login form elements
    const hasUsername = await page.locator('#username, [name="username"], input[type="email"]').first().isVisible().catch(() => false);
    const hasPassword = await page.locator('#password, [name="password"], input[type="password"]').first().isVisible().catch(() => false);

    await page.screenshot({ path: './test-results/target-login-page.png', fullPage: true }).catch(() => {});

    expect(hasUsername).toBe(true);
    expect(hasPassword).toBe(true);

    await browser.close();
  });

  test('target site does not immediately block with CAPTCHA', async () => {
    test.skip(!process.env.RUN_TARGET_TESTS, 'Set RUN_TARGET_TESTS=1 to run against the live target');

    const browser = await chromium.launch({ headless: true, args: STEALTH_LAUNCH_ARGS });
    const ctxOpts = getStealthContextOptions();
    const context = await browser.newContext(ctxOpts);
    const page = await context.newPage();
    await injectDeepStealth(page, 'target-captcha-' + Date.now(), {
      navPlatform: ctxOpts._navPlatform,
      uaDataPlatform: ctxOpts._uaDataPlatform,
      chromeVersion: ctxOpts._chromeVersion,
    });
    await simulateHuman(page);

    await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(5000);

    // Check for CAPTCHA indicators
    const CAPTCHA_SIGNALS = ["recaptcha", "grecaptcha", "hcaptcha", "cf-turnstile", "arkoselabs", "geetest"];
    const html = (await page.content()).toLowerCase();
    const bodyText = (await page.locator('body').innerText().catch(() => '')).toLowerCase();

    // Check for visible CAPTCHA challenge text
    const hasCaptchaText = bodyText.includes('solve the captcha') || 
                           bodyText.includes('verify you are human') || 
                           bodyText.includes('complete the captcha');

    // Check for CAPTCHA iframes
    let hasCaptchaFrame = false;
    for (const frame of page.frames()) {
      const url = frame.url().toLowerCase();
      if (CAPTCHA_SIGNALS.some(p => url.includes(p))) {
        const fElement = await frame.frameElement().catch(() => null);
        if (fElement) {
          const box = await fElement.boundingBox().catch(() => null);
          if (box && box.width > 200 && box.height > 60) {
            hasCaptchaFrame = true;
            break;
          }
        }
      }
    }

    await page.screenshot({ path: './test-results/target-captcha-check.png', fullPage: true }).catch(() => {});

    // Neither text-based CAPTCHA nor visible iframe CAPTCHA should be present
    expect(hasCaptchaText).toBe(false);
    expect(hasCaptchaFrame).toBe(false);

    await browser.close();
  });

  test('target site does not detect Playwright automation markers', async () => {
    test.skip(!process.env.RUN_TARGET_TESTS, 'Set RUN_TARGET_TESTS=1 to run against the live target');

    const browser = await chromium.launch({ headless: true, args: STEALTH_LAUNCH_ARGS });
    const ctxOpts = getStealthContextOptions();
    const context = await browser.newContext(ctxOpts);
    const page = await context.newPage();
    await injectDeepStealth(page, 'target-markers-' + Date.now(), {
      navPlatform: ctxOpts._navPlatform,
      uaDataPlatform: ctxOpts._uaDataPlatform,
      chromeVersion: ctxOpts._chromeVersion,
    });

    await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(3000);

    // Verify our stealth measures are active on the target page
    const checks = await page.evaluate(() => ({
      webdriver: navigator.webdriver,
      platform: navigator.platform,
      languages: Array.from(navigator.languages),
      vendor: navigator.vendor,
      plugins: navigator.plugins.length,
      chrome: !!(window as any).chrome,
      chromeRuntime: !!(window as any).chrome?.runtime,
    }));

    expect(checks.webdriver).toBeUndefined();
    expect(checks.vendor).toBe('Google Inc.');
    expect(checks.languages).toContain('en-AU');
    expect(checks.plugins).toBeGreaterThan(0);
    expect(checks.chrome).toBe(true);
    expect(checks.chromeRuntime).toBe(true);

    await browser.close();
  });
});

test.describe('Anti-Detection — Fingerprint Uniqueness Across Sessions', () => {

  test('different sessions produce different canvas fingerprints', async () => {
    const browser = await chromium.launch({ headless: true, args: STEALTH_LAUNCH_ARGS });
    const fingerprints: string[] = [];

    for (let i = 0; i < 5; i++) {
      const ctxOpts = getStealthContextOptions();
      const context = await browser.newContext(ctxOpts);
      const page = await context.newPage();
      await injectDeepStealth(page, `fp-diversity-${i}-${Date.now()}`, {
        navPlatform: ctxOpts._navPlatform,
        uaDataPlatform: ctxOpts._uaDataPlatform,
        chromeVersion: ctxOpts._chromeVersion,
      });
      await page.goto('about:blank');

      const fp = await page.evaluate(() => {
        const canvas = document.createElement('canvas');
        canvas.width = 100;
        canvas.height = 30;
        const ctx = canvas.getContext('2d')!;
        ctx.font = '12px Arial';
        ctx.fillText('Unique?', 10, 20);
        return canvas.toDataURL().substring(0, 100);
      });
      fingerprints.push(fp);
      await context.close();
    }

    const unique = new Set(fingerprints);
    // At least 2 different fingerprints out of 5 sessions
    expect(unique.size).toBeGreaterThanOrEqual(2);
    await browser.close();
  });

  test('different sessions get different viewport/UA combinations', async () => {
    const combos = new Set<string>();

    for (let i = 0; i < 20; i++) {
      const opts = getStealthContextOptions();
      combos.add(`${opts.userAgent}|${opts.viewport.width}x${opts.viewport.height}`);
    }

    // Should have diversity in 20 attempts
    expect(combos.size).toBeGreaterThanOrEqual(3);
  });
});
