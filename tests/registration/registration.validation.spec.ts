import { expect, test } from '@playwright/test';
import { ForgotPasswordPage } from '../../pages/ForgotPasswordPage';
import { OtpStep } from '../../pages/OtpStep';
import { RegistrationPage } from '../../pages/RegistrationPage';
import { newRegistration, type Registration } from '../../utils/registrationData';
import { snap } from '../../utils/report';
import { actual, observed, tc } from '../../utils/testCase';
import { watchDialogs } from '../../utils/validation';

/**
 * Alumni Registration — positive, negative, mandatory, boundary and OTP-screen validation.
 * None of these need a mailbox. Every test uses freshly generated, never-repeated data
 * (utils/registrationData.ts keeps a ledger in test-data/).
 */
const M = 'Alumni Registration';
let rp: RegistrationPage;

test.beforeEach(async ({ page }) => {
  rp = new RegistrationPage(page);
  await rp.goto();
});

/** Asserts the form did NOT move on to the OTP step. */
async function expectStillOnForm() {
  await rp.page.waitForTimeout(1500);
  await expect(new OtpStep(rp.page).heading).toBeHidden();
  await expect(rp.registerButton).toBeVisible();
}

test.describe('Registration form - layout', () => {
  test('REG-001 registration page shows every field', async ({ page }) => {
    tc({ id: 'REG-001', module: M, type: 'Positive', scenario: 'Registration page loads with all fields',
      steps: ['Open login page', 'Click Register Now', 'Check every field and button'],
      expected: 'First/Last Name, Email, Mobile (country code), Student ID, Institute, Programme, Year of Enrollment, Year of Graduation, consent checkbox and Register are shown' });
    await page.goto('./');
    await page.getByRole('button', { name: 'Register Now' }).click();
    await expect(page).toHaveURL(/SelfRegister/);
    for (const f of [rp.firstName, rp.lastName, rp.email, rp.countryCodeButton, rp.mobile, rp.studentId,
      rp.institute, rp.programme, rp.yearOfEnrollment, rp.yearOfGraduation, rp.marketingConsent, rp.registerButton]) {
      await expect(f).toBeVisible();
    }
    await expect(rp.email).toHaveAttribute('type', 'email');
    await expect(rp.mobile).toHaveAttribute('type', 'tel');
    await expect(rp.programme).toContainText('Select an institute first');
    await snap(page, 'registration form');
    actual('All 8 registration fields, consent and Register button visible');
  });

  test('REG-002 Login link goes back to login page', async ({ page }) => {
    tc({ id: 'REG-002', module: M, type: 'Positive', scenario: '"Already a member? Login" navigates to Login',
      steps: ['Open registration page', 'Click Login'], expected: 'Login page opens' });
    await rp.loginLink.click();
    await expect(page).toHaveURL(/\/login/);
    actual(`Navigated to ${page.url()}`);
  });
});

