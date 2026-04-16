import { chromium, Browser, LaunchOptions } from 'playwright';
import { STEALTH_LAUNCH_ARGS, STEALTH_UA, getStealthContextOptions, humanType, simulateHuman, injectDeepStealth, randDelay } from './stealth-utils';

import * as readline from 'readline';
import { scanLogin } from './scanner';

async function launchBrowser() {
  const proxyUrl = process.env.PROXY_URL || undefined; // set PROXY_URL=socks5://127.0.0.1:51820 when Proton VPN is up
  const browser = await chromium.launch({ 
    headless: false, 
    args: STEALTH_LAUNCH_ARGS,
    ignoreHTTPSErrors: true as any
  } as any);
  const context = await browser.newContext({
    ...getStealthContextOptions(proxyUrl),
    ignoreHTTPSErrors: true as any
  } as any);
  const page = await context.newPage();
  await injectDeepStealth(page, 'menu-session-' + Date.now());

  console.log('Browser launched. Close to return to menu.');
  await new Promise(r => browser.on('disconnected', r));
}

async function viewLogs() {
  const loginLogs = JSON.parse(require('fs').readFileSync('./login_results.json', 'utf8'));
  const scanLogs = JSON.parse(require('fs').readFileSync('./scan_results.json', 'utf8'));
  console.log('Login Logs:', loginLogs.slice(-5));
  console.log('Scan Logs:', scanLogs.slice(-5));
}

async function protonProxy() {
  console.log('Proton VPN: sudo wg-quick up proton_configs/proton-AU232.conf (low fail)');
  console.log('Proxy URL: socks5://127.0.0.1:51820');
  console.log('Run login-auto.ts for full automation!');
}

async function vpnStatus() {
  console.log('Check: sudo wg show');
}

async function vpnRotate() {
  console.log('[menu] VPN rotate: sudo wg-quick down <current> && sudo wg-quick up proton_configs/<new>.conf');
}

async function vpnDown() {
  console.log('[menu] VPN down: sudo wg-quick down proton-AU232 (or current tunnel)');
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

async function menu() {
  console.clear();
  console.log(`
Joe Stealth Menu:
1. Launch Stealth Browser
2. Scan Login Form (enter URL)
3. View Recent Logs
4. Proton Proxy Guide
5. VPN Status
6. VPN Rotate (auto pick best)
7. VPN Down (disconnect)
8. Exit
  `);

  rl.question('Choice: ', async (choice) => {
    switch (choice) {
      case '1': 
        await launchBrowser();
        break;
      case '2': 
        rl.question('URL: ', async (url) => {
          await scanLogin(url);
          menu();
        });
        return;
      case '3': 
        await viewLogs();
        break;
      case '4': 
        await protonProxy();
        break;
      case '5':
        await vpnStatus();
        break;
      case '6':
        await vpnRotate();
        break;
      case '7':
        await vpnDown();
        break;
      case '8': 
        rl.close();
        return;
    }
    menu();
  });
}

menu();

