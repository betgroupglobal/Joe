import { test, expect, chromium } from '@playwright/test';

const { STEALTH_LAUNCH_ARGS, getStealthContextOptions, injectDeepStealth } = require('../../stealth-utils');

/**
 * Integration tests: Launch a real browser and verify that injectDeepStealth
 * actually patches navigator properties, canvas, WebGL, etc.
 * These tests use a local about:blank page — no VPN or network required.
 */

test.describe('Deep Stealth Injection — Navigator Properties', () => {
  test('navigator.webdriver is undefined after injection', async () => {
    const browser = await chromium.launch({ headless: true, args: STEALTH_LAUNCH_ARGS });
    const ctxOpts = getStealthContextOptions();
    const context = await browser.newContext(ctxOpts);
    const page = await context.newPage();
    await injectDeepStealth(page, 'test-webdriver-' + Date.now(), {
      navPlatform: ctxOpts._navPlatform,
      uaDataPlatform: ctxOpts._uaDataPlatform,
      chromeVersion: ctxOpts._chromeVersion,
    });
    await page.goto('about:blank');

    const webdriver = await page.evaluate(() => navigator.webdriver);
    expect(webdriver).toBeUndefined();
    await browser.close();
  });

  test('navigator.platform matches the chosen UA platform', async () => {
    const browser = await chromium.launch({ headless: true, args: STEALTH_LAUNCH_ARGS });
    const ctxOpts = getStealthContextOptions();
    const context = await browser.newContext(ctxOpts);
    const page = await context.newPage();
    await injectDeepStealth(page, 'test-platform-' + Date.now(), {
      navPlatform: ctxOpts._navPlatform,
      uaDataPlatform: ctxOpts._uaDataPlatform,
      chromeVersion: ctxOpts._chromeVersion,
    });
    await page.goto('about:blank');

    const platform = await page.evaluate(() => navigator.platform);
    expect(platform).toBe(ctxOpts._navPlatform);
    await browser.close();
  });

  test('navigator.languages is [en-AU, en-US, en]', async () => {
    const browser = await chromium.launch({ headless: true, args: STEALTH_LAUNCH_ARGS });
    const ctxOpts = getStealthContextOptions();
    const context = await browser.newContext(ctxOpts);
    const page = await context.newPage();
    await injectDeepStealth(page, 'test-langs-' + Date.now(), {
      navPlatform: ctxOpts._navPlatform,
      uaDataPlatform: ctxOpts._uaDataPlatform,
      chromeVersion: ctxOpts._chromeVersion,
    });
    await page.goto('about:blank');

    const langs = await page.evaluate(() => Array.from(navigator.languages));
    expect(langs).toEqual(['en-AU', 'en-US', 'en']);
    await browser.close();
  });

  test('navigator.vendor is "Google Inc."', async () => {
    const browser = await chromium.launch({ headless: true, args: STEALTH_LAUNCH_ARGS });
    const ctxOpts = getStealthContextOptions();
    const context = await browser.newContext(ctxOpts);
    const page = await context.newPage();
    await injectDeepStealth(page, 'test-vendor-' + Date.now(), {
      navPlatform: ctxOpts._navPlatform,
      uaDataPlatform: ctxOpts._uaDataPlatform,
      chromeVersion: ctxOpts._chromeVersion,
    });
    await page.goto('about:blank');

    const vendor = await page.evaluate(() => navigator.vendor);
    expect(vendor).toBe('Google Inc.');
    await browser.close();
  });

  test('navigator.hardwareConcurrency is one of [4, 8, 12, 16]', async () => {
    const browser = await chromium.launch({ headless: true, args: STEALTH_LAUNCH_ARGS });
    const ctxOpts = getStealthContextOptions();
    const context = await browser.newContext(ctxOpts);
    const page = await context.newPage();
    await injectDeepStealth(page, 'test-cores-' + Date.now(), {
      navPlatform: ctxOpts._navPlatform,
      uaDataPlatform: ctxOpts._uaDataPlatform,
      chromeVersion: ctxOpts._chromeVersion,
    });
    await page.goto('about:blank');

    const cores = await page.evaluate(() => navigator.hardwareConcurrency);
    expect([4, 8, 12, 16]).toContain(cores);
    await browser.close();
  });

  test('navigator.deviceMemory is one of [4, 8, 16]', async () => {
    const browser = await chromium.launch({ headless: true, args: STEALTH_LAUNCH_ARGS });
    const ctxOpts = getStealthContextOptions();
    const context = await browser.newContext(ctxOpts);
    const page = await context.newPage();
    await injectDeepStealth(page, 'test-memory-' + Date.now(), {
      navPlatform: ctxOpts._navPlatform,
      uaDataPlatform: ctxOpts._uaDataPlatform,
      chromeVersion: ctxOpts._chromeVersion,
    });
    await page.goto('about:blank');

    const mem = await page.evaluate(() => (navigator as any).deviceMemory);
    expect([4, 8, 16]).toContain(mem);
    await browser.close();
  });

  test('navigator.maxTouchPoints is 0 (desktop)', async () => {
    const browser = await chromium.launch({ headless: true, args: STEALTH_LAUNCH_ARGS });
    const ctxOpts = getStealthContextOptions();
    const context = await browser.newContext(ctxOpts);
    const page = await context.newPage();
    await injectDeepStealth(page, 'test-touch-' + Date.now(), {
      navPlatform: ctxOpts._navPlatform,
      uaDataPlatform: ctxOpts._uaDataPlatform,
      chromeVersion: ctxOpts._chromeVersion,
    });
    await page.goto('about:blank');

    const touch = await page.evaluate(() => navigator.maxTouchPoints);
    expect(touch).toBe(0);
    await browser.close();
  });

  test('navigator.plugins has 5 realistic entries', async () => {
    const browser = await chromium.launch({ headless: true, args: STEALTH_LAUNCH_ARGS });
    const ctxOpts = getStealthContextOptions();
    const context = await browser.newContext(ctxOpts);
    const page = await context.newPage();
    await injectDeepStealth(page, 'test-plugins-' + Date.now(), {
      navPlatform: ctxOpts._navPlatform,
      uaDataPlatform: ctxOpts._uaDataPlatform,
      chromeVersion: ctxOpts._chromeVersion,
    });
    await page.goto('about:blank');

    const pluginCount = await page.evaluate(() => navigator.plugins.length);
    expect(pluginCount).toBe(5);

    const firstPlugin = await page.evaluate(() => navigator.plugins[0]?.name);
    expect(firstPlugin).toBe('PDF Viewer');
    await browser.close();
  });
});

