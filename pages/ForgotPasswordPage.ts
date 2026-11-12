import { expect, type Locator, type Page } from '@playwright/test';
import { OtpStep } from './OtpStep';

/**
 * /alumni/ForgotPassword — 3 steps: 1 email → 2 OTP → 3 new password.
 * Step 3's fields are located generically (password inputs + submit button) because they could
 * only be reached with a live OTP; check them on the first headed run.
 */
export class ForgotPasswordPage {
  readonly email: Locator;
  readonly continueButton: Locator;
  readonly backToLogin: Locator;
  readonly requiredError: Locator;
  readonly otp: OtpStep;
  readonly step3: Locator;
  readonly newPassword: Locator;
  readonly confirmPassword: Locator;
  readonly submitPassword: Locator;

  constructor(readonly page: Page) {
    this.email = page.locator('[id^="ken-reset-email"]');
    this.continueButton = page.getByRole('button', { name: 'Continue', exact: true });
    this.backToLogin = page.getByRole('button', { name: 'Back to Login' });
    this.requiredError = page.getByText('This field cannot be empty.');
    this.otp = new OtpStep(page);
    this.step3 = page.getByText(/Step 3 of 3/);
    const pw = page.locator('input[type="password"]:visible');
    this.newPassword = pw.nth(0);
    this.confirmPassword = pw.nth(1);
    this.submitPassword = page.getByRole('button', { name: /reset|update|save|set|submit|change|continue/i }).last();
  }

  async goto() {
    await this.page.goto('ForgotPassword');
    await expect(this.email).toBeEditable();
  }

  async requestOtp(email: string) {
    await this.email.fill(email);
    await this.continueButton.click();
  }

  async setPassword(password: string, confirm = password) {
    await expect(this.step3).toBeVisible({ timeout: 45_000 });
    await this.newPassword.fill(password);
    if (await this.confirmPassword.count()) await this.confirmPassword.fill(confirm);
    await this.submitPassword.click();
  }

  async messages() {
    const lines = (await this.page.locator('body').innerText()).split('\n').map(s => s.trim());
    return lines.filter(s => /password|match|must|least|character|invalid|success|updated|reset|not found|registered|valid/i.test(s));
  }
}
