import { test as setup, expect } from '@playwright/test';
import { RECEIVER_AUTH_FILE } from '../playwright.config';
import { LoginPage } from '../pages/LoginPage';
import { HomePage } from '../pages/HomePage';

// Second alumni account, used as the receiver in the Network (connections + chat) tests.
// Its own setup project, so a broken receiver account only blocks the Network module.
setup('authenticate network receiver', async ({ page }) => {
  const loginPage = new LoginPage(page);
  await loginPage.goto();
  await loginPage.login(process.env.NET_RECEIVER_USER!, process.env.NET_RECEIVER_PASS!);

  await new HomePage(page).waitForLoaded();
  await expect(page).not.toHaveURL(/\/login/);
  await page.context().storageState({ path: RECEIVER_AUTH_FILE });
});
