/**
 * One-time Salesforce login helper.
 * Opens a visible Chrome window, fills username + password, then waits for YOU to finish
 * "Verify Your Identity" (passkey / code). Saves the session to .auth/sf.json for the tests.
 *
 * Run:  npm run sf:login
 */
import { chromium } from '@playwright/test';
import fs from 'node:fs';

if (fs.existsSync('.env')) process.loadEnvFile('.env');

const SF_URL = process.env.SF_URL!;
const SF_AUTH_FILE = '.auth/sf.json';

(async () => {
  const browser = await chromium.launch({ headless: false, channel: 'chrome' }).catch(() => chromium.launch({ headless: false }));
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  await page.goto(SF_URL);
  await page.locator('#username').fill(process.env.SF_USER!);
  const password = page.locator('#password');
  if (!(await password.isVisible())) await page.locator('#Login').click(); // username-first login screen
  await password.fill(process.env.SF_PASS!);
  await page.locator('#Login').click();

  console.log('\n>>> If Salesforce shows "Verify Your Identity", complete it in the Chrome window.');
  console.log('>>> Waiting up to 10 minutes for Salesforce to finish loading...\n');
  await page.waitForURL(/lightning\.force\.com\/lightning\//, { timeout: 10 * 60_000 });
  await page.waitForLoadState('load');

  fs.mkdirSync('.auth', { recursive: true });
  await context.storageState({ path: SF_AUTH_FILE });
  console.log(`Saved Salesforce session to ${SF_AUTH_FILE}`);
  await browser.close();
})();
