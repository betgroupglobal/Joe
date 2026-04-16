export {} // Mark as module

// stealth-utils.ts — Advanced anti-detection stealth suite for Playwright
// Comprehensive fingerprint poisoning: Canvas, WebGL, AudioContext, fonts,
// navigator deep spoofing, CDP leak patching, realistic plugin emulation,
// User-Agent Client Hints, and human behavioral entropy injection.

import { Page, BrowserContextOptions } from 'playwright';
import crypto from 'crypto';

// ─── Randomized viewport pools (avoid static 1366x768 fingerprint) ────────────

const VIEWPORT_POOL = [
  { width: 1920, height: 1080 },
  { width: 1536, height: 864  },
  { width: 1440, height: 900  },
  { width: 1366, height: 768  },
  { width: 1280, height: 720  },
  { width: 1600, height: 900  },
  { width: 1280, height: 800  },
  { width: 1680, height: 1050 },
];

// ─── Realistic UA pool (recent Chrome versions on Windows) ────────────────────

const UA_POOL = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
];

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ─── Launch args ──────────────────────────────────────────────────────────────

export const STEALTH_LAUNCH_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-blink-features=AutomationControlled',
  '--disable-features=IsolateOrigins,site-per-process',
  '--disable-features=AutomationControlled',
  '--disable-ipc-flooding-protection',
  '--use-gl=swiftshader',
  '--disable-web-security',
  '--ignore-certificate-errors',
  // WebRTC leak prevention
  '--enforce-webrtc-ip-permission-check',
  '--disable-webrtc-hw-encoding',
  '--disable-webrtc-hw-decoding',
  '--webrtc-ip-handling-policy=disable_non_proxied_udp',
  // Anti-detection
  '--disable-component-extensions-with-background-pages',
  '--disable-default-apps',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
  '--disable-background-timer-throttling',
  '--disable-hang-monitor',
  '--metrics-recording-only',
  '--password-store=basic',
  '--use-mock-keychain',
  '--export-tagged-pdf',
  '--disable-dev-shm-usage',
];

// Exported for backward compat — picks a random UA each time
export const STEALTH_UA = pickRandom(UA_POOL);

export function getStealthContextOptions(proxyUrl?: string): BrowserContextOptions {
  const viewport = pickRandom(VIEWPORT_POOL);
  const ua = pickRandom(UA_POOL);
  const isMac = ua.includes('Macintosh');

  return {
    viewport,
    userAgent: ua,
    locale: 'en-AU',
    timezoneId: 'Australia/Sydney',
    deviceScaleFactor: isMac ? 2 : 1,
    hasTouch: false,
    isMobile: false,
    ...(proxyUrl && {
      proxy: {
        server: proxyUrl,
      }
    }),
    permissions: ['geolocation'],
    // Extra HTTP headers to look more realistic
    extraHTTPHeaders: {
      'Accept-Language': 'en-AU,en;q=0.9',
      'sec-ch-ua': `"Chromium";v="134", "Google Chrome";v="134", "Not:A-Brand";v="99"`,
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': isMac ? '"macOS"' : '"Windows"',
    },
  };
}

// ─── Delay utilities ──────────────────────────────────────────────────────────

export function randDelay(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Gaussian-distributed delay (more natural than uniform)
function gaussianDelay(mean: number, stdev: number): number {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  const num = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  return Math.max(10, Math.round(num * stdev + mean));
}

// ─── Human-like typing with natural rhythm ────────────────────────────────────

export async function humanType(page: Page, selector: string, text: string): Promise<void> {
  const el = page.locator(selector).first();
  await el.scrollIntoViewIfNeeded({ timeout: 10000 });
  
  // Move mouse to element first (human would do this)
  const box = await el.boundingBox();
  if (box) {
    await bezierMouseMove(page,
      randDelay(100, 600), randDelay(100, 400),
      box.x + box.width / 2 + randDelay(-10, 10),
      box.y + box.height / 2 + randDelay(-3, 3)
    );
    await page.waitForTimeout(randDelay(80, 200));
  }
  
  await el.click();
  await page.waitForTimeout(randDelay(100, 300));

  let typed = '';
  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    // occasional typo + correction (~5% chance, more natural rate)
    if (Math.random() < 0.05 && typed.length > 2 && i < text.length - 1) {
      // Pick a key adjacent on keyboard for realism
      const wrongChar = getAdjacentKey(char);
      await page.keyboard.type(wrongChar, { delay: gaussianDelay(35, 12) });
      await page.waitForTimeout(gaussianDelay(150, 50));
      await page.keyboard.press('Backspace');
      await page.waitForTimeout(gaussianDelay(80, 25));
    }

    // Typing speed varies by character type
    let baseDelay = 35;
    if (char === '@' || char === '.' || char === '!') baseDelay = 55; // special chars slower
    else if (char === char.toUpperCase() && char !== char.toLowerCase()) baseDelay = 50; // uppercase slower (shift key)
    
    await page.keyboard.type(char, { delay: gaussianDelay(baseDelay, 12) });
    typed += char;

    // Natural pauses: after words, special chars, or random thinking pauses
    if (char === ' ' || char === '@' || char === '.') {
      await page.waitForTimeout(gaussianDelay(120, 40));
    } else if (Math.random() < 0.08) {
      await page.waitForTimeout(gaussianDelay(90, 30));
    }
  }
}

