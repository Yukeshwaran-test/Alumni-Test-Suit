import { expect, type Locator, type Page } from '@playwright/test';
import type { Registration } from '../utils/registrationData';

/** /alumni/SelfRegister — public alumni self-registration form (LWC, custom picklists). */
export class RegistrationPage {
  readonly firstName: Locator;
  readonly lastName: Locator;
  readonly email: Locator;
  readonly countryCodeButton: Locator;
  readonly mobile: Locator;
  readonly studentId: Locator;
  readonly institute: Locator;
  readonly programme: Locator;
  readonly yearOfEnrollment: Locator;
  readonly yearOfGraduation: Locator;
  readonly marketingConsent: Locator;
  readonly registerButton: Locator;
  readonly loginLink: Locator;
  readonly requiredErrors: Locator;
  readonly invalidEmailError: Locator;
  readonly invalidPhoneError: Locator;
  readonly countryCodeError: Locator;

  constructor(readonly page: Page) {
    this.firstName = page.locator('[id^="ken-reg-first"]');
    this.lastName = page.locator('[id^="ken-reg-last"]');
    this.email = page.locator('[id^="ken-reg-email"]');
    // Label is "Select country code" on a fresh page; it changes once a country is remembered.
    this.countryCodeButton = page.getByRole('button', { name: /country/i }).first();
    this.mobile = page.locator('input[type="tel"]');
    this.studentId = page.locator('[id^="ken-reg-id"]');
    const combos = page.getByRole('combobox');
    this.institute = combos.nth(0);
    this.programme = combos.nth(1);
    this.yearOfEnrollment = combos.nth(2);
    this.yearOfGraduation = combos.nth(3);
    this.marketingConsent = page.getByRole('checkbox');
    this.registerButton = page.getByRole('button', { name: 'Register', exact: true });
    this.loginLink = page.getByRole('button', { name: 'Login', exact: true });
    this.requiredErrors = page.getByText('This field cannot be empty.');
    this.invalidEmailError = page.getByText('Please enter a valid email address.');
    this.invalidPhoneError = page.getByText('Please enter a valid phone number.');
    this.countryCodeError = page.getByText('Please select a country code.');
  }

  async goto() {
    await this.page.goto('SelfRegister');
    await expect(this.registerButton).toBeVisible();
    await expect(this.firstName).toBeEditable();
  }

  /** Error text directly under a field (the field's own form group). */
  errorFor(field: Locator) {
    return field.locator('xpath=ancestor::*[.//*[contains(@class,"error") or contains(text(),"cannot be empty") or contains(text(),"valid")]][1]')
      .getByText(/cannot be empty|valid|select a country/i);
  }

  async pickOption(combo: Locator, value: string) {
    await combo.click();
    const option = this.page.getByRole('option', { name: value, exact: true });
    await option.first().click();
    await expect(combo).toContainText(value);
  }

  async selectCountry(name: string, dialCode: string) {
    await this.countryCodeButton.click();
    await this.page.getByTestId('ken-phone-country-search').fill(name);
    await this.page.getByRole('option').filter({ hasText: name }).filter({ hasText: dialCode }).first().click();
  }

  /** Fill every field from `r`. Any field set to '' is left blank (for mandatory-field tests). */
  async fill(r: Registration, opts: { skipCountry?: boolean } = {}) {
    if (r.firstName) await this.firstName.fill(r.firstName);
    if (r.lastName) await this.lastName.fill(r.lastName);
    if (r.email) await this.email.fill(r.email);
    if (!opts.skipCountry && r.countryCode) await this.selectCountry(r.countryName, r.countryCode);
    if (r.mobile) await this.mobile.fill(r.mobile);
    if (r.studentId) await this.studentId.fill(r.studentId);
    if (r.institute) await this.pickOption(this.institute, r.institute);
    if (r.programme) await this.pickOption(this.programme, r.programme);
    if (r.yearOfEnrollment) await this.pickOption(this.yearOfEnrollment, r.yearOfEnrollment);
    if (r.yearOfGraduation) await this.pickOption(this.yearOfGraduation, r.yearOfGraduation);
    if (r.marketingConsent) await this.marketingConsent.check();
  }

  async submit() {
    await this.registerButton.click();
  }

  /** All visible validation/error lines on the page. */
  async visibleErrors() {
    const lines = (await this.page.locator('body').innerText()).split('\n').map(s => s.trim());
    return lines.filter(s => /cannot be empty|valid|already|must|should|error|exists|select a country|greater|before|after/i.test(s));
  }
}
