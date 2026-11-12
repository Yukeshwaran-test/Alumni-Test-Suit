import { test, expect } from '@playwright/test';
import { HomePage, HOME_WIDGETS, NAV_ITEMS } from '../pages/HomePage';
import { closeProfileWizard } from '../utils/report';

test.describe('Alumni Portal - Home (logged in)', () => {
  let home: HomePage;

  test.beforeEach(async ({ page }) => {
    await closeProfileWizard(page);
    home = new HomePage(page);
    await home.goto();
  });

  test('shows the logged-in user profile', async ({ page }) => {
    await expect(home.userName('yukeshwaran C')).toBeVisible();
    await expect(page.getByText('Batch - 2020')).toBeVisible();
  });

  test('sidebar shows every navigation item', async () => {
    for (const label of ['Home', ...NAV_ITEMS.map(n => n.label), 'Logout']) {
      await expect(home.navItem(label), `sidebar item "${label}"`).toBeVisible();
    }
  });

  test('dashboard shows all widgets', async ({ page }) => {
    await expect(page.getByText('Newsletter', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Read Now' })).toBeVisible();
    for (const widget of HOME_WIDGETS) {
      await expect(page.getByText(widget, { exact: true }).first(), `widget "${widget}"`).toBeVisible();
    }
  });

  test('quick links are available', async ({ page }) => {
    for (const link of ['Host An Event', 'Contribute Now', 'Post Your Business', 'Create A Group']) {
      await expect(page.getByRole('button', { name: link }), `quick link "${link}"`).toBeVisible();
    }
  });

  for (const item of NAV_ITEMS) {
    test(`sidebar "${item.label}" opens ${item.path}`, async ({ page }) => {
      await home.navItem(item.label).click();
      await expect(page).toHaveURL(new RegExp(`${item.path}$`));
      await expect(page).toHaveTitle(new RegExp(`^${item.title}( \\| Kenverse)?$`));
    });
  }

  test('sidebar "Home" returns to Home from another page', async ({ page }) => {
    await home.navItem('Jobs').click();
    await expect(page).toHaveURL(/\/alumni\/job$/);
    await home.navItem('Home').click();
    await home.waitForLoaded();
  });
});
