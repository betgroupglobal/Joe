import { chromium, Page, LaunchOptions, BrowserContextOptions } from 'playwright';
import * as fs from 'fs';
import { STEALTH_LAUNCH_ARGS, getStealthContextOptions, injectDeepStealth, simulateHuman, randDelay, humanType } from './stealth-utils';
import { getActiveSlot } from './proxy-rotator';

export interface ScanResult {
  url: string;
  timestamp: string;
  selectors: any[];
  network_calls: any[];
  auto_login?: {
    username: string;
    password: string;
    submit: string;
  };
  error?: string;
}

export async function scanLogin(url: string): Promise<ScanResult> {
  if (!url.startsWith('http')) url = 'https://' + url;

  const activeVpn = getActiveSlot();
  console.log(`[scan] Using VPN: ${activeVpn?.name ?? '(none — traffic goes direct)'}`);

  const browser = await chromium.launch({ 
    headless: true,
    args: STEALTH_LAUNCH_ARGS,
    ignoreHTTPSErrors: true as any // Bypass strict TS
  } as any);
  // No proxy — traffic routes through the WireGuard VPN interface
  const context = await browser.newContext({
    ...getStealthContextOptions(),
    ignoreHTTPSErrors: true as any // Bypass strict TS for HTTPS errors
  } as any);
  const page = await context.newPage();

  await injectDeepStealth(page, 'scan-' + Date.now());
  await simulateHuman(page);

  const results: ScanResult = {
    url,
    timestamp: new Date().toISOString(),
    selectors: [],
    network_calls: []
  };

  page.on('request', request => {
    const reqUrl = request.url().toLowerCase();
    const keywords = ['login', 'auth', 'signin', 'token', 'session'];
    if (keywords.some(kw => reqUrl.includes(kw))) {
      results.network_calls.push({
        url: request.url(),
        method: request.method(),
        type: request.resourceType()
      });
    }
  });

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    // Wait for network to settle (up to 15s) then proceed regardless
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(randDelay(2000, 5000));

    // Screenshot for debug
    await page.screenshot({ path: `./scan_${Date.now()}.png`, fullPage: true });

    results.selectors = await page.$$eval('input, button, [role="button"], .login, .auth, [class*="login"], [id*="login"]', (els) => {
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
          findings.push({
            role,
            tagName: el.tagName,
            id,
            name,
            type,
            placeholder,
            outerHTML: el.outerHTML.substring(0, 300) + '...'
          });
        }
      });
      return findings;
    });

    // Auto-fill demo if selectors found
    if (results.selectors.length > 0) {
      const usernameEl = results.selectors.find(s => s.role === 'username_field');
      const passwordEl = results.selectors.find(s => s.role === 'password_field');
      const submitEl   = results.selectors.find(s => s.role === 'submit_button');

      // Build robust CSS selectors: prefer id, fallback to name, then generic
      const buildSel = (el: any, fallback: string): string => {
        if (el?.id)   return `#${el.id}`;
        if (el?.name) return `[name="${el.name}"]`;
        return fallback;
      };

      const usernameCss = buildSel(usernameEl, 'input[type="email"], input[type="text"]');
      const passwordCss = buildSel(passwordEl, 'input[type="password"]');
      const submitCss   = buildSel(submitEl,   'button[type="submit"]');

      await humanType(page, usernameCss, 'stealthuser@example.com');
      await humanType(page, passwordCss, 'DemoPass123!');
      await page.click(submitCss);
      results.auto_login = { username: usernameCss, password: passwordCss, submit: submitCss };
      console.log('Auto-login attempted:', results.auto_login);

      // Log to login_results.json
      let loginLogs: any[] = [];
      try {
        loginLogs = JSON.parse(fs.readFileSync('./login_results.json', 'utf8'));
      } catch {
        // File doesn't exist or is invalid — start fresh
      }
      loginLogs.push({ url, timestamp: results.timestamp, auto_login: results.auto_login });
      fs.writeFileSync('./login_results.json', JSON.stringify(loginLogs, null, 2));
    }

    console.log(`Scan complete: ${results.selectors.length} selectors, screenshot saved`);
  } catch (error: any) {
    console.error('Scan error:', error.message);
    results.error = error.message;
    await page.screenshot({ path: `./scan_error_${Date.now()}.png`, fullPage: true });
    results.selectors = [];
  }

  // Log to file
  let logs: any[] = [];
  try {
    logs = JSON.parse(fs.readFileSync('./scan_results.json', 'utf8'));
  } catch {
    // File doesn't exist or is invalid — start fresh
  }
  logs.push(results);
  fs.writeFileSync('./scan_results.json', JSON.stringify(logs, null, 2));

  await browser.close();
  return results;
}
