import { test as setup, expect } from '@playwright/test';
import { AUTH_FILE } from '../playwright.config';
import { LoginPage } from '../pages/LoginPage';
import { HomePage } from '../pages/HomePage';

setup('authenticate', async ({ page }) => {
  const loginPage = new LoginPage(page);
  await loginPage.goto();
  await loginPage.login(process.env.ALUMNI_USER!, process.env.ALUMNI_PASS!);

  await new HomePage(page).waitForLoaded();
  await expect(page).not.toHaveURL(/\/login/);
  await page.context().storageState({ path: AUTH_FILE });
});
