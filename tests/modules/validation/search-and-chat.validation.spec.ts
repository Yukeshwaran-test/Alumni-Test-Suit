import { test, expect } from '../../network/fixtures';
import { ChatPage } from '../../../pages/NetworkPage';
import { snap } from '../../../utils/report';
import { INPUTS, knownBug, watchDialogs } from '../../../utils/validation';

/**
 * Search boxes (Network, Groups, Events, Business Directory, Feedback & Survey) and Network chat.
 * Hostile input must be treated as plain text: no script runs, no server error, page keeps working.
 */
const SEARCHES = [
  { module: 'Network', path: 'network', empty: 'No results found' },
  { module: 'Groups', path: 'group', empty: 'No groups match your filters' },
  { module: 'Events', path: 'event', empty: 'No events match your filters' },
  { module: 'Business Directory', path: 'business', empty: null },
  { module: 'Feedback & Survey', path: 'survey', empty: null },
];

test.describe('Validation - search boxes and chat', () => {
  for (const s of SEARCHES) {
    test(`${s.module} search: SQL, script, wildcard and 300-character input are handled safely`, async ({ page }) => {
      const dialogs = watchDialogs(page);
      const errors: string[] = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.goto(s.path);
      const box = page.getByPlaceholder('Search', { exact: true });
      await expect(box).toBeVisible({ timeout: 60_000 });
      for (const q of [INPUTS.sql, INPUTS.script, INPUTS.imgOnError, INPUTS.wildcards, 'x'.repeat(300)]) {
        await test.step(`search "${q.slice(0, 30)}"`, async () => {
          await box.clear();
          await box.pressSequentially(q, { delay: 0 });
          await page.waitForTimeout(1500);
          if (s.empty) await expect.soft(page.getByText(s.empty).first(), 'shows the "no results" message').toBeVisible();
          await expect.soft(page.getByText(/something went wrong|unexpected error|exception/i), 'no error shown').toHaveCount(0);
        });
      }
      await box.clear();
      await snap(page, `${s.module} search`);
      expect(dialogs, 'injected script must not run (no browser dialogs)').toEqual([]);
      expect.soft(errors.filter(e => /alert|xss/i.test(e)), 'no script errors caused by the input').toEqual([]);
    });
  }

  test('Chat: blank / spaces-only messages cannot be sent', async ({ page }) => {
    const chat = new ChatPage(page);
    await chat.goto();
    const first = page.locator('.chat-card').first();
    await first.waitFor({ timeout: 30_000 }).catch(() => {}); // conversation list loads after the page
    test.skip(!(await first.isVisible()), 'No conversations for this user');
    await first.click();
    await expect(chat.input).toBeVisible();
    await expect(chat.sendButton).toBeDisabled();
    await chat.input.pressSequentially('     ');
    await expect(chat.sendButton).toBeDisabled();
    await chat.input.clear();
  });

  test('Chat: message length is limited', async ({ page }) => {
    knownBug('The chat box has no length limit - a 6,000-character message can be typed and Send stays enabled.');
    const chat = new ChatPage(page);
    await chat.goto();
    const first = page.locator('.chat-card').first();
    await first.waitFor({ timeout: 30_000 }).catch(() => {});
    test.skip(!(await first.isVisible()), 'No conversations for this user');
    await first.click();
    await chat.input.fill('x'.repeat(6000));
    const len = (await chat.input.inputValue()).length;
    const warned = await page.getByText(/characters|too long|limit/i).count();
    await chat.input.fill(''); // never send it
    expect(len <= 5000 || warned > 0, `chat accepted ${len} characters with no limit or warning`).toBe(true);
  });
});