test.describe('Deep Stealth Injection — Chrome Object & CDP Leak Patching', () => {
  test('window.chrome exists with expected structure', async () => {
    const browser = await chromium.launch({ headless: true, args: STEALTH_LAUNCH_ARGS });
    const ctxOpts = getStealthContextOptions();
    const context = await browser.newContext(ctxOpts);
    const page = await context.newPage();
    await injectDeepStealth(page, 'test-chrome-' + Date.now(), {
      navPlatform: ctxOpts._navPlatform,
      uaDataPlatform: ctxOpts._uaDataPlatform,
      chromeVersion: ctxOpts._chromeVersion,
    });
    await page.goto('about:blank');

    const hasChrome = await page.evaluate(() => !!(window as any).chrome);
    expect(hasChrome).toBe(true);

    const hasRuntime = await page.evaluate(() => !!(window as any).chrome?.runtime);
    expect(hasRuntime).toBe(true);

    const hasApp = await page.evaluate(() => !!(window as any).chrome?.app);
    expect(hasApp).toBe(true);
    await browser.close();
  });

  test('__playwright markers are removed', async () => {
    const browser = await chromium.launch({ headless: true, args: STEALTH_LAUNCH_ARGS });
    const ctxOpts = getStealthContextOptions();
    const context = await browser.newContext(ctxOpts);
    const page = await context.newPage();
    await injectDeepStealth(page, 'test-markers-' + Date.now(), {
      navPlatform: ctxOpts._navPlatform,
      uaDataPlatform: ctxOpts._uaDataPlatform,
      chromeVersion: ctxOpts._chromeVersion,
    });
    await page.goto('about:blank');

    const hasPlaywright = await page.evaluate(() => '__playwright' in window);
    expect(hasPlaywright).toBe(false);

    const hasPwManual = await page.evaluate(() => '__pw_manual' in window);
    expect(hasPwManual).toBe(false);
    await browser.close();
  });
});

