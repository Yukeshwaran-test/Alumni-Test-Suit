import { defineConfig, devices } from '@playwright/test';
import fs from 'node:fs';

if (fs.existsSync('.env')) process.loadEnvFile('.env');

export const AUTH_FILE = '.auth/user.json';
export const SF_AUTH_FILE = '.auth/sf.json';
export const RECEIVER_AUTH_FILE = '.auth/receiver.json';

const SHOW_BROWSER = !process.env.CI && !process.env.HEADLESS;
export const VIEWPORT = { width: 1366, height: 900 };

/**
 * Module suites (Events, Network): run in real Google Chrome and record every action
 * (trace + video + screenshots) into the HTML report, pass or fail.
 */
const visibleChromeModule = {
  dependencies: ['setup'],
  timeout: 300_000,
  // One test at a time while Chrome is visible, so windows don't pile up.
  workers: SHOW_BROWSER ? 1 : undefined,
  use: {
    ...devices['Desktop Chrome'],
    channel: 'chrome',
    // Chrome is visible by default so you can watch each screen. HEADLESS=1 (or CI) hides it.
    headless: !SHOW_BROWSER,
    // Pause before every action so it's easy to follow; SLOWMO=<ms> overrides (0 = full speed).
    launchOptions: {
      slowMo: process.env.SLOWMO !== undefined ? Number(process.env.SLOWMO) : SHOW_BROWSER ? 300 : 0,
      args: ['--start-maximized'],
    },
    viewport: VIEWPORT,
    storageState: AUTH_FILE,
    trace: 'on' as const,
    video: 'on' as const,
    screenshot: 'on' as const,
  },
};

export default defineConfig({
  testDir: './tests',
  // Salesforce Experience Cloud pages are slow to hydrate.
  timeout: 120_000,
  expect: { timeout: 30_000 },
  retries: process.env.CI ? 2 : 0,
  workers: 2,
  reporter: [
    ['list'],
    ['html', { open: 'never' }],
    ['json', { outputFile: 'test-results/results.json' }],
    ['junit', { outputFile: 'test-results/junit.xml' }],
    // Test Case ID / Module / Scenario / Steps / Data / Expected / Actual / Status sheet (reports/registration-results.*).
    ['./utils/caseReporter.ts'],
  ],
  use: {
    baseURL: process.env.BASE_URL,
    viewport: { width: 1366, height: 800 },
    navigationTimeout: 90_000,
    actionTimeout: 30_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    { name: 'setup-receiver', testMatch: /auth-receiver\.setup\.ts/ },
    {
      // Login/logout flows start from a clean, unauthenticated browser.
      name: 'login',
      testMatch: /login\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 800 } },
    },
    {
      name: 'portal',
      testMatch: /home\.spec\.ts/,
      dependencies: ['setup'],
      use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 800 }, storageState: AUTH_FILE },
    },
    {
      name: 'events',
      testDir: './tests/events',
      ...visibleChromeModule,
    },
    {
      // Two users (sender = ALUMNI_USER, receiver = NET_RECEIVER_USER) each get their own Chrome window.
      name: 'network',
      testDir: './tests/network',
      ...visibleChromeModule,
      dependencies: ['setup', 'setup-receiver'],
    },
    {
      // Public Alumni Registration + Reset Password (logged out). No shared login needed.
      name: 'registration',
      testDir: './tests/registration',
      ...visibleChromeModule,
      dependencies: [],
      // The e2e waits for real e-mail (OTP ~1 min, Magic Link) — give it room.
      timeout: 600_000,
      use: { ...visibleChromeModule.use, storageState: undefined },
    },
    {
      // Mentorship, Fundraise, Groups, Business Directory, Feedback & Survey, Service & Support.
      name: 'modules',
      testDir: './tests/modules',
      ...visibleChromeModule,
    },
  ],
});
