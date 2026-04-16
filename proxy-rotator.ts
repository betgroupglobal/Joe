// proxy-rotator.ts — ProtonVPN WireGuard IP rotation
// Rotates through ProtonVPN AU WireGuard configs to get fresh IPs.
// Each rotation does: wg-quick down <current> → wg-quick up <next>
// Traffic flows directly through the VPN interface (no SOCKS5 proxy needed).

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

export interface VpnSlot {
  name: string;        // e.g. "proton-AU-1"
  configPath: string;  // absolute path to .conf file
  successes: number;
  failures: number;
  lastUsed: number;    // timestamp
  currentIp: string | null;
}

// ─── Config ────────────────────────────────────────────────────────────────────

const DEFAULT_CONFIG_DIR = process.env.PROTON_CONFIG_DIR || './proton_configs';

let slots: VpnSlot[] = [];
let currentIndex = 0;
let activeSlot: VpnSlot | null = null;

// ─── Helpers ───────────────────────────────────────────────────────────────────

function shell(cmd: string): string {
  try {
    return execSync(cmd, { encoding: 'utf8', timeout: 15000 }).trim();
  } catch (err: any) {
    console.error(`[vpn] shell error: ${err.message?.split('\n')[0]}`);
    return '';
  }
}

/** Get current public IP (with timeout). */
export function getPublicIp(): string | null {
  try {
    const ip = shell('curl -s --max-time 5 https://ifconfig.me');
    return ip || null;
  } catch {
    return null;
  }
}

// ─── Init ──────────────────────────────────────────────────────────────────────

/** Scan a directory for WireGuard .conf files and build the VPN pool. */
export function initProxies(configDir: string = DEFAULT_CONFIG_DIR): VpnSlot[] {
  const absDir = path.resolve(configDir);

  if (!fs.existsSync(absDir)) {
    console.error(`[vpn] Config directory not found: ${absDir}`);
    console.error(`[vpn] Create it and add ProtonVPN WireGuard .conf files.`);
    console.error(`[vpn] Or set PROTON_CONFIG_DIR env var to the correct path.`);
    return slots;
  }

  const files = fs.readdirSync(absDir)
    .filter(f => f.endsWith('.conf'))
    .sort();

  if (files.length === 0) {
    console.error(`[vpn] No .conf files found in ${absDir}`);
    return slots;
  }

  slots = files.map((f, i) => ({
    name:       path.basename(f, '.conf'),
    configPath: path.join(absDir, f),
    successes:  0,
    failures:   0,
    lastUsed:   0,
    currentIp:  null,
  }));

  currentIndex = 0;
  console.log(`[vpn] Loaded ${slots.length} ProtonVPN WireGuard configs from ${absDir}`);
  for (const s of slots) {
    console.log(`  • ${s.name}`);
  }
  return slots;
}

// ─── VPN control ───────────────────────────────────────────────────────────────

/** Bring down the currently active VPN tunnel. */
export function vpnDown(): boolean {
  if (!activeSlot) return true;
  console.log(`[vpn] Bringing down ${activeSlot.name}...`);
  const result = shell(`sudo wg-quick down "${activeSlot.configPath}" 2>&1`);
  console.log(`[vpn] ${result || 'done'}`);
  activeSlot = null;
  return true;
}

/** Bring up a specific VPN tunnel by slot. */
export function vpnUp(slot: VpnSlot): boolean {
  // Bring down current first
  if (activeSlot) vpnDown();

  console.log(`[vpn] Bringing up ${slot.name}...`);
  const result = shell(`sudo wg-quick up "${slot.configPath}" 2>&1`);

  // Check for specific WireGuard failure patterns (avoid false positives on benign output)
  const failPatterns = ['RTNETLINK', 'Cannot find device', 'Operation not permitted', 'No such file'];
  if (failPatterns.some(p => result.includes(p))) {
    console.error(`[vpn] Failed to bring up ${slot.name}: ${result}`);
    return false;
  }

  console.log(`[vpn] ${result || 'done'}`);
  activeSlot = slot;

  // Get the new public IP
  const ip = getPublicIp();
  slot.currentIp = ip;
  if (ip) {
    console.log(`[vpn] Public IP: ${ip}`);
  }

  return true;
}

/** Rotate to the next VPN config in round-robin order. Returns the new active slot. */
export function rotate(): VpnSlot | null {
  if (slots.length === 0) {
    console.error('[vpn] No VPN configs loaded. Call initProxies() first.');
    return null;
  }

  const slot = slots[currentIndex];
  slot.lastUsed = Date.now();
  currentIndex = (currentIndex + 1) % slots.length;

  if (!vpnUp(slot)) {
    console.warn(`[vpn] Failed to activate ${slot.name}, trying next...`);
    // Try the next one
    const nextSlot = slots[currentIndex];
    currentIndex = (currentIndex + 1) % slots.length;
    if (!vpnUp(nextSlot)) {
      console.error('[vpn] Failed to activate fallback VPN. Proceeding without VPN.');
      return null;
    }
    return nextSlot;
  }

  return slot;
}

/** Get the currently active VPN slot (or null). */
export function getActiveSlot(): VpnSlot | null {
  return activeSlot;
}

// ─── Stats ─────────────────────────────────────────────────────────────────────

export function recordSuccess(slot: VpnSlot): void {
  slot.successes++;
}

export function recordFail(slot: VpnSlot): void {
  slot.failures++;
}

export function getAllProxies(): VpnSlot[] {
  return [...slots];
}

export function printProxyStats(): void {
  console.log('\n[vpn] ─── VPN Usage Stats ───');
  for (const s of slots) {
    const total = s.successes + s.failures;
    const rate  = total > 0 ? ((s.successes / total) * 100).toFixed(0) : 'N/A';
    console.log(`  ${s.name}: ${s.successes}/${total} ok (${rate}%) | last IP: ${s.currentIp ?? 'N/A'}`);
  }
  if (activeSlot) {
    console.log(`  Active: ${activeSlot.name} (${activeSlot.currentIp ?? 'unknown IP'})`);
  } else {
    console.log('  Active: none');
  }
  console.log('[vpn] ──────────────────────\n');
}
