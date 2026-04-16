// proxy-rotator.ts — ProtonVPN WireGuard IP rotation
// Rotates through ProtonVPN AU WireGuard configs to get fresh IPs.
// Each rotation does: wg-quick down <current> → wg-quick up <next>
// Traffic flows directly through the VPN interface (no SOCKS5 proxy needed).
//
// Optimizations:
//   - Cached IPv4 configs: generates once per config, reuses from memory
//   - Smart rotation: skips VPN slots with >70% failure rate (min 3 attempts)
//   - Faster IP check: reduced timeout, uses icanhazip.com as fallback

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

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

/** Get current public IPv4 (force -4 to avoid IPv6). Uses fast endpoints with fallback. */
export function getPublicIp(): string | null {
  try {
    // Primary: icanhazip is faster than ifconfig.me
    let ip = shell('curl -4 -s --max-time 3 https://icanhazip.com');
    if (ip && /^\d+\.\d+\.\d+\.\d+$/.test(ip)) return ip;
    // Fallback
    ip = shell('curl -4 -s --max-time 3 https://ifconfig.me');
    return (ip && /^\d+\.\d+\.\d+\.\d+$/.test(ip)) ? ip : null;
  } catch {
    return null;
  }
}

/**
 * Create an IPv4-only copy of a WireGuard config.
 * Strips ::/0 and any IPv6 addresses from AllowedIPs and Address,
 * and sets permissions to 600 to avoid the 'world accessible' warning.
 * 
 * Optimized: caches generated configs in memory to avoid repeated file I/O.
 */
const ipv4ConfigCache = new Map<string, string>();

function makeIpv4OnlyConfig(originalPath: string): string {
  // Return cached config if already generated
  const cached = ipv4ConfigCache.get(originalPath);
  if (cached && fs.existsSync(cached)) return cached;

  const tmpDir = path.join(os.tmpdir(), 'joe-vpn-configs');
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true, mode: 0o700 });

  const basename = path.basename(originalPath);
  const tmpPath  = path.join(tmpDir, basename);

  let content = fs.readFileSync(originalPath, 'utf8');

  // Remove IPv6 from AllowedIPs: strip ', ::/0' or '::/0, ' or standalone '::/0'
  content = content.replace(/,\s*::\/0/g, '');
  content = content.replace(/::\/0\s*,\s*/g, '');
  content = content.replace(new RegExp('AllowedIPs\\s*=\\s*::\\/0\\s*', 'gi'), 'AllowedIPs = 0.0.0.0/0');

  // Remove IPv6 from Address lines: strip ', <ipv6>/prefix' or '<ipv6>/prefix, '
  content = content.replace(new RegExp(',\\s*[0-9a-fA-F:]+\\/\\d+', 'g'), (match) => {
    return match.includes(':') ? '' : match;
  });
  content = content.replace(new RegExp('[0-9a-fA-F:]+\\/\\d+\\s*,\\s*', 'g'), (match) => {
    return match.includes(':') ? '' : match;
  });

  fs.writeFileSync(tmpPath, content, { mode: 0o600 });
  ipv4ConfigCache.set(originalPath, tmpPath);
  return tmpPath;
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
  console.log(`[vpn] ${slots.length} configs loaded`);
  return slots;
}

// ─── VPN control ───────────────────────────────────────────────────────────────

/** Bring down the currently active VPN tunnel. */
export function vpnDown(): boolean {
  if (!activeSlot) return true;
  const ipv4Conf = makeIpv4OnlyConfig(activeSlot.configPath);
  shell(`sudo wg-quick down "${ipv4Conf}" 2>&1`);
  activeSlot = null;
  return true;
}

/** Bring up a specific VPN tunnel by slot. */
export function vpnUp(slot: VpnSlot): boolean {
  // Bring down current first
  if (activeSlot) vpnDown();

  const ipv4Conf = makeIpv4OnlyConfig(slot.configPath);
  const result = shell(`sudo wg-quick up "${ipv4Conf}" 2>&1`);

  // Check for specific WireGuard failure patterns (avoid false positives on benign output)
  const failPatterns = ['RTNETLINK', 'Cannot find device', 'Operation not permitted', 'No such file'];
  if (failPatterns.some(p => result.includes(p))) {
    console.error(`[vpn] Failed: ${slot.name}`);
    return false;
  }

  activeSlot = slot;
  const ip = getPublicIp();
  slot.currentIp = ip;
  console.log(`[vpn] ${slot.name} → ${ip || '?'}`);

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
    // Failed, trying next
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

/**
 * Smart rotation: picks the best VPN slot based on success rate.
 * Skips slots with >70% failure rate (min 3 attempts) to avoid known-bad servers.
 * Falls back to regular round-robin if all slots are exhausted.
 */
export function smartRotate(): VpnSlot | null {
  if (slots.length === 0) {
    console.error('[vpn] No VPN configs loaded. Call initProxies() first.');
    return null;
  }

  const MIN_ATTEMPTS_FOR_SKIP = 3;
  const MAX_FAILURE_RATE = 0.7;

  // Try up to slots.length candidates
  for (let tries = 0; tries < slots.length; tries++) {
    const slot = slots[currentIndex];
    currentIndex = (currentIndex + 1) % slots.length;

    const total = slot.successes + slot.failures;
    if (total >= MIN_ATTEMPTS_FOR_SKIP) {
      const failRate = slot.failures / total;
      if (failRate > MAX_FAILURE_RATE) {
        // Skip high-fail-rate slot
        continue;
      }
    }

    slot.lastUsed = Date.now();
    if (vpnUp(slot)) return slot;
  }

  // All slots skipped or failed — force round-robin as last resort
  console.warn('[vpn] All preferred slots exhausted — falling back to round-robin');
  return rotate();
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
