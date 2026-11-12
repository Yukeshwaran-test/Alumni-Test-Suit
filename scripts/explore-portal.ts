/**
 * UI discovery helper: logs in with .env credentials and dumps each page's visible text,
 * form controls and a full-page screenshot to explore-out/ (git-ignored).
 *
 * Run:  npx tsx scripts/explore-portal.ts [path1 path2 ...]
 */
import { chromium, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

if (fs.existsSync('.env')) process.loadEnvFile('.env');
const BASE = process.env.BASE_URL!.replace(/\/?$/, '/');
const OUT = 'explore-out';
fs.mkdirSync(OUT, { recursive: true });

async function dump(page: Page, name: string) {
  await page.waitForLoadState('networkidle', { timeout: 45_000 }).catch(() => {});
  await page.waitForTimeout(2500);
  // Passed as a string: tsx's name-keeping helper (__name) does not exist in the page.
  const info: { title: string; url: string; text: string; controls: string[] } = await page.evaluate(`(() => {
    const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const all = [];
    const walk = (root) => {
      root.querySelectorAll('*').forEach((e) => {
        if (e.matches('input,textarea,select,button,a,[role=button],[role=tab],[role=combobox],[role=option],[role=menuitem]')) all.push(e);
        if (e.shadowRoot) walk(e.shadowRoot);
      });
    };
    walk(document);
    const controls = all
      .filter(vis)
      .map((e) => [e.tagName.toLowerCase(), e.type || '', e.getAttribute('role') || '', e.placeholder || '',
        e.getAttribute('aria-label') || '', (e.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 60),
        e.getAttribute('href') || ''].join(' | '));
    return { title: document.title, url: location.href, text: document.body.innerText, controls: [...new Set(controls)] };
  })()`);
  fs.writeFileSync(path.join(OUT, `${name}.txt`),
    `URL: ${info.url}\nTITLE: ${info.title}\n\n== CONTROLS ==\n${info.controls.join('\n')}\n\n== TEXT ==\n${info.text}`);
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
  console.log(`dumped ${name}: ${info.url} "${info.title}"`);
}

(async () => {
  const browser = await chromium.launch({ channel: 'chrome' }).catch(() => chromium.launch());
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const page = await context.newPage();
  await page.goto(BASE);
  await dump(page, '00-login');

  await page.getByPlaceholder('you@example.com').fill(process.env.ALUMNI_USER!);
  await page.locator('input[type=password]').first().fill(process.env.ALUMNI_PASS!);
  await page.getByRole('button', { name: /log ?in|sign ?in/i }).first().click();
  await page.waitForURL((u) => !/\/login/.test(u.pathname), { timeout: 90_000 }).catch(() => {});
  await dump(page, '01-home');

  for (const p of process.argv.slice(2)) {
    await page.goto(new URL(p, BASE).href);
    await dump(page, p.replace(/[^\w]+/g, '_'));
  }
  fs.mkdirSync('.auth', { recursive: true });
  await context.storageState({ path: '.auth/user.json' });
  await browser.close();
})();