// Get an adjacent key on QWERTY layout for realistic typos
function getAdjacentKey(char: string): string {
  const adjacency: Record<string, string> = {
    'a': 'sq', 'b': 'vn', 'c': 'xv', 'd': 'sf', 'e': 'wr', 'f': 'dg',
    'g': 'fh', 'h': 'gj', 'i': 'uo', 'j': 'hk', 'k': 'jl', 'l': 'k',
    'm': 'n', 'n': 'bm', 'o': 'ip', 'p': 'o', 'q': 'wa', 'r': 'et',
    's': 'ad', 't': 'ry', 'u': 'yi', 'v': 'cb', 'w': 'qe', 'x': 'zc',
    'y': 'tu', 'z': 'x', '1': '2', '2': '13', '3': '24', '4': '35',
    '5': '46', '6': '57', '7': '68', '8': '79', '9': '80', '0': '9',
  };
  const lower = char.toLowerCase();
  const neighbors = adjacency[lower];
  if (!neighbors) return String.fromCharCode(97 + Math.floor(Math.random() * 26));
  return neighbors[Math.floor(Math.random() * neighbors.length)];
}

// ─── Bezier curve mouse movement (much more human than linear) ────────────────

async function bezierMouseMove(
  page: Page, 
  fromX: number, fromY: number, 
  toX: number, toY: number
): Promise<void> {
  const steps = randDelay(15, 35);
  
  // Control points for cubic bezier (slight curve, not straight line)
  const cp1x = fromX + (toX - fromX) * 0.25 + randDelay(-40, 40);
  const cp1y = fromY + (toY - fromY) * 0.1 + randDelay(-30, 30);
  const cp2x = fromX + (toX - fromX) * 0.75 + randDelay(-40, 40);
  const cp2y = fromY + (toY - fromY) * 0.9 + randDelay(-30, 30);

  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    
    const x = u*u*u*fromX + 3*u*u*t*cp1x + 3*u*t*t*cp2x + t*t*t*toX;
    const y = u*u*u*fromY + 3*u*u*t*cp1y + 3*u*t*t*cp2y + t*t*t*toY;
    
    await page.mouse.move(Math.round(x), Math.round(y));
    
    // Variable speed: slow at start/end, fast in middle (ease-in-out)
    const speedFactor = Math.sin(t * Math.PI);
    await page.waitForTimeout(Math.max(1, Math.round(3 + (1 - speedFactor) * 8)));
  }
}

// ─── Advanced human simulation ────────────────────────────────────────────────