test.describe('Registration form - mandatory fields', () => {
  test('REG-003 submitting an empty form shows every required error', async ({ page }) => {
    tc({ id: 'REG-003', module: M, type: 'Mandatory', scenario: 'Submit empty registration form',
      steps: ['Open registration page', 'Click Register without filling anything'],
      expected: '"This field cannot be empty." under First Name, Last Name, Email, Mobile, Institute, Programme, Year of Enrollment, Year of Graduation; no OTP step' });
    await rp.submit();
    await expect(rp.requiredErrors).toHaveCount(8);
    await expectStillOnForm();
    await snap(page, 'empty submit');
    actual(`${await rp.requiredErrors.count()} required-field errors shown; stayed on form`);
  });

  const mandatory: [string, keyof Registration, string][] = [
    ['REG-004', 'firstName', 'First Name'],
    ['REG-005', 'lastName', 'Last Name'],
    ['REG-006', 'email', 'Email'],
    ['REG-007', 'mobile', 'Mobile Number'],
    ['REG-008', 'yearOfEnrollment', 'Year of Enrollment'],
    ['REG-009', 'yearOfGraduation', 'Year of Graduation'],
  ];
  for (const [id, key, label] of mandatory) {
    test(`${id} ${label} left blank is rejected`, async ({ page }) => {
      const data = newRegistration({ [key]: '' } as Partial<Registration>);
      tc({ id, module: M, type: 'Mandatory', scenario: `${label} is mandatory`,
        steps: ['Open registration page', `Fill every field except ${label}`, 'Tick consent', 'Click Register'],
        data, expected: `"This field cannot be empty." for ${label}; registration does not proceed` });
      await rp.fill(data);
      await rp.submit();
      await expect(rp.requiredErrors).toHaveCount(1);
      await expectStillOnForm();
      await snap(page, `${label} blank`);
      actual(`One required error shown (${label}); stayed on form`);
    });
  }

  test('REG-010 Institute and Programme left blank are rejected', async ({ page }) => {
    const data = newRegistration({ institute: '', programme: '' });
    tc({ id: 'REG-010', module: M, type: 'Mandatory', scenario: 'Institute Name and Programme are mandatory',
      steps: ['Fill all fields except Institute (Programme stays disabled)', 'Click Register'], data,
      expected: 'Required errors for Institute Name and Programme; no OTP step' });
    await rp.fill(data);
    await rp.submit();
    await expect(rp.requiredErrors).toHaveCount(2);
    await expectStillOnForm();
    await snap(page, 'institute blank');
    actual('2 required errors (Institute, Programme); stayed on form');
  });

  test('REG-011 consent checkbox must be ticked', async ({ page }) => {
    const data = newRegistration({ marketingConsent: false });
    tc({ id: 'REG-011', module: M, type: 'Mandatory', scenario: 'Register without ticking the consent checkbox',
      steps: ['Fill every field with valid data', 'Leave consent unticked', 'Click Register'], data,
      expected: '"Please tick this box to register."; no OTP step' });
    await rp.fill(data);
    await rp.submit();
    await expect(page.getByText('Please tick this box to register.')).toBeVisible();
    await expectStillOnForm();
    observed('The consent checkbox is mandatory but its label has no * marker.');
    actual('"Please tick this box to register." shown');
  });

  test('REG-012 Student ID is optional', async ({ page }) => {
    const data = newRegistration({ studentId: '' });
    tc({ id: 'REG-012', module: M, type: 'Positive', scenario: 'Register without Student ID (optional field)',
      steps: ['Fill every field except Student ID', 'Tick consent', 'Click Register'], data,
      expected: 'No error for Student ID; form moves to Verify OTP (Step 2 of 2)' });
    await rp.fill(data);
    await rp.submit();
    const otp = new OtpStep(page);
    await otp.waitForVisible();
    await expect(page.getByText(data.email)).toBeVisible();
    actual(`Moved to Verify OTP for ${data.email}`);
  });
});

