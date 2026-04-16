import { test, expect } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';

// Import the loadCreds function directly
const { loadCreds } = require('../../login-auto');

const FIXTURE_CREDS = path.resolve(__dirname, '../fixtures/test-creds.txt');

test.describe('Credential Loading (loadCreds)', () => {

  test('parses colon-separated credentials', () => {
    const creds = loadCreds(FIXTURE_CREDS);
    const colonCred = creds.find((c: any) => c.username === 'user1@example.com');
    expect(colonCred).toBeTruthy();
    expect(colonCred.password).toBe('password123');
  });

  test('parses comma-separated credentials', () => {
    const creds = loadCreds(FIXTURE_CREDS);
    const commaCred = creds.find((c: any) => c.username === 'user2@test.com');
    expect(commaCred).toBeTruthy();
    expect(commaCred.password).toBe('mypass456');
  });

  test('parses pipe-separated credentials', () => {
    const creds = loadCreds(FIXTURE_CREDS);
    const pipeCred = creds.find((c: any) => c.username === 'user3');
    expect(pipeCred).toBeTruthy();
    expect(pipeCred.password).toBe('simplepass');
  });

  test('skips comment lines', () => {
    const creds = loadCreds(FIXTURE_CREDS);
    const commentLine = creds.find((c: any) => c.username.startsWith('#'));
    expect(commentLine).toBeUndefined();
  });

  test('skips lines without separators', () => {
    const creds = loadCreds(FIXTURE_CREDS);
    const noSep = creds.find((c: any) => c.username === 'badlinenoseparator');
    expect(noSep).toBeUndefined();
  });

  test('handles numeric usernames', () => {
    const creds = loadCreds(FIXTURE_CREDS);
    const numCred = creds.find((c: any) => c.username === '344578584');
    expect(numCred).toBeTruthy();
    expect(numCred.password).toBe('numericuser');
  });

  test('handles spaces in credentials', () => {
    const creds = loadCreds(FIXTURE_CREDS);
    const spaceCred = creds.find((c: any) => c.username === 'user with spaces@gmail.com');
    expect(spaceCred).toBeTruthy();
    expect(spaceCred.password).toBe('pass word');
  });

  test('returns correct total count (excluding comments and bad lines)', () => {
    const creds = loadCreds(FIXTURE_CREDS);
    // user1, user2, user3, 344578584, user with spaces = 5 valid creds
    expect(creds.length).toBe(5);
  });

  test('throws on missing file', () => {
    expect(() => loadCreds('/nonexistent/creds.txt')).toThrow();
  });
});
