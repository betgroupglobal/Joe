import { chromium, Browser, LaunchOptions } from 'playwright';
import { STEALTH_LAUNCH_ARGS, STEALTH_UA, getStealthContextOptions, humanType, simulateHuman, injectDeepStealth, randDelay } from './stealth-utils';

import * as readline from 'readline';
import { scanLogin } from './scanner';
import { initProxies, nextProxy, getAllProxies, printProxyStats } from './proxy-rotator';

async function launchBrowser() {
  const proxy = nextProxy();
  const proxyUrl = proxy.url;
  console.log(`[menu] Using proxy: ${proxy.name} (${proxyUrl})`);
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

async function proxyStatus() {
  const proxies = getAllProxies();
  console.log(`\n[proxy] ${proxies.length} Hysteria2 SOCKS5 proxies available:`);
  for (const p of proxies) {
    console.log(`  ${p.name}: ${p.url} | ok:${p.successes} fail:${p.failures}`);
  }
  printProxyStats();
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

async function menu() {
  console.clear();
  console.log(`
Joe Stealth Menu:
1. Launch Stealth Browser (via Hysteria2 proxy)
2. Scan Login Form (enter URL)
3. View Recent Logs
4. Proxy Status (Hysteria2 SOCKS5 pool)
5. Exit
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
        await proxyStatus();
        break;
      case '5': 
        rl.close();
        return;
    }
    menu();
  });
}

// Init Hysteria2 proxy pool on startup
initProxies();
menu();