test.describe('Registration form - field validation', () => {
  const badEmails = ['plainaddress', 'qa.user@', '@yopmail.com', 'qa.user@yopmail', 'qa user@yopmail.com', 'qa..user@yopmail.com'];
  for (const [i, bad] of badEmails.entries()) {
    const id = `REG-${String(13 + i).padStart(3, '0')}`;
    test(`${id} invalid email "${bad}" is rejected`, async ({ page }) => {
      const data = newRegistration({ email: bad });
      tc({ id, module: M, type: 'Negative', scenario: `Invalid email format: ${bad}`,
        steps: ['Fill every field', `Enter email "${bad}"`, 'Click Register'], data,
        expected: '"Please enter a valid email address."; no OTP step' });
      await rp.fill(data);
      await rp.submit();
      await expect(rp.invalidEmailError).toBeVisible({ timeout: 8000 });
      await expectStillOnForm();
      actual('"Please enter a valid email address." shown');
    });
  }

  test('REG-019 names keep letters only (digits and symbols stripped)', async () => {
    const data = newRegistration();
    tc({ id: 'REG-019', module: M, type: 'Negative', scenario: 'Digits / special characters in First and Last Name',
      steps: ['Type "<first>123@#" in First Name', 'Type "<last>9!$" in Last Name', 'Read the field values'],
      data: { first: `${data.firstName}123@#`, last: `${data.lastName}9!$` },
      expected: 'Only letters are kept in the name fields' });
    await rp.firstName.pressSequentially(`${data.firstName}123@#`);
    await rp.lastName.pressSequentially(`${data.lastName}9!$`);
    await expect(rp.firstName).toHaveValue(data.firstName);
    await expect(rp.lastName).toHaveValue(data.lastName);
    actual(`Fields hold "${await rp.firstName.inputValue()}" / "${await rp.lastName.inputValue()}"`);
  });

  test('REG-020 mobile number keeps digits only', async () => {
    tc({ id: 'REG-020', module: M, type: 'Negative', scenario: 'Letters / symbols in Mobile Number',
      steps: ['Type "abc!@#" in Mobile Number'], data: 'abc!@#', expected: 'Mobile Number stays empty' });
    await rp.mobile.pressSequentially('abc!@#');
    await expect(rp.mobile).toHaveValue('');
    actual('Mobile Number field stayed empty');
  });

  test('REG-021 mobile without country code is rejected', async ({ page }) => {
    const data = newRegistration();
    tc({ id: 'REG-021', module: M, type: 'Negative', scenario: 'Mobile number entered without selecting a country code',
      steps: ['Fill every field', 'Do not pick a country code', 'Click Register'], data,
      expected: '"Please select a country code."; no OTP step' });
    const remembered = (await rp.countryCodeButton.innerText()).trim();
    test.skip(!!remembered, `Browser already has country code "${remembered}" pre-selected`);
    await rp.fill(data, { skipCountry: true });
    await rp.submit();
    await expect(rp.countryCodeError).toBeVisible();
    await expectStillOnForm();
    await snap(page, 'no country code');
    actual('"Please select a country code." shown');
  });

  const phones: [string, string, boolean, string][] = [
    ['REG-022', '987654321', false, '9 digits (one below Indian length)'],
    ['REG-023', '98765432101', false, '11 digits (one above Indian length)'],
    ['REG-024', '5876543210', false, '10 digits starting with 5 (Indian mobiles start 6-9)'],
    ['REG-025', '0000000000', false, 'all zeros'],
    ['REG-026', '6000000001', true, 'lowest valid start digit 6'],
    ['REG-027', '9999999998', true, 'highest valid start digit 9'],
  ];
  for (const [id, phone, valid, what] of phones) {
    test(`${id} mobile ${what}`, async () => {
      tc({ id, module: M, type: 'Boundary', scenario: `Indian mobile boundary: ${what}`,
        steps: ['Pick country India (+91)', `Enter ${phone}`, 'Click Register (other fields empty — nothing is created)'],
        data: `+91 ${phone}`, expected: valid ? 'No "valid phone number" error' : '"Please enter a valid phone number."' });
      await rp.selectCountry('India', '+91');
      await rp.mobile.fill(phone);
      await rp.submit();
      await rp.page.waitForTimeout(1000);
      if (valid) await expect(rp.invalidPhoneError).toBeHidden();
      else await expect(rp.invalidPhoneError).toBeVisible();
      actual(`Phone error ${(await rp.invalidPhoneError.isVisible()) ? 'shown' : 'not shown'}`);
    });
  }

  test('REG-028 Programme is disabled until an Institute is chosen', async () => {
    tc({ id: 'REG-028', module: M, type: 'Positive', scenario: 'Dependent Programme picklist',
      steps: ['Check Programme before Institute', 'Pick "Ken Institute"', 'Open Programme'],
      expected: 'Programme shows "Select an institute first", then lists the institute\'s programmes' });
    await expect(rp.programme).toContainText('Select an institute first');
    await rp.pickOption(rp.institute, 'Ken Institute');
    await rp.programme.click();
    const opts = await rp.page.getByRole('option').allInnerTexts();
    expect(opts.length).toBeGreaterThan(0);
    actual(`Programmes after selecting Ken Institute: ${opts.join(', ')}`);
  });

  test('REG-029 year lists run from 1980 to the current year (no future years)', async () => {
    tc({ id: 'REG-029', module: M, type: 'Boundary', scenario: 'Year of Enrollment / Graduation range',
      steps: ['Open Year of Enrollment', 'Open Year of Graduation'],
      expected: `Both list ${new Date().getFullYear()} down to 1980; no future year` });
    for (const combo of [rp.yearOfEnrollment, rp.yearOfGraduation]) {
      await combo.click();
      const years = (await rp.page.getByRole('option').allInnerTexts()).map(Number);
      expect(Math.max(...years)).toBe(new Date().getFullYear());
      expect(Math.min(...years)).toBe(1980);
      await rp.page.keyboard.press('Escape');
      actual(`${years.length} years, ${Math.max(...years)}–${Math.min(...years)}`);
    }
  });

  test('REG-030 Year of Enrollment after Year of Graduation is rejected', async ({ page }) => {
    const data = newRegistration({ yearOfEnrollment: '2022', yearOfGraduation: '2018' });
    tc({ id: 'REG-030', module: M, type: 'Negative', scenario: 'Enrollment year later than graduation year',
      steps: ['Fill every field', 'Enrollment 2022, Graduation 2018', 'Click Register'], data,
      expected: '"Year of enrollment cannot be later than the year of graduation."; no OTP step' });
    await rp.fill(data);
    await rp.submit();
    await expect(page.getByText('Year of enrollment cannot be later than the year of graduation.')).toBeVisible();
    await expectStillOnForm();
    actual('Year-order error shown');
  });

  test('REG-031 same Enrollment and Graduation year is allowed', async () => {
    tc({ id: 'REG-031', module: M, type: 'Boundary', scenario: 'Enrollment year equal to graduation year',
      steps: ['Pick 2020 for both years', 'Click Register (other fields empty)'], data: '2020 / 2020',
      expected: 'No year-order error' });
    await rp.pickOption(rp.yearOfEnrollment, '2020');
    await rp.pickOption(rp.yearOfGraduation, '2020');
    await rp.submit();
    await expect(rp.page.getByText(/cannot be later than the year of graduation/)).toBeHidden();
    actual('No year-order error');
  });

  const lengths: [string, string, number][] = [['REG-032', 'firstName', 40], ['REG-033', 'lastName', 80], ['REG-034', 'email', 80], ['REG-035', 'studentId', 255]];
  for (const [id, key, limit] of lengths) {
    test(`${id} ${key} is capped at ${limit} characters`, async () => {
      tc({ id, module: M, type: 'Boundary', scenario: `${key} maximum length`,
        steps: [`Type ${limit + 20} characters into ${key}`, 'Read the field value'], data: `${limit + 20} chars`,
        expected: `Field holds at most ${limit} characters (Salesforce field length)` });
      const field = rp[key as 'firstName'];
      await field.pressSequentially('a'.repeat(limit + 20), { delay: 0 });
      const len = (await field.inputValue()).length;
      actual(`Field holds ${len} characters`);
      if (len > limit) observed(`${key} has no maxlength: accepted ${len} characters (limit ${limit}).`);
      expect(len).toBeLessThanOrEqual(limit);
    });
  }

  test('REG-036 script/HTML in text fields does not execute', async ({ page }) => {
    const dialogs = watchDialogs(page);
    const data = newRegistration({ studentId: '<img src=x onerror=alert(1)>' });
    tc({ id: 'REG-036', module: M, type: 'Security', scenario: 'HTML injection in Student ID',
      steps: ['Enter <img src=x onerror=alert(1)> as Student ID', 'Fill other fields', 'Click Register'], data,
      expected: 'No script runs (no browser alert)' });
    await rp.fill(data);
    await rp.submit();
    await page.waitForTimeout(4000);
    expect(dialogs).toEqual([]);
    actual(`Alerts seen: ${dialogs.length}`);
  });
});

