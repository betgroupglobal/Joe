import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 120_000,
  retries: 1,
  workers: 1, // Sequential — VPN can only have one active tunnel
  reporter: [
    ['list'],
    ['json', { outputFile: 'test-results/results.json' }],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
  ],
  use: {
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'unit',
      testMatch: /unit\/.+\.test\.ts$/,
      timeout: 30_000,
    },
    {
      name: 'integration',
      testMatch: /integration\/.+\.test\.ts$/,
      timeout: 60_000,
    },
    {
      name: 'live',
      testMatch: /live\/.+\.test\.ts$/,
      timeout: 180_000,
    },
  ],
});
