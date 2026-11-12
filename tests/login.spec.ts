import { test, expect } from '@playwright/test';
import { LoginPage } from '../pages/LoginPage';
import { HomePage } from '../pages/HomePage';

const USER = process.env.ALUMNI_USER!;
const PASS = process.env.ALUMNI_PASS!;

test.describe('Alumni Portal - Login', () => {
  let loginPage: LoginPage;

  test.beforeEach(async ({ page }) => {
    loginPage = new LoginPage(page);
    await loginPage.goto();
  });

  test('unauthenticated user is redirected to the login page', async ({ page }) => {
    await expect(page).toHaveURL(/\/alumni\/login\?.*startURL=/);
    await expect(page).toHaveTitle(/^Login( \| Kenverse)?$/);
  });

  test('login page shows all expected elements', async () => {
    await expect(loginPage.page.getByText('Continue your journey with the alumni community')).toBeVisible();
    await expect(loginPage.email).toBeVisible();
    await expect(loginPage.password).toBeVisible();
    await expect(loginPage.password).toHaveAttribute('type', 'password');
    // The redesigned page (seen 2026-11-12) has no "Remember Me" or one-time-password link.
    await expect(loginPage.resetLink).toBeVisible();
    await expect(loginPage.loginButton).toBeEnabled();
    await expect(loginPage.linkedInButton).toBeVisible();
    await expect(loginPage.googleButton).toBeVisible();
    await expect(loginPage.registerLink).toBeVisible();
  });

  test('submitting empty form shows required-field errors', async ({ page }) => {
    await loginPage.loginButton.click();
    await expect(loginPage.requiredError).toHaveCount(2);
    await expect(page).toHaveURL(/\/login/);
  });

  test('empty password shows required-field error', async ({ page }) => {
    await loginPage.email.fill(USER);
    await loginPage.loginButton.click();
    await expect(loginPage.requiredError).toHaveCount(1);
    await expect(page).toHaveURL(/\/login/);
  });

  test('wrong password shows invalid-credentials error', async ({ page }) => {
    await loginPage.login(USER, 'WrongPass@123');
    await expect(loginPage.invalidCredentialsError).toBeVisible();
    await expect(page.getByText('The email or password you entered is incorrect.')).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });

  test('unregistered email shows invalid-credentials error', async ({ page }) => {
    // Known bug (seen 2026-09-29): an unregistered email shows no error at all and the page
    // just stays on login. Remove this line once the portal shows the error.
    test.fail(true, 'BUG: no error message shown for unregistered email');
    await loginPage.login('not.a.user.qa@example.com', 'Whatever@123');
    await expect(loginPage.invalidCredentialsError).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });

  test('valid credentials log in and land on Home', async ({ page }) => {
    await loginPage.login(USER, PASS);
    const home = new HomePage(page);
    await home.waitForLoaded();
    await expect(page).toHaveURL(/\/alumni\/$/);
  });

  // Logs in with its own session: logging out invalidates the Salesforce session,
  // so this must not reuse the shared storage state from auth.setup.ts.
  test('logout returns to the login page and protects Home', async ({ page }) => {
    await loginPage.login(USER, PASS);
    const home = new HomePage(page);
    await home.waitForLoaded();

    await home.logout();
    await expect(page).toHaveURL(/\/alumni\/login/);
    await expect(loginPage.email).toBeVisible();

    await page.goto('./');
    await expect(page).toHaveURL(/\/alumni\/login/);
  });
});
