import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { expect, test, type Locator, type Page } from '@playwright/test';

// Oversized upload files are generated on first use (they are too big to keep in git).
if (!fs.existsSync('tests/fixtures/big-6mb.png')) execFileSync('node', ['scripts/make-fixtures.js']);

export const FILES = {
  validCover: 'tests/fixtures/cover-1200x800.png',
  notAnImage: 'tests/fixtures/not-an-image.txt',
  png1_5mb: 'tests/fixtures/big-1_5mb.png',
  png3mb: 'tests/fixtures/big-3mb.png',
  png6mb: 'tests/fixtures/big-6mb.png',
  pdf6mb: 'tests/fixtures/big-6mb.pdf',
};

/** Typical hostile inputs. */
export const INPUTS = {
  spaces: '     ',
  script: '<script>alert("xss")</script>',
  imgOnError: '<img src=x onerror=alert(1)>',
  sql: "'; DROP TABLE Account;--",
  wildcards: '%_*?',
  unicode: 'Ünïcødé ✓ 日本語',
};

/**
 * Salesforce field lengths behind each portal input (from the object describe, 2026-10-01).
 * The portal should never accept more than Salesforce can store.
 */
export const SF_LIMITS = {
  eventTitle: 80, sessionTitle: 80, sessionAgenda: 255, sessionLink: 255,
  campaignTitle: 80, campaignLink: 255,
  groupName: 80, groupTags: 1000,
  businessName: 255, businessWebsite: 255, businessPhone: 40, businessEmail: 80, businessMapUrl: 255,
  caseSubject: 255, caseDescription: 32000,
  surveyTitle: 80, audienceName: 80,
};

/** Record a known defect on the current test (shown at the top of the test in the HTML report). */
export function knownBug(description: string) {
  test.info().annotations.push({ type: 'Known bug (2026-10-01)', description });
}

/** Collect any browser alert/confirm/prompt - a sign that injected script ran. */
export function watchDialogs(page: Page) {
  const seen: string[] = [];
  page.on('dialog', d => { seen.push(`${d.type()}: ${d.message()}`); d.dismiss().catch(() => {}); });
  return seen;
}

/** Type `count` characters for real (so maxlength and keystroke handlers apply). */
export async function typeChars(field: Locator, count: number, char = 'A') {
  await field.clear();
  await field.pressSequentially(char.repeat(count), { delay: 0 });
}

/** Typing past `limit` must be blocked (or capped) - the field may never hold more than `limit` characters. */
export async function expectMaxLength(field: Locator, limit: number, label: string) {
  await typeChars(field, limit + 20);
  const len = (await field.inputValue()).length;
  expect.soft(len, `${label}: field holds ${len} characters, limit is ${limit} (Salesforce / UI limit)`).toBeLessThanOrEqual(limit);
  await field.clear();
}

/** Rich-text editor with an "n/limit characters" counter must stop at the limit. */
export async function expectEditorCap(page: Page, editor: Locator, limit: number, label: string) {
  await editor.click();
  await page.keyboard.type('x'.repeat(limit + 10));
  const counter = await page.locator('main').getByText(new RegExp(`^\\d+/${limit} characters$`)).allInnerTexts();
  const used = Math.max(...counter.map(c => Number(c.split('/')[0])));
  expect.soft(used, `${label}: counter shows ${used}/${limit}`).toBeLessThanOrEqual(limit);
}

/** New text lines that appeared on the page while `action` ran. */
export async function newTextDuring(page: Page, action: () => Promise<unknown>, settleMs = 2500) {
  const text = async () => (await page.locator('main').innerText().catch(() => '')).split('\n').map(s => s.trim()).filter(Boolean);
  const before = new Set(await text());
  await action();
  await page.waitForTimeout(settleMs);
  return (await text()).filter(s => !before.has(s));
}

/**
 * Uploading an invalid file must be refused AND the user must be told why.
 * `accepted` = a locator that only appears when the portal took the file (e.g. a preview / file name).
 */
export async function expectUploadRejected(page: Page, input: Locator, file: string, label: string, accepted?: Locator) {
  const appeared = await newTextDuring(page, () => input.setInputFiles(file));
  const message = appeared.find(s => /MB|size|large|format|type|PNG|JPE?G|PDF|allowed|only|invalid|support/i.test(s));
  if (accepted) await expect.soft(accepted, `${label}: file must NOT be accepted`).toHaveCount(0);
  expect.soft(message, `${label}: an error message must explain the rejection (new text seen: ${JSON.stringify(appeared)})`).toBeTruthy();
}
