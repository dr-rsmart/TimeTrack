import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:4001',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    {
      command: 'npm run dev:frontend',
      url: 'http://localhost:4001',
      reuseExistingServer: !process.env.CI,
    },
    {
      command: 'npm run dev:server',
      url: 'http://localhost:5001/api/auth/me',
      reuseExistingServer: !process.env.CI,
    },
  ],
});