test.describe('Registration - duplicates', () => {
  /** Register one fresh user to Step 2, then try the same value again. */
  async function registerToOtp(page: import('@playwright/test').Page) {
    const first = newRegistration();
    await rp.fill(first);
    await rp.submit();
    await new OtpStep(page).waitForVisible();
    await rp.goto();
    return first;
  }
  const dupes: [string, 'email' | 'mobile' | 'studentId', string][] = [
    ['REG-037', 'email', 'Email Address'],
    ['REG-038', 'mobile', 'Mobile Number'],
    ['REG-039', 'studentId', 'Student ID'],
  ];
  for (const [id, key, label] of dupes) {
    test(`${id} duplicate ${label} is rejected`, async ({ page }) => {
      const first = await registerToOtp(page);
      const second = newRegistration({ [key]: first[key] });
      tc({ id, module: M, type: 'Negative', scenario: `Register a second user with an existing ${label}`,
        steps: ['Register user A (reaches OTP)', `Open the form again with new data but A's ${label}`, 'Click Register'],
        data: { [`existing ${label}`]: first[key], second }, expected: `An "already registered/exists" error; no OTP step` });
      await rp.fill(second);
      await rp.submit();
      // Not "Already a member? Login" — that footer text is always on the page.
      const err = page.getByText(/already (been )?(registered|exists?|in use|taken)|duplicate|exists/i);
      const otp = new OtpStep(page).heading;
      await expect(err.or(otp).first()).toBeVisible({ timeout: 30_000 });
      const wentToOtp = await otp.isVisible();
      actual(wentToOtp ? `Accepted: moved to Verify OTP with duplicate ${label}` : `Rejected: ${await err.first().innerText()}`);
      if (wentToOtp) observed(`Duplicate ${label} was accepted at step 1 (went to OTP).`);
      expect(wentToOtp, `duplicate ${label} must be rejected`).toBe(false);
    });
  }
});

