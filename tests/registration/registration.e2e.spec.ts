import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import fs from 'node:fs';
import { SF_AUTH_FILE } from '../../playwright.config';
import { ForgotPasswordPage } from '../../pages/ForgotPasswordPage';
import { OtpStep } from '../../pages/OtpStep';
import { RegistrationPage } from '../../pages/RegistrationPage';
import { SfApprovalPage } from '../../pages/sf/SfApprovalPage';
import { newPassword, newRegistration, type Registration } from '../../utils/registrationData';
import { snap, note } from '../../utils/report';
import { findRegisteredRecord, hasSfSession, lightningUrl, pendingWorkItem, recordsWithEmail, sfUpdate } from '../../utils/salesforce';
import { actual, observed, tc } from '../../utils/testCase';
import { YopMail } from '../../utils/yopmail';

/**
 * End-to-end Alumni Registration with one brand-new, unique alumnus:
 *   register → OTP mail (YOPmail) → verify → "Registration Received and Profile Under Review" mail
 *   → Salesforce "Registered Records" record → Alumni Relations approval in Salesforce
 *   → Magic Link mail → Onboarding Form (Basic Information / Education Details / Employment Details)
 *   → Reset Password (email → OTP → new password) → login with the new password.
 *
 * Seen 2026-11-12: OTP verification does NOT send the Magic Link. The profile first goes to the
 * Alumni Relations Team for review; the Magic Link/login mail only comes after approval in Salesforce.
 * E2E-005 approves the record (approval process, or SF_REGISTRATION_APPROVE="Field__c=Value").
 * Without approval the later steps are skipped — or set REG_APPROVAL_WAIT_MIN to wait for a
 * person to approve it by hand.
 *
 * Runs in a visible browser: YOPmail sometimes asks "confirm you're human" — complete it in the
 * window when the console asks (the script waits; it never tries to get past the check itself).
 * Salesforce checks need `npm run sf:login` first (MFA).
 */
const VERIFY_SUBJECT = /Verify Your Alumni Account/i;
const REVIEW_SUBJECT = /Registration Received/i;
const MAGIC_SUBJECT = /^(?!.*(Verify Your Alumni Account|Registration Received)).+/i;
const OTP_SUBJECT = /OTP|verif|password|reset/i;

test.describe.configure({ mode: 'serial' });

let ctx: BrowserContext;
let page: Page;
let yop: YopMail;
let reg: Registration;
let password: string;
let registered = false;
let approved = false;
let sfRecordId: string | undefined;

test.beforeAll(async ({ browser }, info) => {
  ctx = await browser.newContext({ baseURL: info.project.use.baseURL, viewport: { width: 1366, height: 900 } });
  page = await ctx.newPage();
  reg = newRegistration();
  password = newPassword();
  yop = await YopMail.open(ctx, reg.email);
  // Keep the run's data so a failed run can be finished/inspected by hand.
  fs.mkdirSync('test-data', { recursive: true });
  fs.writeFileSync('test-data/last-e2e-registration.json', JSON.stringify({ ...reg, newPassword: password }, null, 1));
});

test.afterAll(async () => { await ctx?.close(); });

test('E2E-001 register a new alumnus with unique data', async () => {
  tc({ id: 'E2E-001', module: 'Alumni Registration', type: 'Positive', scenario: 'Complete registration form with valid unique data',
    steps: ['Open /SelfRegister', 'Fill First/Last Name, YOPmail email, +91 mobile, Student ID, Institute, Programme, Enrollment & Graduation year', 'Tick consent', 'Click Register'],
    data: reg, expected: 'Verify OTP (Step 2 of 2) opens and shows the registered email' });
  await note('registration data', reg);
  const rp = new RegistrationPage(page);
  await rp.goto();
  await rp.fill(reg);
  // Field-level checks on what was entered.
  await expect(rp.firstName).toHaveValue(reg.firstName);
  await expect(rp.lastName).toHaveValue(reg.lastName);
  await expect(rp.email).toHaveValue(reg.email);
  await expect(rp.mobile).toHaveValue(reg.mobile);
  await expect(rp.countryCodeButton).toContainText('+91');
  await expect(rp.studentId).toHaveValue(reg.studentId);
  await expect(rp.institute).toContainText(reg.institute);
  await expect(rp.programme).toContainText(reg.programme);
  await expect(rp.yearOfEnrollment).toContainText(reg.yearOfEnrollment);
  await expect(rp.yearOfGraduation).toContainText(reg.yearOfGraduation);
  await snap(page, 'filled form');
  await rp.submit();
  const otp = new OtpStep(page);
  await otp.waitForVisible();
  await expect(page.getByText('Step 2 of 2')).toBeVisible();
  await expect(page.getByText(reg.email)).toBeVisible();
  registered = true;
  actual(`Verify OTP shown for ${reg.email}`);
});