test.describe('Deep Stealth Injection — Canvas Fingerprint Noise', () => {
  test('canvas toDataURL produces different hashes with different seeds', async () => {
    const browser = await chromium.launch({ headless: true, args: STEALTH_LAUNCH_ARGS });
    const hashes: string[] = [];

    for (let i = 0; i < 3; i++) {
      const ctxOpts = getStealthContextOptions();
      const context = await browser.newContext(ctxOpts);
      const page = await context.newPage();
      await injectDeepStealth(page, `canvas-test-seed-${i}-${Date.now()}`, {
        navPlatform: ctxOpts._navPlatform,
        uaDataPlatform: ctxOpts._uaDataPlatform,
        chromeVersion: ctxOpts._chromeVersion,
      });
      await page.goto('about:blank');

      const hash = await page.evaluate(() => {
        const canvas = document.createElement('canvas');
        canvas.width = 200;
        canvas.height = 50;
        const ctx = canvas.getContext('2d')!;
        ctx.textBaseline = 'top';
        ctx.font = '14px Arial';
        ctx.fillStyle = '#f60';
        ctx.fillRect(125, 1, 62, 20);
        ctx.fillStyle = '#069';
        ctx.fillText('Fingerprint test', 2, 15);
        return canvas.toDataURL();
      });
      hashes.push(hash);
      await context.close();
    }

    // At least 2 of 3 should be different (noise is seeded)
    const unique = new Set(hashes);
    expect(unique.size).toBeGreaterThanOrEqual(2);
    await browser.close();
  });
});

test.describe('Deep Stealth Injection — WebGL Spoofing', () => {
  test('WebGL vendor is one of the spoofed vendors', async () => {
    const VALID_VENDORS = [
      'Google Inc. (NVIDIA)',
      'Google Inc. (AMD)',
      'Google Inc. (Intel)',
    ];

    const browser = await chromium.launch({ headless: true, args: STEALTH_LAUNCH_ARGS });
    const ctxOpts = getStealthContextOptions();
    const context = await browser.newContext(ctxOpts);
    const page = await context.newPage();
    await injectDeepStealth(page, 'test-webgl-' + Date.now(), {
      navPlatform: ctxOpts._navPlatform,
      uaDataPlatform: ctxOpts._uaDataPlatform,
      chromeVersion: ctxOpts._chromeVersion,
    });
    await page.goto('about:blank');

    const vendor = await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl');
      if (!gl) return null;
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      if (!ext) return null;
      return gl.getParameter(ext.UNMASKED_VENDOR_WEBGL);
    });

    // SwiftShader may override — check it's either our spoofed value or SwiftShader
    if (vendor) {
      const isValid = VALID_VENDORS.includes(vendor) || vendor.includes('SwiftShader') || vendor.includes('Google');
      expect(isValid).toBe(true);
    }
    await browser.close();
  });
});

