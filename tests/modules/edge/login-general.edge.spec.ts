import { test, expect } from '../../network/fixtures';
import { LoginPage } from '../../../pages/LoginPage';
import { snap } from '../../../utils/report';
import { watchDialogs } from '../../../utils/validation';

/** Edge cases: Login input (LGN-009..011), session expiry (GEN-003), phone-width layout (GEN-004). */
const USER = process.env.ALUMNI_USER!;
const PASS = process.env.ALUMNI_PASS!;

test.describe('Edge cases - Login', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('LGN-009: email with spaces around it is trimmed or clearly rejected', async ({ page }) => {
    const login = new LoginPage(page);
    await login.goto();
    await login.login(`  ${USER}  `, PASS);
    // Either the spaces are trimmed (login works) or the user is told the email is invalid.
    await expect(page.getByText('Please enter a valid email address.').or(page.getByRole('button', { name: 'Notifications', exact: true }))).toBeVisible({ timeout: 30_000 });
    await snap(page, 'Email with spaces');
  });

  test('LGN-010: email in capitals logs in (emails are case-insensitive)', async ({ page }) => {
    const login = new LoginPage(page);
    await login.goto();
    await login.login(USER.toUpperCase(), PASS);
    await expect(page).toHaveTitle(/^Home( \| Kenverse)?$/, { timeout: 60_000 });
    await snap(page, 'Upper-case email logged in');
  });

  test('LGN-011: SQL / script text as email is rejected safely', async ({ page }) => {
    const dialogs = watchDialogs(page);
    const login = new LoginPage(page);
    for (const email of ["' OR 1=1--", '<script>alert(1)</script>']) {
      await test.step(email, async () => {
        await login.goto();
        await login.login(email, 'whatever');
        await expect(page.getByText(/Please enter a valid email address\.|Incorrect Email Or Password/).first()).toBeVisible();
        await expect(page).toHaveURL(/\/login/);
      });
    }
    expect(dialogs, 'no script ran').toEqual([]);
  });
});

test.describe('Edge cases - General', () => {
  test('GEN-003: expired session sends the user to login', async ({ page }) => {
    await page.goto('event');
    await expect(page).toHaveTitle(/^Event( \| Kenverse)?$/, { timeout: 60_000 });
    await page.context().clearCookies(); // same effect as the session expiring
    await page.goto('event');
    await expect(page).toHaveURL(/\/alumni\/login\?.*startURL=%2Falumni%2Fevent/);
    await expect(page.getByRole('textbox', { name: /^Email/ })).toBeVisible();
    await snap(page, 'Session expired - login');
  });

  test('GEN-004: phone width (375 px) layout has no sideways scrolling', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    for (const path of ['./', 'event', 'network', 'group', 'business', 'fundraise']) {
      await test.step(path, async () => {
        await page.goto(path);
        await page.waitForLoadState('load');
        await page.waitForTimeout(4000);
        const { scrollW, clientW } = await page.evaluate(() => ({ scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth }));
        expect.soft(scrollW, `${path}: page wider than the screen (${scrollW}px vs ${clientW}px)`).toBeLessThanOrEqual(clientW + 2);
        await snap(page, `Phone width - ${path}`);
      });
    }
    await expect(page.getByRole('button', { name: /menu|navigation|toggle/i }).first(), 'a menu button is available on small screens').toBeVisible();
  });
});
