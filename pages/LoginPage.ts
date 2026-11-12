import { expect, type Locator, type Page } from '@playwright/test';

export class LoginPage {
  readonly email: Locator;
  readonly password: Locator;
  readonly loginButton: Locator;
  readonly rememberMe: Locator;
  readonly resetLink: Locator;
  readonly otpLink: Locator;
  readonly linkedInButton: Locator;
  readonly googleButton: Locator;
  readonly registerLink: Locator;
  readonly requiredError: Locator;
  readonly invalidCredentialsError: Locator;

  constructor(readonly page: Page) {
    // Located by label: the placeholder changed in the redesign (now "you@example.com").
    this.email = page.getByRole('textbox', { name: /^Email/ });
    this.password = page.getByPlaceholder('Enter password');
    this.loginButton = page.getByRole('button', { name: 'Login', exact: true });
    this.rememberMe = page.getByText('Remember Me');
    this.resetLink = page.getByRole('button', { name: 'Reset Password' });
    this.otpLink = page.getByText('Sign in with a one-time password');
    this.linkedInButton = page.getByRole('button', { name: 'LinkedIn' });
    this.googleButton = page.getByRole('button', { name: 'Google' });
    this.registerLink = page.getByRole('button', { name: 'Register Now' });
    // The portal uses a curly apostrophe ("can’t").
    this.requiredError = page.getByText(/This field can.t be empty\./);
    this.invalidCredentialsError = page.getByText('Incorrect Email Or Password');
  }

  async goto() {
    await this.page.goto('./');
    await expect(this.page).toHaveURL(/\/alumni\/login/);
    await expect(this.email).toBeVisible();
  }

  async login(email: string, password: string) {
    // Clear any existing/autofilled value first, then type the credentials key by key.
    for (const [field, value] of [[this.email, email], [this.password, password]] as const) {
      await field.clear();
      await expect(field).toHaveValue('');
      await field.pressSequentially(value, { delay: 30 });
      await expect(field).toHaveValue(value);
    }
    await this.loginButton.click();
  }
}
