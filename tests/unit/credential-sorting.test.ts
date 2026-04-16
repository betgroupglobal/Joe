import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

test.describe('Credential Sorting Logic', () => {
  // Replicate the sorting logic from login-auto.ts to test it in isolation
  type LoginOutcome = "success" | "wrong_credentials" | "rate_limited" | "account_locked" | "captcha_block" | "2fa_required" | "unknown";

  const outcomeToFolder: Record<LoginOutcome, string> = {
    success:           'success',
    '2fa_required':    'success',
    wrong_credentials: 'wrong_credentials',
    account_locked:    'locked',
    captcha_block:     'captcha',
    rate_limited:      'rate_limited',
    unknown:           'unknown',
  };

  let tmpDir: string;

  test.beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'joe-sort-test-'));
  });

  test.afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('success outcomes go to success/ folder', () => {
    const folder = outcomeToFolder['success'];
    expect(folder).toBe('success');
    const tPath = path.join(tmpDir, folder);
    fs.mkdirSync(tPath, { recursive: true });
    fs.appendFileSync(path.join(tPath, 'creds.txt'), 'user@test.com:pass\n');
    expect(fs.readFileSync(path.join(tPath, 'creds.txt'), 'utf8')).toContain('user@test.com:pass');
  });

  test('2fa_required outcomes go to success/ folder', () => {
    expect(outcomeToFolder['2fa_required']).toBe('success');
  });

  test('wrong_credentials outcomes go to wrong_credentials/ folder', () => {
    expect(outcomeToFolder['wrong_credentials']).toBe('wrong_credentials');
  });

  test('account_locked outcomes go to locked/ folder', () => {
    expect(outcomeToFolder['account_locked']).toBe('locked');
  });

  test('captcha_block outcomes go to captcha/ folder', () => {
    expect(outcomeToFolder['captcha_block']).toBe('captcha');
  });

  test('rate_limited outcomes go to rate_limited/ folder', () => {
    expect(outcomeToFolder['rate_limited']).toBe('rate_limited');
  });

  test('unknown outcomes go to unknown/ folder', () => {
    expect(outcomeToFolder['unknown']).toBe('unknown');
  });

  test('every LoginOutcome has a folder mapping', () => {
    const outcomes: LoginOutcome[] = ['success', 'wrong_credentials', 'rate_limited', 'account_locked', 'captcha_block', '2fa_required', 'unknown'];
    for (const o of outcomes) {
      expect(outcomeToFolder[o]).toBeTruthy();
    }
  });
});

test.describe('Credential Removal (exact match)', () => {
  let tmpCredsFile: string;

  test.beforeEach(() => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'joe-cred-remove-'));
    tmpCredsFile = path.join(tmpDir, 'creds.txt');
  });

  test.afterEach(() => {
    fs.rmSync(path.dirname(tmpCredsFile), { recursive: true, force: true });
  });

  test('removes exact credential match without affecting similar entries', () => {
    const initial = [
      'user@test.com:password123',
      'user@test.com.au:password456',
      'otheruser@test.com:password123',
      '# comment line',
      '',
    ].join('\n');
    fs.writeFileSync(tmpCredsFile, initial);

    const username = 'user@test.com';
    const password = 'password123';

    // Replicate the removal logic from login-auto.ts
    const rawCreds = fs.readFileSync(tmpCredsFile, 'utf8');
    const filtered = rawCreds.split('\n').filter(l => {
      if (!l.trim() || l.trim().startsWith('#')) return true;
      const trimmed = l.trim();
      const sep = trimmed.includes(':') ? ':' : trimmed.includes(',') ? ',' : '|';
      const idx = trimmed.indexOf(sep);
      if (idx === -1) return true;
      return !(trimmed.slice(0, idx).trim() === username && trimmed.slice(idx + 1).trim() === password);
    });
    fs.writeFileSync(tmpCredsFile, filtered.join('\n'));

    const result = fs.readFileSync(tmpCredsFile, 'utf8');
    const lines = result.split('\n').map(l => l.trim()).filter(Boolean);
    // The exact line 'user@test.com:password123' should be gone
    expect(lines).not.toContain('user@test.com:password123');
    // These should still be present
    expect(lines).toContain('user@test.com.au:password456');
    expect(lines).toContain('otheruser@test.com:password123');
    expect(lines).toContain('# comment line');
  });

  test('preserves comment lines and empty lines', () => {
    const initial = '# header\nuser@a.com:pass\n\n# footer\n';
    fs.writeFileSync(tmpCredsFile, initial);

    const rawCreds = fs.readFileSync(tmpCredsFile, 'utf8');
    const filtered = rawCreds.split('\n').filter(l => {
      if (!l.trim() || l.trim().startsWith('#')) return true;
      const trimmed = l.trim();
      const sep = trimmed.includes(':') ? ':' : trimmed.includes(',') ? ',' : '|';
      const idx = trimmed.indexOf(sep);
      if (idx === -1) return true;
      return !(trimmed.slice(0, idx).trim() === 'user@a.com' && trimmed.slice(idx + 1).trim() === 'pass');
    });
    fs.writeFileSync(tmpCredsFile, filtered.join('\n'));

    const result = fs.readFileSync(tmpCredsFile, 'utf8');
    expect(result).toContain('# header');
    expect(result).toContain('# footer');
    expect(result).not.toContain('user@a.com:pass');
  });
});
