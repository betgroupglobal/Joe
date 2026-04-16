import { test, expect } from '@playwright/test';

const { getStealthContextOptions, STEALTH_LAUNCH_ARGS } = require('../../stealth-utils');

test.describe('Stealth Context Options (getStealthContextOptions)', () => {

  test('returns a valid viewport from the pool', () => {
    const VALID_VIEWPORTS = [
      { width: 1920, height: 1080 },
      { width: 1536, height: 864 },
      { width: 1440, height: 900 },
      { width: 1366, height: 768 },
      { width: 1280, height: 720 },
      { width: 1600, height: 900 },
      { width: 1280, height: 800 },
      { width: 1680, height: 1050 },
    ];

    const opts = getStealthContextOptions();
    const match = VALID_VIEWPORTS.find(
      v => v.width === opts.viewport.width && v.height === opts.viewport.height
    );
    expect(match).toBeTruthy();
  });

  test('returns a valid Chrome user agent string', () => {
    const opts = getStealthContextOptions();
    expect(opts.userAgent).toMatch(/Chrome\/\d{3}\.0\.0\.0 Safari\/537\.36$/);
  });

  test('sets locale to en-AU and timezone to Australia/Sydney', () => {
    const opts = getStealthContextOptions();
    expect(opts.locale).toBe('en-AU');
    expect(opts.timezoneId).toBe('Australia/Sydney');
  });

  test('extracts Chrome version from UA correctly', () => {
    const opts = getStealthContextOptions();
    const uaMatch = opts.userAgent.match(/Chrome\/(\d+)/);
    expect(uaMatch).toBeTruthy();
    expect(opts._chromeVersion).toBe(uaMatch![1]);
  });

  test('platform info matches UA — Windows UA gets Win32 platform', () => {
    // Run enough times to capture a Windows UA
    for (let i = 0; i < 50; i++) {
      const opts = getStealthContextOptions();
      if (opts.userAgent.includes('Windows NT')) {
        expect(opts._navPlatform).toBe('Win32');
        expect(opts._uaDataPlatform).toBe('Windows');
        expect(opts.deviceScaleFactor).toBe(1);
        expect(opts.extraHTTPHeaders['sec-ch-ua-platform']).toBe('"Windows"');
        return;
      }
    }
    // If we never got Windows UA in 50 tries, skip — pool composition may vary
    test.skip();
  });

  test('platform info matches UA — Mac UA gets MacIntel platform', () => {
    for (let i = 0; i < 50; i++) {
      const opts = getStealthContextOptions();
      if (opts.userAgent.includes('Macintosh')) {
        expect(opts._navPlatform).toBe('MacIntel');
        expect(opts._uaDataPlatform).toBe('macOS');
        expect(opts.deviceScaleFactor).toBe(2);
        expect(opts.extraHTTPHeaders['sec-ch-ua-platform']).toBe('"macOS"');
        return;
      }
    }
    test.skip();
  });

  test('platform info matches UA — Linux UA gets Linux x86_64 platform', () => {
    for (let i = 0; i < 50; i++) {
      const opts = getStealthContextOptions();
      if (opts.userAgent.includes('Linux x86_64')) {
        expect(opts._navPlatform).toBe('Linux x86_64');
        expect(opts._uaDataPlatform).toBe('Linux');
        expect(opts.deviceScaleFactor).toBe(1);
        expect(opts.extraHTTPHeaders['sec-ch-ua-platform']).toBe('"Linux"');
        return;
      }
    }
    test.skip();
  });

  test('sec-ch-ua header version matches extracted Chrome version', () => {
    const opts = getStealthContextOptions();
    const expected = `"Chromium";v="${opts._chromeVersion}", "Google Chrome";v="${opts._chromeVersion}", "Not:A-Brand";v="99"`;
    expect(opts.extraHTTPHeaders['sec-ch-ua']).toBe(expected);
  });

  test('sec-ch-ua-mobile is always ?0 (desktop only)', () => {
    const opts = getStealthContextOptions();
    expect(opts.extraHTTPHeaders['sec-ch-ua-mobile']).toBe('?0');
  });

  test('multiple calls produce varying fingerprints (randomness check)', () => {
    const fingerprints = new Set<string>();
    for (let i = 0; i < 20; i++) {
      const opts = getStealthContextOptions();
      const fp = `${opts.userAgent}|${opts.viewport.width}x${opts.viewport.height}`;
      fingerprints.add(fp);
    }
    // Should have at least 2 different fingerprints in 20 tries
    expect(fingerprints.size).toBeGreaterThanOrEqual(2);
  });
});

test.describe('Stealth Launch Args', () => {

  test('includes automation-controlled disable flag', () => {
    expect(STEALTH_LAUNCH_ARGS).toContain('--disable-blink-features=AutomationControlled');
  });

  test('includes WebRTC leak prevention', () => {
    expect(STEALTH_LAUNCH_ARGS).toContain('--enforce-webrtc-ip-permission-check');
    expect(STEALTH_LAUNCH_ARGS).toContain('--webrtc-ip-handling-policy=disable_non_proxied_udp');
  });

  test('includes no-sandbox for headless environments', () => {
    expect(STEALTH_LAUNCH_ARGS).toContain('--no-sandbox');
  });

  test('uses swiftshader for WebGL', () => {
    expect(STEALTH_LAUNCH_ARGS).toContain('--use-gl=swiftshader');
  });
});
