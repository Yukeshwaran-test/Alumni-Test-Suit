import { test, expect } from '../../network/fixtures';
import { MentorshipPage } from '../../../pages/MentorshipPage';
import { SupportPage } from '../../../pages/SupportPage';
import { snap } from '../../../utils/report';
import { INPUTS, knownBug, newTextDuring, watchDialogs } from '../../../utils/validation';

/** Edge cases: MEN-008 task end date in the past, MEN-011 call end time before start, SUP-015 help-topic search. */

/** "10:15 PM" -> minutes since midnight */
const minutes = (t: string) => {
  const m = t.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!m) return NaN;
  return ((Number(m[1]) % 12) + (m[3].toUpperCase() === 'PM' ? 12 : 0)) * 60 + Number(m[2]);
};

test.describe('Edge cases - Mentorship', () => {
  let m: MentorshipPage;
  test.beforeEach(async ({ page }) => {
    m = new MentorshipPage(page);
    await m.goto();
    test.skip(!(await m.addTask.isVisible()), 'This user has no mentorship connections');
  });

  test('MEN-008: task end date in the past is not accepted', async ({ page }) => {
    await m.addTask.click();
    await expect(page.getByRole('heading', { name: 'Add Task' })).toBeVisible();
    await expect(page.getByText(/Select a date after/).first(), 'date hint shown').toBeVisible();
    const endDate = page.getByText('End Date (Optional)').locator('xpath=following::input[1]');
    const appeared = await newTextDuring(page, async () => {
      await endDate.fill('Jan 1, 2020');
      await endDate.blur();
      await m.saveTask.click(); // title/status empty, so nothing can be saved
    }, 1500);
    const value = await endDate.inputValue();
    const error = appeared.find(s => /after|past|invalid|later|must/i.test(s));
    await snap(page, 'Task - past end date');
    expect(value !== 'Jan 1, 2020' || !!error, `past end date must be rejected (field "${value}", new text ${JSON.stringify(appeared)})`).toBe(true);
    await page.getByRole('button', { name: 'Cancel' }).click();
  });

  test('MEN-011: call end time can only be after the start time', async ({ page }) => {
    await m.scheduleCall.click();
    await m.startTime.click();
    const starts = await page.getByRole('option').allInnerTexts();
    expect(starts.length).toBeGreaterThan(0);
    const pick = starts[Math.floor(starts.length / 2)];
    await page.getByRole('option', { name: pick, exact: true }).click();
    await m.endTime.click();
    const ends = await page.getByRole('option').allInnerTexts();
    await page.keyboard.press('Escape');
    await snap(page, `Call - start ${pick}`);
    expect(ends.length, 'end time options offered').toBeGreaterThan(0);
    const tooEarly = ends.filter(e => minutes(e) <= minutes(pick));
    expect(tooEarly, `end times at or before the start (${pick}) must not be offered`).toEqual([]);
    await page.getByRole('button', { name: 'Cancel' }).click();
  });
});

test.describe('Edge cases - Service & Support', () => {
  test('SUP-015: help-topic search finds FAQs and handles hostile input', async ({ page }) => {
    const dialogs = watchDialogs(page);
    const s = new SupportPage(page);
    await s.goto();
    const box = page.getByPlaceholder('Search for help topics...');
    await test.step('Hostile input is treated as text', async () => {
      for (const q of [INPUTS.script, INPUTS.sql]) {
        await box.fill('');
        await box.pressSequentially(q);
        await box.press('Enter');
        await expect(page.getByText(/No results found/).first()).toBeVisible();
      }
      expect(dialogs, 'no script ran').toEqual([]);
    });
    await test.step('A common topic returns FAQs', async () => {
      knownBug('Every help search returns "No results found" - FAQs never load (Apex getFAQs returns HTTP 400).');
      await box.fill('');
      await box.pressSequentially('password');
      await box.press('Enter');
      await snap(page, 'Help search "password"');
      await expect.soft(page.getByText(/No results found/), '"password" should match at least one FAQ').toHaveCount(0, { timeout: 5_000 });
    });
  });
});
