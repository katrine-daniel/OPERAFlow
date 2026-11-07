import { defineConfig, devices } from '@playwright/test';

/**
 * Browser end-to-end tests of the whole stack: real API (built), real Next.js app, real PostgreSQL test database.
 * Run: npm run e2e   (requires `npm run dev:db` and a built API; uses ports 4100/3100 and the *_test database)
 */
const TEST_DB = process.env.TEST_DATABASE_URL ?? 'postgresql://operaflow:operaflow_local_dev@127.0.0.1:5433/operaflow_test';
const WEB = 'http://localhost:3100';

export default defineConfig({
  testDir: '.',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { outputFolder: '../playwright-report', open: 'never' }]],
  globalSetup: './global-setup.ts',
  use: { baseURL: WEB, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 860 } }, testIgnore: /mobile\.spec/ },
    { name: 'mobile', use: { ...devices['Pixel 7'] }, testMatch: /mobile\.spec/ },
  ],
  webServer: [
    {
      command: 'node apps/api/dist/main.js',
      cwd: '..',
      url: 'http://127.0.0.1:4100/health',
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        NODE_ENV: 'test',
        API_PORT: '4100',
        DATABASE_URL: TEST_DB,
        WEB_ORIGINS: WEB,
        APP_BASE_URL: WEB,
        ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
        LOGIN_RATE_LIMIT_PER_MINUTE: '1000',
        RATE_LIMIT_PER_MINUTE: '100000',
        DEFAULT_TIMEZONE: 'Asia/Dubai',
        STORAGE_DIR: '.data/e2e-storage',
        TEST_RUNNER_MODE: 'inline',
        AUTO_LOGIN_EMAIL: '', // E2E tests the real sign-in form
        COOKIE_SECURE: 'false',
      },
    },
    {
      command: 'npx next dev -p 3100',
      cwd: '../apps/web',
      url: `${WEB}/login`,
      reuseExistingServer: false,
      timeout: 180_000,
      env: { API_INTERNAL_URL: 'http://127.0.0.1:4100', NEXT_TELEMETRY_DISABLED: '1', DEFAULT_TIMEZONE: 'Asia/Dubai', NEXT_DIST_DIR: '.next-e2e' },
    },
  ],
});