test.describe('Registration - OTP step (no mailbox needed)', () => {
  let otp: OtpStep;
  test.beforeEach(async ({ page }) => {
    await rp.fill(newRegistration());
    await rp.submit();
    otp = new OtpStep(page);
    await otp.waitForVisible();
  });

  test('OTP-001 Verify with no OTP', async () => {
    tc({ id: 'OTP-001', module: 'Registration OTP', type: 'Mandatory', scenario: 'Click Verify without entering the OTP',
      steps: ['Register with valid data', 'Click Verify'], expected: '"Please enter the complete OTP."' });
    await otp.verifyButton.click();
    await expect(otp.incompleteError).toBeVisible();
    actual('"Please enter the complete OTP." shown');
  });

  test('OTP-002 partial OTP (3 digits)', async () => {
    tc({ id: 'OTP-002', module: 'Registration OTP', type: 'Boundary', scenario: 'Enter only 3 of 4 digits',
      steps: ['Register with valid data', 'Type 123', 'Click Verify'], data: '123', expected: '"Please enter the complete OTP."' });
    await otp.enter('123');
    await otp.verifyButton.click();
    await expect(otp.incompleteError).toBeVisible();
    actual('"Please enter the complete OTP." shown');
  });

  test('OTP-003 wrong OTP is rejected', async () => {
    tc({ id: 'OTP-003', module: 'Registration OTP', type: 'Negative', scenario: 'Enter a wrong 4-digit OTP',
      steps: ['Register with valid data', 'Type 0000', 'Click Verify'], data: '0000',
      expected: '"OTP verification failed — The OTP you entered is invalid. Please try again."' });
    await otp.enter('0000');
    await otp.verifyButton.click();
    await expect(otp.invalidError).toBeVisible();
    actual('Invalid-OTP error shown');
  });

  test('OTP-004 letters are not accepted in OTP boxes', async () => {
    tc({ id: 'OTP-004', module: 'Registration OTP', type: 'Negative', scenario: 'Type letters into OTP boxes',
      steps: ['Register with valid data', 'Type "ab@#"'], data: 'ab@#', expected: 'OTP boxes stay empty' });
    await otp.enter('ab@#');
    expect(await otp.values()).toBe('');
    actual('OTP boxes stayed empty');
  });

  test('OTP-005 Resend OTP after the timer', async ({ page }) => {
    tc({ id: 'OTP-005', module: 'Registration OTP', type: 'Verification', scenario: 'Resend OTP becomes available after the countdown',
      steps: ['Register with valid data', 'Check the countdown', 'Wait for it to finish', 'Click Resend OTP'],
      expected: 'Countdown shown first; then "OTP resent — We have sent a new verification code to your email." and the timer restarts' });
    await expect(otp.resendTimer).toBeVisible();
    await otp.resend();
    await expect(otp.resendTimer).toBeVisible();
    await snap(page, 'otp resent');
    actual('Countdown shown, Resend OTP worked and timer restarted');
  });
});

