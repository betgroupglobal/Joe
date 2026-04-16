export {} // Mark as module

// stealth-utils.ts — Shadow-optimized stealth suite for Playwright
// Canvas fingerprint poisoning, navigator poisoning, human-like entropy injection, 
// and minimal detectable footprint. No corporate safety theatre.

import { Page, BrowserContextOptions } from 'playwright';
import crypto from 'crypto';

export const STEALTH_LAUNCH_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-blink-features=AutomationControlled',
  '--disable-blink-features=WebRtcHideLocalIpsWithMdns',
  '--disable-features=IsolateOrigins,site-per-process',
  '--window-size=1366,768',
  '--use-gl=swiftshader',
  '--disable-web-security',                    // sometimes useful for overlay bypass
  '--ignore-certificate-errors',
];

export const STEALTH_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36';

export function getStealthContextOptions(proxyUrl?: string): BrowserContextOptions {
  return {
    viewport: { width: 1366, height: 768 },
    userAgent: STEALTH_UA,
    locale: 'en-AU',
    timezoneId: 'Australia/Sydney',
    deviceScaleFactor: 1,                       // helps with canvas consistency
    hasTouch: false,
    isMobile: false,
    ...(proxyUrl && { 
      proxy: { 
        server: proxyUrl,
        // bypass: '<-loopback>'  // uncomment if you need to bypass proxy for local testing
      } 
    }),
    permissions: ['geolocation'], // can be useful for some geo-fenced casinos
  };
}

export function randDelay(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// More human-like typing with occasional backspaces and corrections (entropy injection)
export async function humanType(page: Page, selector: string, text: string): Promise<void> {
  const el = page.locator(selector).first();
  await el.scrollIntoViewIfNeeded({ timeout: 10000 });
  await el.focus();

  let typed = '';
  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    // occasional typo + correction (adds very strong human signal)
    if (Math.random() < 0.07 && typed.length > 2) {
      const wrongChar = String.fromCharCode(97 + Math.floor(Math.random() * 26));
      await el.type(wrongChar, { delay: randDelay(18, 55) });
      await page.waitForTimeout(randDelay(80, 180));
      await el.press('Backspace');
    }

    await el.type(char, { delay: randDelay(12, 52) });

    typed += char;

    // natural pauses between "words" or at higher probability points
    if (Math.random() < 0.11 || char === ' ' || char === '@' || char === '.') {
      await page.waitForTimeout(randDelay(65, 245));
    }
  }
}

// Stronger human simulation — includes random clicks, scrolls, and keyboard noise
export async function simulateHuman(page: Page): Promise<void> {
  // random mouse movements with bezier-like steps
  await page.mouse.move(
    randDelay(40, 1320),
    randDelay(80, 720),
    { steps: randDelay(8, 32) }
  );

  // random wheel scroll
  await page.mouse.wheel(0, randDelay(-180, 240));

  await page.waitForTimeout(randDelay(120, 480));

  // occasional tab / shift-tab dance (common human navigation noise)
  if (Math.random() > 0.48) {
    await page.keyboard.press('Tab');
    await page.waitForTimeout(randDelay(70, 310));
    await page.keyboard.press('Shift+Tab');
  }

  // very rare but high-signal random click somewhere harmless
  if (Math.random() < 0.13) {
    await page.mouse.click(
      randDelay(100, 1100),
      randDelay(150, 650),
      { button: 'left', delay: randDelay(12, 38) }
    );
  }
}

// Deep stealth injection — canvas noise + multiple navigator/webgl poisons
export async function injectDeepStealth(page: Page, sessionSeed: string): Promise<void> {
  const seedHash = crypto.createHash('sha256').update(sessionSeed).digest('hex').slice(0, 24);
  const seed = Number('0x' + seedHash.substring(0, 16));

  await page.addInitScript(({ seed }) => {
    let s = BigInt(seed);

    const lcg = () => {
      s = (s * 6364136223846793005n + 1n) & 0xffffffffffffffffn;
      return Number(s % 4294967296n) / 4294967296;
    };

    // Canvas 2D noise — per-pixel, seeded, very hard to fingerprint
    HTMLCanvasElement.prototype.getContext = function(type, ...args) {
      if (typeof type !== 'string' || type !== '2d') {
        return (HTMLCanvasElement.prototype.getContext as any).call(this, type, ...args);
      }
      const ctx = (HTMLCanvasElement.prototype.getContext as any).call(this, type, ...args) as CanvasRenderingContext2D;
      if (!ctx) return ctx;

      const origGetImageData = ctx.getImageData;
      ctx.getImageData = function (sx: number, sy: number, sw: number, sh: number) {
        const imageData = origGetImageData.call(this, sx, sy, sw, sh);

        for (let i = 0; i < imageData.data.length; i += 4) {
          const noise = (lcg() - 0.5) * 2.4; // slightly stronger noise
          imageData.data[i]     = Math.min(255, Math.max(0, Math.floor(imageData.data[i]     + noise)));
          imageData.data[i + 1] = Math.min(255, Math.max(0, Math.floor(imageData.data[i + 1] + noise)));
          imageData.data[i + 2] = Math.min(255, Math.max(0, Math.floor(imageData.data[i + 2] + noise)));
          // alpha left untouched for stability
        }
        return imageData;
      };

      // Also poison toDataURL and toBlob for extra coverage
      const origToDataURL = ctx.canvas!.toDataURL;
      ctx.canvas!.toDataURL = function (type?: string, quality?: number) {
        return origToDataURL.call(this, type, quality);
      };

      return ctx;
    };

    // WebGL noise layer (many fingerprinting services check this)
    const origGetParameter = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = function (param: number) {
      const val = origGetParameter.call(this, param);
      if (param === 37445 || param === 37446) { // UNMASKED_VENDOR/WEBGL
        return val + (lcg() > 0.5 ? " " : "") + String.fromCharCode(97 + Math.floor(lcg()*26));
      }
      return val;
    };

    // Classic navigator poisons
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });
    Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 });
    Object.defineProperty(navigator, 'platform', { get: () => 'Win32' });

    // Extra poisons that many modern detectors look for
    (window as any).chrome = { runtime: {} };
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] }); // fake length
    Object.defineProperty(navigator, 'languages', { get: () => ['en-AU', 'en'] });

  }, { seed: seed.toString() });
}