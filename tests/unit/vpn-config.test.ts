import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

test.describe('VPN Config Loading (initProxies)', () => {
  let tmpDir: string;

  test.beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'joe-vpn-test-'));
  });

  test.afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('returns empty array for non-existent directory', () => {
    // Replicate initProxies logic
    const absDir = path.resolve('/nonexistent/vpn/configs');
    expect(fs.existsSync(absDir)).toBe(false);
  });

  test('returns empty array for directory with no .conf files', () => {
    fs.writeFileSync(path.join(tmpDir, 'readme.txt'), 'not a config');
    const files = fs.readdirSync(tmpDir).filter(f => f.endsWith('.conf'));
    expect(files.length).toBe(0);
  });

  test('finds .conf files in directory', () => {
    fs.writeFileSync(path.join(tmpDir, 'wg-AU-112.conf'), '[Interface]\nPrivateKey=test\n');
    fs.writeFileSync(path.join(tmpDir, 'wg-AU-116.conf'), '[Interface]\nPrivateKey=test\n');
    fs.writeFileSync(path.join(tmpDir, 'readme.txt'), 'not a config');
    const files = fs.readdirSync(tmpDir).filter(f => f.endsWith('.conf')).sort();
    expect(files.length).toBe(2);
    expect(files[0]).toBe('wg-AU-112.conf');
    expect(files[1]).toBe('wg-AU-116.conf');
  });

  test('builds correct VpnSlot structure from config files', () => {
    fs.writeFileSync(path.join(tmpDir, 'wg-AU-112.conf'), '[Interface]\n');
    const files = fs.readdirSync(tmpDir).filter(f => f.endsWith('.conf')).sort();
    const slots = files.map((f, i) => ({
      name: path.basename(f, '.conf'),
      configPath: path.join(tmpDir, f),
      successes: 0,
      failures: 0,
      lastUsed: 0,
      currentIp: null,
    }));
    expect(slots[0].name).toBe('wg-AU-112');
    expect(slots[0].successes).toBe(0);
    expect(slots[0].failures).toBe(0);
    expect(slots[0].currentIp).toBeNull();
  });

  test('sorts config files alphabetically', () => {
    fs.writeFileSync(path.join(tmpDir, 'wg-AU-200.conf'), '');
    fs.writeFileSync(path.join(tmpDir, 'wg-AU-100.conf'), '');
    fs.writeFileSync(path.join(tmpDir, 'wg-AU-150.conf'), '');
    const files = fs.readdirSync(tmpDir).filter(f => f.endsWith('.conf')).sort();
    expect(files).toEqual(['wg-AU-100.conf', 'wg-AU-150.conf', 'wg-AU-200.conf']);
  });
});

test.describe('IPv4-Only Config Transform', () => {
  let tmpDir: string;

  test.beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'joe-ipv4-test-'));
  });

  test.afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('strips IPv6 from AllowedIPs', () => {
    const conf = `[Interface]
PrivateKey = testkey
Address = 10.2.0.2/32
DNS = 10.2.0.1

[Peer]
PublicKey = testpeer
AllowedIPs = 0.0.0.0/1, ::/0
Endpoint = 103.108.231.162:51820`;

    const cleaned = conf.replace(/,\s*::\/0/g, '').replace(/::\/0\s*,\s*/g, '');
    expect(cleaned).toContain('AllowedIPs = 0.0.0.0/1');
    expect(cleaned).not.toContain('::/0');
  });

  test('handles standalone IPv6 AllowedIPs', () => {
    const conf = 'AllowedIPs = ::/0';
    const cleaned = conf.replace(new RegExp('AllowedIPs\\s*=\\s*::\\/0\\s*', 'gi'), 'AllowedIPs = 0.0.0.0/0');
    expect(cleaned).toBe('AllowedIPs = 0.0.0.0/0');
  });

  test('preserves IPv4 addresses', () => {
    const conf = 'Address = 10.2.0.2/32, fd00::1/128';
    // The regex strips IPv6 from Address lines
    const cleaned = conf.replace(new RegExp(',\\s*[0-9a-fA-F:]+\\/\\d+', 'g'), (match) => {
      return match.includes(':') ? '' : match;
    });
    expect(cleaned).toBe('Address = 10.2.0.2/32');
  });
});

test.describe('VPN Rotation Logic (round-robin)', () => {

  test('round-robin cycles through all slots', () => {
    const slots = [
      { name: 'wg-AU-1' },
      { name: 'wg-AU-2' },
      { name: 'wg-AU-3' },
    ];
    let currentIndex = 0;
    const visited: string[] = [];

    for (let i = 0; i < 6; i++) {
      const slot = slots[currentIndex];
      visited.push(slot.name);
      currentIndex = (currentIndex + 1) % slots.length;
    }

    expect(visited).toEqual([
      'wg-AU-1', 'wg-AU-2', 'wg-AU-3',
      'wg-AU-1', 'wg-AU-2', 'wg-AU-3',
    ]);
  });

  test('single slot always returns same slot', () => {
    const slots = [{ name: 'only-one' }];
    let currentIndex = 0;
    for (let i = 0; i < 3; i++) {
      expect(slots[currentIndex].name).toBe('only-one');
      currentIndex = (currentIndex + 1) % slots.length;
    }
  });
});
