import { test, expect } from './fixtures';
import { ChatPage, NetworkPage } from '../../pages/NetworkPage';
import { snap } from '../../utils/report';

// Read-only checks: nothing here sends requests or messages.
test.describe('Network module - directory, profile and chat (read-only)', () => {
  test('POSITIVE: sidebar "Network" opens the alumni directory', async ({ page }) => {
    await page.goto('./');
    await page.getByText('Network', { exact: true }).first().click();
    await expect(page).toHaveURL(/\/alumni\/network$/);
    const network = new NetworkPage(page);
    await expect(network.allAlumniTab).toBeVisible();
    await expect(network.yourConnectionsTab).toBeVisible();
    await expect(network.mapViewTab).toBeVisible();
    await expect(network.search).toBeVisible();
    await expect(network.sortBy).toBeVisible();
    await expect(network.filters).toBeVisible();
    await expect(page.locator('.alumni-card').first()).toBeVisible();
    await snap(page, 'Network directory');
  });

  test('POSITIVE: searching by name finds that alumnus', async ({ page }) => {
    const network = new NetworkPage(page);
    await network.goto();
    const name = (await page.locator('.alumni-card h3').first().innerText()).trim();
    await network.searchFor(name);
    await expect(network.card(name).first()).toBeVisible();
    await expect(network.noResults).toBeHidden();
    await snap(page, `Search "${name}"`);
  });

  test('NEGATIVE: searching an unknown name shows "No results found"', async ({ page }) => {
    const network = new NetworkPage(page);
    await network.goto();
    await network.searchFor('zzzz-no-such-alumnus-qa');
    await expect(network.noResults).toBeVisible();
    await expect(page.locator('.alumni-card')).toHaveCount(0);
    await snap(page, 'Search - no results');
  });

  test('POSITIVE: clicking a card opens that alumnus\'s profile', async ({ page }) => {
    const network = new NetworkPage(page);
    await network.goto();
    const name = (await page.locator('.alumni-card h3').first().innerText()).trim();
    await network.card(name).first().click();
    await expect(page).toHaveURL(/network\?profileId=001/);
    await expect(page.getByText(name, { exact: true }).last()).toBeVisible();
    await expect(page.getByText('Educational Background').first()).toBeVisible();
    await snap(page, `Profile - ${name}`);
  });

  test('NEGATIVE: a non-connected profile has no "Message" option', async ({ page }) => {
    const network = new NetworkPage(page);
    await network.goto();
    await network.allAlumniTab.click();
    const name = (await page.locator('.alumni-card h3').first().innerText()).trim();
    await network.card(name).first().click();
    // All Alumni lists people you are NOT connected to, so chat must not be offered.
    await expect(page.getByRole('button', { name: /Connect \+|Connection Requested/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Message', exact: true })).toHaveCount(0);
    await snap(page, `Profile - ${name} (not connected)`);
  });

  test('NEGATIVE: chat Send is disabled for an empty or blank message', async ({ page }) => {
    const chat = new ChatPage(page);
    await chat.goto();
    const first = page.locator('.chat-card').first();
    test.skip(!(await first.isVisible()), 'No conversations for this user');
    const name = (await first.locator('.chat-card-name').innerText()).trim();
    await chat.open(name);
    await expect(chat.sendButton).toBeDisabled();
    await chat.input.pressSequentially('     ', { delay: 20 });
    await expect(chat.sendButton, 'spaces only').toBeDisabled();
    await snap(page, 'Chat - blank message, Send disabled');
    await chat.input.clear();
  });

  test('NEGATIVE: logged-out user cannot open the Network page', async ({ browser }) => {
    const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await context.newPage();
    await page.goto(new URL('network', process.env.BASE_URL).toString());
    await expect(page).toHaveURL(/\/alumni\/login/);
    await snap(page, 'Network - redirected to login');
    await context.close();
  });
});
