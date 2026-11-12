/**
 * UI discovery for the public (logged-out) flows: Register Now and Reset Password.
 * Dumps visible text, form controls and a screenshot to explore-out/ (git-ignored). Submits nothing.
 *
 * Run:  npx tsx scripts/explore-registration.ts
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
  const info: { title: string; url: string; text: string; controls: string[] } = await page.evaluate(`(() => {
    const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const all = [];
    const walk = (root) => {
      root.querySelectorAll('*').forEach((e) => {
        if (e.matches('input,textarea,select,button,a,label,[role=button],[role=combobox],[role=option],[role=listbox]')) all.push(e);
        if (e.shadowRoot) walk(e.shadowRoot);
      });
    };
    walk(document);
    const controls = all.filter(vis).map((e) => [e.tagName.toLowerCase(), e.type || '', e.getAttribute('role') || '',
      e.placeholder || '', e.getAttribute('aria-label') || '', e.name || '', e.id || '', e.getAttribute('maxlength') || '',
      e.required ? 'required' : '', (e.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 60)].join(' | '));
    return { title: document.title, url: location.href, text: document.body.innerText, controls: [...new Set(controls)] };
  })()`);
  fs.writeFileSync(path.join(OUT, `${name}.txt`),
    `URL: ${info.url}\nTITLE: ${info.title}\n\n== CONTROLS (tag|type|role|placeholder|aria|name|id|maxlength|required|text) ==\n${info.controls.join('\n')}\n\n== TEXT ==\n${info.text}`);
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
  console.log(`dumped ${name}: ${info.url}`);
}

(async () => {
  const browser = await chromium.launch({ channel: 'chrome' }).catch(() => chromium.launch());
  const page = await (await browser.newContext({ viewport: { width: 1366, height: 900 } })).newPage();

  await page.goto(BASE);
  await page.getByRole('button', { name: 'Register Now' }).click();
  await dump(page, 'reg-01-form');

  // Open any comboboxes so their options are captured.
  for (const cb of await page.locator('select').all()) {
    console.log('select options:', await cb.locator('option').allInnerTexts());
  }

  // Empty submit — client-side validation only, nothing is created.
  const submit = page.getByRole('button', { name: /register|submit|sign ?up|create|continue|next/i }).last();
  console.log('submit button:', await submit.textContent().catch(() => '?'));
  await submit.click().catch(e => console.log('submit click failed', e.message));
  await dump(page, 'reg-02-empty-submit');

  await page.goto(BASE);
  await page.getByRole('button', { name: 'Reset Password' }).click();
  await dump(page, 'reset-01-form');

  await browser.close();
})();