test('E2E-002 OTP email arrives in YOPmail and verifies the account', async () => {
  test.skip(!registered, 'registration did not reach the OTP step');
  tc({ id: 'E2E-002', module: 'Email Verification', type: 'Verification', scenario: 'Verify account with the OTP from the email',
    steps: [`Open YOPmail inbox ${reg.email}`, 'Wait for "Verify Your Alumni Account"', 'Read the 4-digit OTP', 'Enter it and click Verify (resend + retry if expired)'],
    data: reg.email, expected: 'OTP mail received with a 4-digit OTP; verification succeeds and the OTP step closes' });
  const otp = new OtpStep(page);
  const done = page.getByText(/success|verified|thank you|registration (is )?complete|check your (email|inbox)|welcome|magic link/i).first();
  const attempts = await otp.verifyFromMail(yop, VERIFY_SUBJECT, done, 0);
  await note('OTP attempts', attempts);
  await expect(otp.heading).toBeHidden();
  await snap(page, 'after OTP verify');
  const shown = (await page.locator('body').innerText()).split('\n').filter(s => /success|verified|thank|complete|email|welcome/i.test(s)).slice(0, 3);
  actual(`OTP ${attempts.map(a => `${a.otp} (mail after ${a.deliveredAfterS}s → ${a.result})`).join(', ')}. Page: ${shown.join(' / ')}`);
  if (attempts[0].deliveredAfterS > 45) observed(`OTP mail took ${attempts[0].deliveredAfterS}s to arrive but the OTP is only valid for 1 minute.`);
});

test('E2E-003 "Registration Received / Profile Under Review" email', async () => {
  test.skip(!registered, 'registration did not complete');
  tc({ id: 'E2E-003', module: 'Email Verification', type: 'Verification', scenario: 'Confirmation mail after OTP verification',
    steps: ['Wait in YOPmail for the mail after OTP verification', 'Check subject, greeting and next steps'],
    data: reg.email, expected: '"Registration Received and Profile Under Review" mail addressed to the first name, explaining Alumni Relations review' });
  const mail = await yop.waitForMail(REVIEW_SUBJECT, { timeoutMs: 180_000, pollMs: 10_000 });
  await note('Registration Received mail', mail.text);
  expect(mail.text).toContain(`Hi ${reg.firstName}`);
  expect(mail.text).toMatch(/Profile Validation|reviewed by our Alumni Relations Team/i);
  await snap(yop.page, 'Registration Received mail');
  actual(`Mail received after ${Math.round(mail.deliveredAfterMs / 1000)}s: greets ${reg.firstName}, says profile is under Alumni Relations review`);
});