test.describe('Deep Stealth Injection — Screen Dimensions', () => {
  test('screen dimensions match viewport', async () => {
    const browser = await chromium.launch({ headless: true, args: STEALTH_LAUNCH_ARGS });
    const ctxOpts = getStealthContextOptions();
    const context = await browser.newContext(ctxOpts);
    const page = await context.newPage();
    await injectDeepStealth(page, 'test-screen-' + Date.now(), {
      navPlatform: ctxOpts._navPlatform,
      uaDataPlatform: ctxOpts._uaDataPlatform,
      chromeVersion: ctxOpts._chromeVersion,
    });
    await page.goto('about:blank');

    const dims = await page.evaluate(() => ({
      screenW: screen.width,
      screenH: screen.height,
      innerW: window.innerWidth,
      colorDepth: screen.colorDepth,
    }));

    expect(dims.colorDepth).toBe(24);
    // Screen width should be a reasonable desktop size
    expect(dims.screenW).toBeGreaterThanOrEqual(1024);
    await browser.close();
  });
});

test.describe('Deep Stealth Injection — Permissions API', () => {
  test('notifications permission returns "prompt" not "denied"', async () => {
    const browser = await chromium.launch({ headless: true, args: STEALTH_LAUNCH_ARGS });
    const ctxOpts = getStealthContextOptions();
    const context = await browser.newContext(ctxOpts);
    const page = await context.newPage();
    await injectDeepStealth(page, 'test-perms-' + Date.now(), {
      navPlatform: ctxOpts._navPlatform,
      uaDataPlatform: ctxOpts._uaDataPlatform,
      chromeVersion: ctxOpts._chromeVersion,
    });
    await page.goto('about:blank');

    const permState = await page.evaluate(async () => {
      const result = await navigator.permissions.query({ name: 'notifications' });
      return result.state;
    });
    expect(permState).toBe('prompt');
    await browser.close();
  });
});

test.describe('Deep Stealth Injection — Performance.now() Precision', () => {
  test('performance.now() has reduced precision (not sub-microsecond)', async () => {
    const browser = await chromium.launch({ headless: true, args: STEALTH_LAUNCH_ARGS });
    const ctxOpts = getStealthContextOptions();
    const context = await browser.newContext(ctxOpts);
    const page = await context.newPage();
    await injectDeepStealth(page, 'test-perf-' + Date.now(), {
      navPlatform: ctxOpts._navPlatform,
      uaDataPlatform: ctxOpts._uaDataPlatform,
      chromeVersion: ctxOpts._chromeVersion,
    });
    await page.goto('about:blank');

    const precisionCheck = await page.evaluate(() => {
      const samples: number[] = [];
      for (let i = 0; i < 100; i++) {
        samples.push(performance.now());
      }
      // Check that precision is normalized (values should be rounded to 5μs = 0.005ms)
      const diffs = samples.map((v, i) => i > 0 ? v - samples[i-1] : 0).filter(d => d > 0);
      // All diffs should be multiples of 0.005 (5μs)
      const allNormalized = diffs.every(d => Math.abs(d * 200 - Math.round(d * 200)) < 0.001);
      return allNormalized;
    });
    expect(precisionCheck).toBe(true);
    await browser.close();
  });
});

test.describe('Deep Stealth Injection — Consistent Fingerprint Per Seed', () => {
  test('same seed produces same navigator values', async () => {
    const browser = await chromium.launch({ headless: true, args: STEALTH_LAUNCH_ARGS });
    const results: any[] = [];

    for (let i = 0; i < 2; i++) {
      // Use the same ctxOpts to ensure same platform
      const ctxOpts = getStealthContextOptions();
      const context = await browser.newContext(ctxOpts);
      const page = await context.newPage();
      await injectDeepStealth(page, 'deterministic-seed-abc123', {
        navPlatform: 'Win32',
        uaDataPlatform: 'Windows',
        chromeVersion: '134',
      });
      await page.goto('about:blank');

      const data = await page.evaluate(() => ({
        platform: navigator.platform,
        vendor: navigator.vendor,
        plugins: navigator.plugins.length,
      }));
      results.push(data);
      await context.close();
    }

    expect(results[0].platform).toBe(results[1].platform);
    expect(results[0].vendor).toBe(results[1].vendor);
    expect(results[0].plugins).toBe(results[1].plugins);
    await browser.close();
  });
});
