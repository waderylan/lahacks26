import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests', workers: 1, timeout: 120000,
  expect: { timeout: 15000 },
  use: { baseURL: process.env.RULES_TEST_URL ?? 'http://localhost:5174', channel: process.env.RULES_BROWSER ?? 'chrome', viewport: { width: 1600, height: 1000 }, screenshot: 'only-on-failure', trace: 'retain-on-failure' },
});
