import { chromium, Browser, LaunchOptions } from 'playwright';
import { STEALTH_LAUNCH_ARGS, STEALTH_UA, getStealthContextOptions, humanType, simulateHuman, injectDeepStealth, randDelay } from './stealth-utils';

import * as readline from 'readline';
import { scanLogin } from './scanner';
import { initProxies, rotate, getAllProxies, printProxyStats, vpnDown, getActiveSlot, getPublicIp } from './proxy-rotator';

async function launchBrowser() {
  const active = getActiveSlot();
  if (!active) {
    console.log('[menu] No VPN active — rotating to first config...');
    rotate();
  }
  const vpnName = getActiveSlot()?.name ?? 'none';
  console.log(`[menu] Launching browser via VPN: ${vpnName}`);

  const browser = await chromium.launch({ 
    headless: false, 
    args: STEALTH_LAUNCH_ARGS,
    ignoreHTTPSErrors: true as any
  } as any);
  // No proxy — traffic routes through the WireGuard VPN interface
  const ctxOpts = getStealthContextOptions();
  const context = await browser.newContext({
    ...ctxOpts,
    ignoreHTTPSErrors: true as any
  } as any);
  const page = await context.newPage();
  await injectDeepStealth(page, 'menu-session-' + Date.now(), {
    navPlatform: ctxOpts._navPlatform,
    uaDataPlatform: ctxOpts._uaDataPlatform,
    chromeVersion: ctxOpts._chromeVersion,
  });

  console.log('Browser launched. Close to return to menu.');
  await new Promise(r => browser.on('disconnected', r));
}

async function viewLogs() {
  const loginLogs = JSON.parse(require('fs').readFileSync('./login_results.json', 'utf8'));
  const scanLogs = JSON.parse(require('fs').readFileSync('./scan_results.json', 'utf8'));
  console.log('Login Logs:', loginLogs.slice(-5));
  console.log('Scan Logs:', scanLogs.slice(-5));
}

async function vpnStatus() {
  const active = getActiveSlot();
  const ip = getPublicIp();
  console.log(`\n[vpn] Active: ${active?.name ?? 'none'} | Public IP: ${ip ?? 'unknown'}`);
  const all = getAllProxies();
  console.log(`[vpn] ${all.length} WireGuard configs loaded:`);
  for (const s of all) {
    const marker = s === active ? ' ← active' : '';
    console.log(`  ${s.name}: ok:${s.successes} fail:${s.failures} lastIP:${s.currentIp ?? 'N/A'}${marker}`);
  }
  printProxyStats();
}

async function vpnRotate() {
  console.log('[vpn] Rotating to next ProtonVPN config...');
  const slot = rotate();
  if (slot) {
    console.log(`[vpn] Now active: ${slot.name} (IP: ${slot.currentIp ?? 'checking...'})`);
  } else {
    console.log('[vpn] Rotation failed.');
  }
}

async function vpnDisconnect() {
  vpnDown();
  console.log('[vpn] Disconnected.');
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

async function menu() {
  console.clear();
  console.log(`
Joe Stealth Menu:
1. Launch Stealth Browser (via ProtonVPN)
2. Scan Login Form (enter URL)
3. View Recent Logs
4. VPN Status (ProtonVPN WireGuard pool)
5. VPN Rotate (switch to next AU server)
6. VPN Disconnect
7. Exit
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
        await vpnStatus();
        break;
      case '5':
        await vpnRotate();
        break;
      case '6':
        await vpnDisconnect();
        break;
      case '7': 
        vpnDown();
        rl.close();
        return;
    }
    menu();
  });
}

// Init ProtonVPN WireGuard config pool on startup
initProxies();
menu();
