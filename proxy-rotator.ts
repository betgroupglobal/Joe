// proxy-rotator.ts — Hysteria2 SOCKS5 proxy rotation via SSH tunnels
// Each proxy maps to a Hysteria2 client instance on the EC2 server,
// tunneled to localhost via SSH port forwarding.

export interface ProxySlot {
  name: string;
  url: string;        // socks5://127.0.0.1:<port>
  port: number;
  successes: number;
  failures: number;
  lastUsed: number;   // timestamp
}

// Default: 10 SSH-tunneled SOCKS5 ports (10801–10810) mapping to
// EC2 Hysteria2 client instances on ports 1080–1089.
const DEFAULT_BASE_PORT = 10801;
const DEFAULT_COUNT     = 10;

let slots: ProxySlot[] = [];
let currentIndex = 0;

/** Initialise the proxy pool. Call once at startup. */
export function initProxies(
  basePort: number = DEFAULT_BASE_PORT,
  count: number    = DEFAULT_COUNT,
): ProxySlot[] {
  slots = [];
  for (let i = 0; i < count; i++) {
    const port = basePort + i;
    slots.push({
      name:      `hy2-${i + 1}`,
      url:       `socks5://127.0.0.1:${port}`,
      port,
      successes: 0,
      failures:  0,
      lastUsed:  0,
    });
  }
  currentIndex = 0;
  console.log(`[proxy] Initialised ${slots.length} Hysteria2 SOCKS5 proxies (ports ${basePort}–${basePort + count - 1})`);
  return slots;
}

/** Get the next proxy in round-robin order. */
export function nextProxy(): ProxySlot {
  if (slots.length === 0) initProxies();
  const slot = slots[currentIndex];
  slot.lastUsed = Date.now();
  currentIndex = (currentIndex + 1) % slots.length;
  return slot;
}

/** Get a specific proxy by index (0-based). */
export function getProxy(index: number): ProxySlot {
  if (slots.length === 0) initProxies();
  return slots[index % slots.length];
}

/** Record a successful request through a proxy. */
export function recordSuccess(slot: ProxySlot): void {
  slot.successes++;
}

/** Record a failed request through a proxy. */
export function recordFail(slot: ProxySlot): void {
  slot.failures++;
}

/** Get all proxy slots (for stats/logging). */
export function getAllProxies(): ProxySlot[] {
  if (slots.length === 0) initProxies();
  return [...slots];
}

/** Print a summary of proxy usage stats. */
export function printProxyStats(): void {
  console.log('\n[proxy] ─── Proxy Usage Stats ───');
  for (const s of slots) {
    const total = s.successes + s.failures;
    const rate  = total > 0 ? ((s.successes / total) * 100).toFixed(0) : 'N/A';
    console.log(`  ${s.name} (port ${s.port}): ${s.successes}/${total} ok (${rate}%)`);
  }
  console.log('[proxy] ─────────────────────────\n');
}