export async function simulateHuman(page: Page): Promise<void> {
  // Bezier mouse movement to a random position
  const startX = randDelay(100, 800);
  const startY = randDelay(100, 500);
  const endX = randDelay(200, 1200);
  const endY = randDelay(150, 650);
  
  await bezierMouseMove(page, startX, startY, endX, endY);

  // Natural scroll (variable speed, sometimes overshoots)
  const scrollAmount = randDelay(-200, 300);
  const scrollSteps = randDelay(3, 8);
  for (let i = 0; i < scrollSteps; i++) {
    await page.mouse.wheel(0, Math.round(scrollAmount / scrollSteps + randDelay(-10, 10)));
    await page.waitForTimeout(randDelay(20, 60));
  }

  await page.waitForTimeout(randDelay(200, 600));

  // Tab navigation noise (common human pattern)
  if (Math.random() > 0.55) {
    await page.keyboard.press('Tab');
    await page.waitForTimeout(randDelay(100, 400));
    if (Math.random() > 0.5) {
      await page.keyboard.press('Shift+Tab');
    }
  }

  // Rare idle pause (human looking at page, reading)
  if (Math.random() < 0.2) {
    await page.waitForTimeout(randDelay(500, 1500));
  }

  // Very rare viewport interaction
  if (Math.random() < 0.08) {
    await page.mouse.click(
      randDelay(200, 1000),
      randDelay(200, 600),
      { button: 'left', delay: randDelay(15, 45) }
    );
  }
}

// ─── Deep stealth injection ───────────────────────────────────────────────────
// Comprehensive anti-fingerprinting and automation detection evasion