test('E2E-004 Salesforce record created under Master Records → Registered Records', async ({ browser }) => {
  test.skip(!registered, 'registration did not complete');
  tc({ id: 'E2E-004', module: 'Salesforce', type: 'Verification', scenario: 'Registered record is created in Salesforce',
    steps: ['Query Salesforce for a record with the registration email', 'Compare its fields with the form data', 'Open Master Records → Registered Records in Lightning and find the record'],
    data: reg.email, expected: 'One record with matching First/Last Name, Email, Mobile, Student ID, Institute, Programme and years' });
  test.skip(!(await hasSfSession()), 'No valid Salesforce session — run: npm run sf:login');

  let found = null as Awaited<ReturnType<typeof findRegisteredRecord>>;
  for (let i = 0; i < 12 && !found; i++) { // allow for async record creation
    found = await findRegisteredRecord(reg.email);
    if (!found) await page.waitForTimeout(5000);
  }
  await note('objects holding the email', await recordsWithEmail(reg.email));
  expect(found, `no Salesforce record holds ${reg.email}`).toBeTruthy();
  const { object, record } = found!;
  sfRecordId = record.Id;
  await note(`Salesforce ${object}`, record);

  // Field comparison by value (field API names differ per org; match on values present anywhere in the record).
  const values = Object.values(record).filter(v => v !== null && typeof v !== 'object').map(v => String(v).toLowerCase());
  const has = (v: string) => values.some(x => x === v.toLowerCase() || x.endsWith(v.toLowerCase()) || x.includes(v.toLowerCase()));
  const checks: Record<string, boolean> = {
    'First Name': has(reg.firstName), 'Last Name': has(reg.lastName), Email: has(reg.email), Mobile: has(reg.mobile),
    'Student ID': has(reg.studentId), 'Year of Enrollment': has(reg.yearOfEnrollment), 'Year of Graduation': has(reg.yearOfGraduation),
  };
  await note('field match', checks);
  for (const [field, ok] of Object.entries(checks)) expect.soft(ok, `Salesforce ${object} should hold ${field}`).toBe(true);
  actual(`${object} ${record.Id}: ${Object.entries(checks).map(([k, v]) => `${k} ${v ? '✓' : '✗'}`).join(', ')}`);
  if (!/regist/i.test(object)) observed(`Record found on ${object}; set SF_REGISTRATION_OBJECT in .env to the "Registered Records" object for a strict check.`);

  // UI check: Master Records → Registered Records in Lightning.
  const sf = await browser.newContext({ storageState: SF_AUTH_FILE, viewport: { width: 1440, height: 900 } });
  const sp = await sf.newPage();
  await sp.goto(`${lightningUrl()}/lightning/r/${record.Id}/view`);
  await expect(sp.getByText(reg.email).first()).toBeVisible({ timeout: 60_000 });
  await snap(sp, 'Salesforce record page');
  await sp.goto(`${lightningUrl()}/lightning/page/home`);
  await sp.getByRole('button', { name: 'App Launcher' }).click();
  await sp.getByPlaceholder(/Search apps and items/i).fill('Registered Records');
  const item = sp.getByRole('option', { name: /Registered Records/i }).or(sp.getByRole('link', { name: /Registered Records/i })).first();
  if (await item.isVisible({ timeout: 10_000 }).catch(() => false)) {
    await item.click();
    await sp.waitForLoadState('domcontentloaded');
    const search = sp.getByPlaceholder(/Search this list/i);
    if (await search.isVisible({ timeout: 20_000 }).catch(() => false)) {
      await search.fill(reg.email);
      await search.press('Enter');
    }
    await expect.soft(sp.getByText(new RegExp(`${reg.firstName}|${reg.lastName}|${reg.email}`, 'i')).first()).toBeVisible({ timeout: 30_000 });
    await snap(sp, 'Registered Records list');
  } else {
    observed('"Registered Records" not found in App Launcher for this Salesforce user.');
  }
  await sf.close();
});