test.describe('Reset Password - validation (no mailbox needed)', () => {
  let fp: ForgotPasswordPage;
  test.beforeEach(async ({ page }) => {
    fp = new ForgotPasswordPage(page);
    await fp.goto();
  });

  test('RP-001 Reset Password link opens Step 1', async ({ page }) => {
    tc({ id: 'RP-001', module: 'Reset Password', type: 'Positive', scenario: 'Open Reset Password from Login',
      steps: ['Open login page', 'Click Reset Password'], expected: '"Step 1 of 3 — Reset Your Password" with Email and Continue' });
    await page.goto('./');
    await page.getByRole('button', { name: 'Reset Password' }).click();
    await expect(page).toHaveURL(/ForgotPassword/);
    await expect(page.getByText('Step 1 of 3')).toBeVisible();
    await expect(fp.email).toBeVisible();
    actual('Step 1 of 3 shown');
  });

  test('RP-002 empty email', async () => {
    tc({ id: 'RP-002', module: 'Reset Password', type: 'Mandatory', scenario: 'Continue with no email',
      steps: ['Open Reset Password', 'Click Continue'], expected: '"This field cannot be empty."' });
    await fp.continueButton.click();
    await expect(fp.requiredError).toBeVisible();
    actual('Required error shown');
  });

  test('RP-003 invalid email format', async ({ page }) => {
    tc({ id: 'RP-003', module: 'Reset Password', type: 'Negative', scenario: 'Continue with an invalid email',
      steps: ['Enter "not-an-email"', 'Click Continue'], data: 'not-an-email', expected: '"Please enter a valid email address."; stays on Step 1' });
    await fp.requestOtp('not-an-email');
    await page.waitForTimeout(3000);
    await expect(page.getByText('Step 2 of 3')).toBeHidden();
    const shown = await page.getByText(/valid email/i).isVisible();
    actual(shown ? 'Invalid-email error shown' : 'No message shown; stayed on Step 1');
    if (!shown) observed('Reset Password shows no message for an invalid email format.');
    expect(shown, 'an invalid-email message must be shown').toBe(true);
  });

  test('RP-004 unregistered email', async ({ page }) => {
    const email = newRegistration().email; // never registered
    tc({ id: 'RP-004', module: 'Reset Password', type: 'Negative', scenario: 'Continue with an email that is not registered',
      steps: ['Enter a never-registered YOPmail address', 'Click Continue'], data: email,
      expected: 'A message that the email is not registered (or a neutral "if registered, we sent a code"); no OTP step' });
    const lines = async () => (await page.locator('body').innerText()).split('\n').map(s => s.trim()).filter(Boolean);
    const before = new Set(await lines());
    await fp.requestOtp(email);
    await page.waitForTimeout(8000);
    await expect(page.getByText('Step 2 of 3')).toBeHidden();
    const msg = (await lines()).filter(s => !before.has(s)); // only text that appeared after Continue
    actual(msg.length ? `Message: ${msg.join(' / ')}` : 'No message shown; stayed on Step 1');
    if (!msg.length) observed('Reset Password gives no feedback for an unregistered email.');
    expect(msg.length, 'user must be told something').toBeGreaterThan(0);
  });
});
