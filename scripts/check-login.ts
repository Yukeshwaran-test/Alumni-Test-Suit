/**
 * Quick check (~30 s) that the two portal accounts in .env can log in.
 * Prints the portal's own answer for each account, e.g. "Wrong Email or Password".
 *
 * Run:  npm run check:login
 */
import { chromium } from '@playwright/test';
import fs from 'node:fs';

if (fs.existsSync('.env')) process.loadEnvFile('.env');

const ACCOUNTS = [
  { name: 'Main user (ALUMNI_USER / ALUMNI_PASS)', user: process.env.ALUMNI_USER!, pass: process.env.ALUMNI_PASS! },
  { name: 'Network receiver (NET_RECEIVER_USER / NET_RECEIVER_PASS)', user: process.env.NET_RECEIVER_USER!, pass: process.env.NET_RECEIVER_PASS! },
];

(async () => {
  const browser = await chromium.launch();
  let ok = 0;
  for (const a of ACCOUNTS) {
    const page = await (await browser.newContext()).newPage();
    let serverError = '';
    page.on('response', async (r) => {
      if (/apex\/execute/.test(r.url()) && r.status() >= 400) {
        try { serverError = JSON.parse(await r.text()).error?.[0]?.message ?? `HTTP ${r.status()}`; } catch { serverError = `HTTP ${r.status()}`; }
      }
    });
    await page.goto(process.env.BASE_URL!);
    await page.getByRole('textbox', { name: /^Email/ }).fill(a.user);
    await page.getByPlaceholder('Enter password').fill(a.pass);
    await page.getByRole('button', { name: 'Login', exact: true }).click();
    const loggedIn = await page.waitForURL((u) => !/\/login/.test(u.pathname), { timeout: 30_000 }).then(() => true, () => false);
    console.log(`\n${a.name}\n  ${a.user}`);
    if (loggedIn) { ok++; console.log('  OK - logged in'); }
    else console.log(`  FAILED - portal says: ${serverError || 'no answer (still on the login page)'}`);
    await page.context().close();
  }
  await browser.close();
  console.log(ok === ACCOUNTS.length
    ? '\nBoth logins work. Run: npm run test:all-modules\n'
    : '\nFix the password(s) above in .env (reset them on the portal if needed), then run this check again.\n');
  process.exit(ok === ACCOUNTS.length ? 0 : 1);
})();
