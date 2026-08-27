import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.ts',
  testIgnore: ['**/perf/**', '**/node_modules/**', '**/*.test.ts'],
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [['html', { open: 'never' }], ['list']],
  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  // ── Self-booting E2E servers ──
  // Restored 2026-08-27 (Audit Cycle 16): the webServer array guarantees a
  // green Playwright run requires a LIVE API and web server — `npm run
  // test:e2e` (and the CI step) can no longer silently degrade against a dead
  // backend. Locally an already-running dev stack is reused (reuseExistingServer);
  // in CI Playwright boots both services itself.
  webServer: [
    {
      command: 'npm run dev',
      cwd: 'server',
      url: 'http://localhost:4000/ping',
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
    },
    {
      command: 'npm run dev:web',
      url: 'http://localhost:5173',
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
    },
  ],
});
