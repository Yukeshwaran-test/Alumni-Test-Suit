import { expect, type Locator, type Page } from '@playwright/test';
import { YopMail } from '../utils/yopmail';

/**
 * "Verify OTP" step shared by Registration (Step 2 of 2) and Reset Password (Step 2 of 3).
 * Four single-digit boxes, a Resend OTP button (after a ~1 min timer) and Verify.
 * The OTP mail can take ~50 s to arrive and the OTP is valid for 1 minute, so `verifyFromMail`
 * resends and retries when the code has already expired.
 */
export class OtpStep {
  readonly heading: Locator;
  readonly sentTo: Locator;
  readonly digits: Locator;
  readonly verifyButton: Locator;
  readonly resendButton: Locator;
  readonly resendTimer: Locator;
  readonly incompleteError: Locator;
  readonly invalidError: Locator;
  readonly resentMessage: Locator;

  constructor(readonly page: Page) {
    this.heading = page.getByText('Verify OTP', { exact: true });
    this.sentTo = page.getByText('An OTP has been sent to');
    this.digits = page.getByLabel('Verification code digit');
    this.verifyButton = page.getByRole('button', { name: 'Verify', exact: true });
    this.resendButton = page.getByRole('button', { name: 'Resend OTP' });
    this.resendTimer = page.getByText(/Resend OTP in \d+:\d\d/);
    this.incompleteError = page.getByText('Please enter the complete OTP.');
    this.invalidError = page.getByText('The OTP you entered is invalid. Please try again.');
    this.resentMessage = page.getByText('We have sent a new verification code to your email.');
  }

  async waitForVisible() {
    await expect(this.heading).toBeVisible({ timeout: 60_000 });
    await expect(this.digits).toHaveCount(4);
  }

  async enter(code: string) {
    for (let i = 0; i < 4; i++) await this.digits.nth(i).fill('');
    await this.digits.first().click();
    await this.page.keyboard.type(code, { delay: 60 });
  }

  async values() {
    return this.digits.evaluateAll(es => es.map(e => (e as HTMLInputElement).value).join(''));
  }

  async resend() {
    await expect(this.resendButton).toBeVisible({ timeout: 75_000 });
    await this.resendButton.click();
    await expect(this.resentMessage).toBeVisible();
  }

  /**
   * Read the OTP from YOPmail, enter it and press Verify. On "invalid" (expired) it resends and retries.
   * `done` = locator that only appears once verification succeeded. Returns the attempts made.
   */
  async verifyFromMail(yop: YopMail, subject: RegExp, done: Locator, mailsBefore: number, maxAttempts = 3) {
    const attempts: { otp: string; deliveredAfterS: number; result: string }[] = [];
    let seen = mailsBefore;
    for (let i = 0; i < maxAttempts; i++) {
      const mail = await yop.waitForMail(subject, { newerThanCount: seen, timeoutMs: 150_000 });
      seen = await yop.count(subject);
      const otp = YopMail.otpFrom(mail.text);
      await this.page.bringToFront();
      await this.enter(otp);
      await this.verifyButton.click();
      const outcome = await Promise.race([
        done.waitFor({ timeout: 45_000 }).then(() => 'verified'),
        this.invalidError.waitFor({ timeout: 45_000 }).then(() => 'invalid/expired'),
      ]).catch(() => 'no response');
      attempts.push({ otp, deliveredAfterS: Math.round(mail.deliveredAfterMs / 1000), result: outcome });
      if (outcome === 'verified') return attempts;
      await this.resend();
    }
    throw new Error(`OTP verification did not succeed: ${JSON.stringify(attempts)}`);
  }
}