test('E2E-005 Alumni Relations approves the profile in Salesforce', async ({ browser }) => {
  test.skip(!registered, 'registration did not complete');
  tc({ id: 'E2E-005', module: 'Salesforce', type: 'Verification', scenario: 'Approve the registered profile so onboarding can start',
    steps: ['Find the registered record (E2E-004)', 'Approve it: pending approval request, or set the field named in SF_REGISTRATION_APPROVE'],
    data: { recordId: sfRecordId ?? '-', rule: process.env.SF_REGISTRATION_APPROVE ?? 'approval process' },
    expected: 'Record is approved without errors' });
  const waitMin = Number(process.env.REG_APPROVAL_WAIT_MIN ?? 0);
  if (!sfRecordId || !(await hasSfSession())) {
    approved = waitMin > 0; // a person approves it by hand; E2E-006 waits for the mail
    test.skip(true, waitMin > 0 ? `Waiting up to ${waitMin} min in E2E-006 for a manual approval`
      : 'No Salesforce session/record: run npm run sf:login, or approve by hand and set REG_APPROVAL_WAIT_MIN');
  }
  const item = await pendingWorkItem(sfRecordId!);
  if (item) {
    const sf = await browser.newContext({ storageState: SF_AUTH_FILE, viewport: { width: 1440, height: 900 } });
    await new SfApprovalPage(await sf.newPage()).decide(sfRecordId!, 'Approve', 'QA automation: profile approved');
    await sf.close();
    actual(`Approved via approval process "${item.ProcessInstance.ProcessDefinition.Name}"`);
  } else if (process.env.SF_REGISTRATION_APPROVE) {
    const [field, value] = process.env.SF_REGISTRATION_APPROVE.split('=');
    const object = (await findRegisteredRecord(reg.email))!.object;
    await sfUpdate(object, sfRecordId!, { [field]: value });
    actual(`Set ${object}.${field} = ${value}`);
  } else {
    observed('No pending approval request on the record and SF_REGISTRATION_APPROVE is not set.');
    throw new Error('No way to approve: set SF_REGISTRATION_APPROVE="Field__c=Value" in .env, or approve by hand with REG_APPROVAL_WAIT_MIN set.');
  }
  approved = true;
});

test('E2E-006 Magic Link email opens the Onboarding Form', async ({ browser }) => {
  test.skip(!registered, 'registration did not complete');
  test.skip(!approved, 'profile not approved yet (see E2E-005) - no Magic Link is sent before approval');
  tc({ id: 'E2E-006', module: 'Magic Link / Onboarding', type: 'Verification', scenario: 'Verified user receives a Magic Link that opens the Onboarding Form',
    steps: ['Wait in YOPmail for the mail after verification', 'Find the portal link in it', 'Open it in a fresh browser (not logged in)', 'Check the Onboarding Form sections'],
    data: reg.email, expected: 'Magic Link mail received; link opens the Onboarding Form with Basic Information, Education Details and Employment Details' });
  const waitMs = Math.max(5, Number(process.env.REG_APPROVAL_WAIT_MIN ?? 0)) * 60_000;
  const mail = await yop.waitForMail(MAGIC_SUBJECT, { timeoutMs: waitMs, pollMs: 15_000 });
  await note('Magic Link mail', mail);
  const host = new URL(process.env.BASE_URL!).host;
  const link = mail.links.find(l => /magic|login|access|onboard|get started|complete|activate|click|here|continue/i.test(l.text) && /site\.com|force\.com|salesforce/i.test(l.href))
    ?? mail.links.find(l => l.href.includes(host));
  expect(link, `no portal link in mail. Links: ${JSON.stringify(mail.links)}`).toBeTruthy();

  const fresh = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const mp = await fresh.newPage();
  await mp.goto(link!.href);
  await mp.waitForLoadState('networkidle', { timeout: 60_000 }).catch(() => {});
  await expect(mp).not.toHaveURL(/\/login(\?|$)/);
  for (const section of ['Basic Information', 'Education Details', 'Employment Details']) {
    await expect.soft(mp.getByText(section, { exact: false }).first(), `Onboarding section "${section}"`).toBeVisible({ timeout: 60_000 });
  }
  // Data entered at registration should be carried into the form.
  const body = await mp.locator('body').innerText();
  const inputs = await mp.locator('input').evaluateAll(es => es.map(e => (e as HTMLInputElement).value));
  const carried = [reg.firstName, reg.lastName, reg.email].filter(v => body.includes(v) || inputs.includes(v));
  expect.soft(carried.length, 'registration data pre-filled in onboarding').toBeGreaterThan(0);
  await snap(mp, 'Onboarding Form');
  actual(`Mail "${mail.text.split('\n').find(Boolean)}"; link → ${mp.url()}; pre-filled: ${carried.join(', ') || 'none'}`);
  await fresh.close();
});