export async function injectDeepStealth(page: Page, sessionSeed: string): Promise<void> {
  const seedHash = crypto.createHash('sha256').update(sessionSeed).digest('hex');
  const seed = Number('0x' + seedHash.substring(0, 16));

  await page.addInitScript(({ seed }) => {
    // ─── Seeded PRNG ────────────────────────────────────────────────────
    let s = BigInt(seed);
    const lcg = () => {
      s = (s * 6364136223846793005n + 1n) & 0xffffffffffffffffn;
      return Number(s % 4294967296n) / 4294967296;
    };

    // ─── 1. Canvas 2D noise ─────────────────────────────────────────────
    const origGetContext = HTMLCanvasElement.prototype.getContext;
    (HTMLCanvasElement.prototype as any).getContext = function(type: string, ...args: any[]) {
      const ctx = (origGetContext as any).call(this, type, ...args);
      if (!ctx) return ctx;

      if (type === '2d') {
        const origGetImageData = ctx.getImageData.bind(ctx);
        ctx.getImageData = function(sx: number, sy: number, sw: number, sh: number) {
          const imageData = origGetImageData(sx, sy, sw, sh);
          for (let i = 0; i < imageData.data.length; i += 4) {
            const noise = (lcg() - 0.5) * 2.8;
            imageData.data[i]     = Math.min(255, Math.max(0, imageData.data[i]     + noise | 0));
            imageData.data[i + 1] = Math.min(255, Math.max(0, imageData.data[i + 1] + noise | 0));
            imageData.data[i + 2] = Math.min(255, Math.max(0, imageData.data[i + 2] + noise | 0));
          }
          return imageData;
        };

        // Poison toDataURL on the canvas itself
        const origToDataURL = this.toDataURL.bind(this);
        this.toDataURL = function(type?: string, quality?: number) {
          // Add invisible noise to canvas before export
          try {
            const tempCtx = origGetContext.call(this, '2d') as any;
            if (tempCtx) {
              const w = this.width || 1;
              const h = this.height || 1;
              const imgData = tempCtx.getImageData(0, 0, w, h);
              for (let i = 0; i < imgData.data.length; i += 4) {
                imgData.data[i] = (imgData.data[i] + ((lcg() - 0.5) * 1.5 | 0)) & 0xff;
              }
              tempCtx.putImageData(imgData, 0, 0);
            }
          } catch (e) {}
          return origToDataURL(type, quality);
        };
      }

      return ctx;
    };

    // ─── 2. WebGL fingerprint spoofing (GL1 + GL2) ──────────────────────
    const WEBGL_VENDORS = [
      'Google Inc. (NVIDIA)',
      'Google Inc. (AMD)',
      'Google Inc. (Intel)',
    ];
    const WEBGL_RENDERERS = [
      'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)',
      'ANGLE (AMD, AMD Radeon RX 6700 XT Direct3D11 vs_5_0 ps_5_0, D3D11)',
      'ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)',
      'ANGLE (NVIDIA, NVIDIA GeForce GTX 1660 SUPER Direct3D11 vs_5_0 ps_5_0, D3D11)',
      'ANGLE (AMD, AMD Radeon(TM) Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)',
    ];

    const chosenVendor   = WEBGL_VENDORS[Math.floor(lcg() * WEBGL_VENDORS.length)];
    const chosenRenderer = WEBGL_RENDERERS[Math.floor(lcg() * WEBGL_RENDERERS.length)];

    function patchWebGL(proto: any) {
      const origGetParam = proto.getParameter;
      proto.getParameter = function(param: number) {
        // UNMASKED_VENDOR_WEBGL = 0x9245 (37445)
        if (param === 37445) return chosenVendor;
        // UNMASKED_RENDERER_WEBGL = 0x9246 (37446)
        if (param === 37446) return chosenRenderer;
        return origGetParam.call(this, param);
      };

      const origGetExtension = proto.getExtension;
      proto.getExtension = function(name: string) {
        // Ensure debug extension returns our spoofed values
        if (name === 'WEBGL_debug_renderer_info') {
          return { UNMASKED_VENDOR_WEBGL: 37445, UNMASKED_RENDERER_WEBGL: 37446 };
        }
        return origGetExtension.call(this, name);
      };
    }

    if (typeof WebGLRenderingContext !== 'undefined') patchWebGL(WebGLRenderingContext.prototype);
    if (typeof WebGL2RenderingContext !== 'undefined') patchWebGL(WebGL2RenderingContext.prototype);

    // ─── 3. AudioContext fingerprint noise ───────────────────────────────
    const origCreateOscillator = AudioContext.prototype.createOscillator;
    const origCreateDynamicsCompressor = AudioContext.prototype.createDynamicsCompressor;
    
    AudioContext.prototype.createOscillator = function() {
      const osc = origCreateOscillator.call(this);
      const origConnect = osc.connect.bind(osc);
      osc.connect = function(dest: any, ...rest: any[]) {
        // If connecting to analyser, add subtle gain noise
        if (dest instanceof AnalyserNode) {
          try {
            const gain = (osc.context as AudioContext).createGain();
            gain.gain.value = 1.0 + (lcg() - 0.5) * 0.001;
            origConnect(gain);
            gain.connect(dest);
            return dest;
          } catch (e) {}
        }
        return origConnect(dest, ...rest);
      };
      return osc;
    };

    // Patch OfflineAudioContext (used by most fingerprinting scripts)
    if (typeof OfflineAudioContext !== 'undefined') {
      const origRenderComplete = OfflineAudioContext.prototype.startRendering;
      OfflineAudioContext.prototype.startRendering = function() {
        return origRenderComplete.call(this).then((buffer: AudioBuffer) => {
          const channelData = buffer.getChannelData(0);
          for (let i = 0; i < channelData.length; i++) {
            channelData[i] += (lcg() - 0.5) * 0.0001;
          }
          return buffer;
        });
      };
    }

    // ─── 4. Navigator deep spoofing ─────────────────────────────────────
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined, configurable: true });
    Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => [4, 8, 12, 16][Math.floor(lcg() * 4)], configurable: true });
    Object.defineProperty(navigator, 'deviceMemory', { get: () => [4, 8, 16][Math.floor(lcg() * 3)], configurable: true });
    Object.defineProperty(navigator, 'maxTouchPoints', { get: () => 0, configurable: true });
    Object.defineProperty(navigator, 'platform', { get: () => 'Win32', configurable: true });
    Object.defineProperty(navigator, 'languages', { get: () => Object.freeze(['en-AU', 'en-US', 'en']), configurable: true });
    Object.defineProperty(navigator, 'vendor', { get: () => 'Google Inc.', configurable: true });

    // Realistic plugins (matching Chrome on Windows)
    const fakePlugins = [
      { name: 'PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format', length: 1 },
      { name: 'Chrome PDF Viewer', filename: 'internal-pdf-viewer', description: '', length: 1 },
      { name: 'Chromium PDF Viewer', filename: 'internal-pdf-viewer', description: '', length: 1 },
      { name: 'Microsoft Edge PDF Viewer', filename: 'internal-pdf-viewer', description: '', length: 1 },
      { name: 'WebKit built-in PDF', filename: 'internal-pdf-viewer', description: '', length: 1 },
    ];

    Object.defineProperty(navigator, 'plugins', {
      get: () => {
        const arr = fakePlugins as any;
        arr.item = (i: number) => fakePlugins[i];
        arr.namedItem = (name: string) => fakePlugins.find(p => p.name === name);
        arr.refresh = () => {};
        return arr;
      },
      configurable: true,
    });

    Object.defineProperty(navigator, 'mimeTypes', {
      get: () => {
        const types = [
          { type: 'application/pdf', suffixes: 'pdf', description: 'Portable Document Format', enabledPlugin: fakePlugins[0] },
        ];
        const arr = types as any;
        arr.item = (i: number) => types[i];
        arr.namedItem = (name: string) => types.find(t => t.type === name);
        return arr;
      },
      configurable: true,
    });

    // ─── 5. User-Agent Client Hints (navigatorUAData) ───────────────────
    if ('userAgentData' in navigator) {
      Object.defineProperty(navigator, 'userAgentData', {
        get: () => ({
          brands: [
            { brand: 'Chromium', version: '134' },
            { brand: 'Google Chrome', version: '134' },
            { brand: 'Not:A-Brand', version: '99' },
          ],
          mobile: false,
          platform: 'Windows',
          getHighEntropyValues: () => Promise.resolve({
            architecture: 'x86',
            bitness: '64',
            brands: [
              { brand: 'Chromium', version: '134.0.6998.178' },
              { brand: 'Google Chrome', version: '134.0.6998.178' },
              { brand: 'Not:A-Brand', version: '99.0.0.0' },
            ],
            fullVersionList: [
              { brand: 'Chromium', version: '134.0.6998.178' },
              { brand: 'Google Chrome', version: '134.0.6998.178' },
              { brand: 'Not:A-Brand', version: '99.0.0.0' },
            ],
            mobile: false,
            model: '',
            platform: 'Windows',
            platformVersion: '15.0.0',
            uaFullVersion: '134.0.6998.178',
          }),
        }),
        configurable: true,
      });
    }

    // ─── 6. Permissions API spoofing ────────────────────────────────────
    const origPermQuery = navigator.permissions?.query?.bind(navigator.permissions);
    if (origPermQuery) {
      (navigator.permissions as any).query = function(desc: any) {
        // Return 'prompt' for notifications (automation returns 'denied' which is a signal)
        if (desc?.name === 'notifications') {
          return Promise.resolve({ state: 'prompt', onchange: null } as any);
        }
        return origPermQuery(desc);
      };
    }

    // ─── 7. Chrome object & CDP leak patching ───────────────────────────
    (window as any).chrome = {
      app: { isInstalled: false, InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' }, RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' } },
      runtime: {
        OnInstalledReason: { CHROME_UPDATE: 'chrome_update', INSTALL: 'install', SHARED_MODULE_UPDATE: 'shared_module_update', UPDATE: 'update' },
        OnRestartRequiredReason: { APP_UPDATE: 'app_update', OS_UPDATE: 'os_update', PERIODIC: 'periodic' },
        PlatformArch: { ARM: 'arm', ARM64: 'arm64', MACE: 'mace', MIPS: 'mips', MIPS64: 'mips64', X86_32: 'x86-32', X86_64: 'x86-64' },
        PlatformNaclArch: { ARM: 'arm', MIPS: 'mips', MIPS64: 'mips64', X86_32: 'x86-32', X86_64: 'x86-64' },
        PlatformOs: { ANDROID: 'android', CROS: 'cros', LINUX: 'linux', MAC: 'mac', OPENBSD: 'openbsd', WIN: 'win' },
        RequestUpdateCheckStatus: { NO_UPDATE: 'no_update', THROTTLED: 'throttled', UPDATE_AVAILABLE: 'update_available' },
        connect: function() { },
        sendMessage: function() { },
        id: undefined,
      },
      csi: function() {},
      loadTimes: function() { return {}; },
    };

    // Remove CDP markers (cdc_ prefix properties)
    const cdcProps = Object.getOwnPropertyNames(document).filter(p => p.startsWith('$cdc_') || p.startsWith('__cdc'));
    cdcProps.forEach(p => { try { delete (document as any)[p]; } catch(e) {} });

    // Remove window.cdc markers
    const wCdcProps = Object.getOwnPropertyNames(window).filter(p => p.startsWith('$cdc_') || p.startsWith('__cdc'));
    wCdcProps.forEach(p => { try { delete (window as any)[p]; } catch(e) {} });

    // ─── 8. Screen dimensions consistency ───────────────────────────────
    const screenW = window.innerWidth || 1366;
    const screenH = window.innerHeight || 768;

    Object.defineProperty(screen, 'width',      { get: () => screenW, configurable: true });
    Object.defineProperty(screen, 'height',     { get: () => screenH, configurable: true });
    Object.defineProperty(screen, 'availWidth',  { get: () => screenW, configurable: true });
    Object.defineProperty(screen, 'availHeight', { get: () => screenH - 40, configurable: true }); // taskbar
    Object.defineProperty(screen, 'colorDepth',  { get: () => 24, configurable: true });
    Object.defineProperty(screen, 'pixelDepth',  { get: () => 24, configurable: true });

    // outerWidth/Height must be consistent
    Object.defineProperty(window, 'outerWidth',  { get: () => screenW, configurable: true });
    Object.defineProperty(window, 'outerHeight', { get: () => screenH + 85, configurable: true }); // Chrome toolbar

    // ─── 9. Connection API ──────────────────────────────────────────────
    if (!('connection' in navigator)) {
      Object.defineProperty(navigator, 'connection', {
        get: () => ({
          downlink: 10,
          effectiveType: '4g',
          rtt: 50,
          saveData: false,
          onchange: null,
          addEventListener: () => {},
          removeEventListener: () => {},
          dispatchEvent: () => true,
        }),
        configurable: true,
      });
    }

    // ─── 10. Battery API (looks like desktop) ───────────────────────────
    if ('getBattery' in navigator) {
      (navigator as any).getBattery = () => Promise.resolve({
        charging: true,
        chargingTime: 0,
        dischargingTime: Infinity,
        level: 1.0,
        onchargingchange: null,
        onchargingtimechange: null,
        ondischargingtimechange: null,
        onlevelchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => true,
      });
    }

    // ─── 11. Headless detection patches ─────────────────────────────────
    // Notification constructor should exist
    if (typeof Notification === 'undefined') {
      (window as any).Notification = class {
        static permission = 'default';
        static requestPermission = () => Promise.resolve('default');
        constructor() {}
      };
    }

    // SharedWorker should exist in real Chrome
    if (typeof SharedWorker === 'undefined') {
      (window as any).SharedWorker = class {
        port = { start: () => {}, addEventListener: () => {} };
        constructor() {}
      };
    }

    // ─── 12. iframe contentWindow leak fix ──────────────────────────────
    // Some detectors create iframes and check contentWindow properties
    const origCreateElement = document.createElement.bind(document);
    document.createElement = function(tagName: string, options?: any) {
      const el = origCreateElement(tagName, options);
      if (tagName.toLowerCase() === 'iframe') {
        const origSrc = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'contentWindow');
        // Ensure iframe contentWindow doesn't leak automation signals
        Object.defineProperty(el, 'contentWindow', {
          get: function() {
            const win = origSrc?.get?.call(this);
            if (win) {
              try {
                Object.defineProperty(win.navigator, 'webdriver', { get: () => undefined, configurable: true });
              } catch (e) {}
            }
            return win;
          },
          configurable: true,
        });
      }
      return el;
    };

    // ─── 13. Performance.now() precision normalization ──────────────────
    // Headless Chrome can have higher precision; normalize to 5μs
    const origPerfNow = performance.now.bind(performance);
    performance.now = function() {
      return Math.round(origPerfNow() * 200) / 200; // 5μs precision
    };

    // ─── 14. Font fingerprint noise ─────────────────────────────────────
    // Offset measureText width slightly per session seed
    const origMeasureText = CanvasRenderingContext2D.prototype.measureText;
    CanvasRenderingContext2D.prototype.measureText = function(text: string) {
      const metrics = origMeasureText.call(this, text);
      const origWidth = metrics.width;
      Object.defineProperty(metrics, 'width', {
        get: () => origWidth + (lcg() - 0.5) * 0.1,
        configurable: true,
      });
      return metrics;
    };

    // ─── 15. Disable Playwright-specific leaks ──────────────────────────
    // Remove __playwright markers
    try {
      delete (window as any).__playwright;
      delete (window as any).__pw_manual;
    } catch (e) {}

    // Mask Error.stack traces that reveal automation
    const origToString = Error.prototype.toString;
    Error.prototype.toString = function() {
      const str = origToString.call(this);
      return str.replace(/playwright|puppeteer|selenium|webdriver/gi, 'native');
    };

  }, { seed: seed.toString() });
}