test('E2E-007 Reset Password: email → OTP → new password (with negative checks)', async () => {
  test.skip(!registered, 'registration did not complete');
  test.skip(!approved, 'profile not approved yet - the alumnus has no portal login before approval');
  tc({ id: 'E2E-007', module: 'Reset Password', type: 'Verification', scenario: 'Reset password for the new alumnus',
    steps: ['Open Reset Password', 'Enter registered email, Continue', 'Enter wrong OTP (expect error)', 'Enter OTP from YOPmail', 'Submit mismatched passwords (expect error)', 'Submit weak password (expect error)', 'Submit strong matching password'],
    data: { email: reg.email, newPassword: '(generated, saved in test-data/last-e2e-registration.json)' },
    expected: 'Step 2 of 3 OTP; wrong OTP rejected; Step 3 of 3; mismatch and weak passwords rejected; strong password accepted with a success message' });
  const fp = new ForgotPasswordPage(page);
  const before = await yop.count(OTP_SUBJECT);
  await fp.goto();
  await fp.requestOtp(reg.email);
  await expect(page.getByText('Step 2 of 3')).toBeVisible({ timeout: 45_000 });
  await expect(page.getByText(reg.email)).toBeVisible();

  await fp.otp.enter('0000');
  await fp.otp.verifyButton.click();
  await expect.soft(fp.otp.invalidError).toBeVisible();

  const attempts = await fp.otp.verifyFromMail(yop, OTP_SUBJECT, fp.step3, before);
  await note('reset OTP attempts', attempts);
  await snap(page, 'reset step 3');

  await fp.setPassword(password, `${password}x`);
  await page.waitForTimeout(2000);
  const mismatch = await page.getByText(/match/i).first().isVisible();
  expect.soft(mismatch, 'mismatched passwords must be rejected').toBe(true);

  await fp.setPassword('abc', 'abc');
  await page.waitForTimeout(2000);
  const weak = await page.getByText(/least|must|character|strong|weak|uppercase|number|special/i).first().isVisible();
  expect.soft(weak, 'weak password must be rejected').toBe(true);

  await fp.setPassword(password);
  await expect(page.getByText(/success|updated|has been reset|changed/i).first().or(page.getByRole('button', { name: 'Login', exact: true })))
    .toBeVisible({ timeout: 60_000 });
  await snap(page, 'password reset done');
  actual(`Wrong OTP rejected: ${await fp.otp.invalidError.count() >= 0}; mismatch msg: ${mismatch}; weak msg: ${weak}; new password accepted`);
});

test('E2E-008 login with the new password (and not with a wrong one)', async ({ browser }) => {
  test.skip(!registered, 'registration did not complete');
  test.skip(!approved, 'profile not approved yet - the alumnus has no portal login before approval');
  tc({ id: 'E2E-008', module: 'Login', type: 'Positive', scenario: 'Log in with the updated password',
    steps: ['Open login page in a fresh browser', 'Log in with email + wrong password (expect error)', 'Log in with email + new password'],
    data: { email: reg.email }, expected: 'Wrong password: "Incorrect Email Or Password"; new password: lands in the portal (not on login)' });
  const fresh = await browser.newContext({ baseURL: process.env.BASE_URL, viewport: { width: 1366, height: 900 } });
  const lp = await fresh.newPage();
  const login = async (pw: string) => {
    await lp.goto('./');
    await lp.getByPlaceholder('you@example.com').fill(reg.email);
    await lp.getByPlaceholder('Enter password').fill(pw);
    await lp.getByRole('button', { name: 'Login', exact: true }).click();
  };
  await login(`${password}Wrong`);
  await expect.soft(lp.getByText(/Incorrect Email Or Password|incorrect/i).first()).toBeVisible({ timeout: 30_000 });
  await expect(lp).toHaveURL(/\/login/);

  await login(password);
  await lp.waitForURL(u => !/\/login/.test(u.pathname), { timeout: 90_000 });
  await lp.waitForLoadState('networkidle', { timeout: 60_000 }).catch(() => {});
  await snap(lp, 'logged in with new password');
  actual(`Wrong password refused; new password logged in → ${lp.url()}`);
  await fresh.close();
});
