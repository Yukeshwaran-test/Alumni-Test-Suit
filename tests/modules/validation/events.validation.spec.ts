import { test, expect } from '../../network/fixtures';
import { HostEventPage } from '../../../pages/HostEventPage';
import { snap } from '../../../utils/report';
import { expectEditorCap, expectMaxLength, expectUploadRejected, FILES, knownBug, newTextDuring, SF_LIMITS } from '../../../utils/validation';

/** Events > Host an event - Step 1 (Event Setup) input validation. Nothing here reaches step 2 unless the portal is broken. */
test.describe('Validation - Events (Host an event)', () => {
  let w: HostEventPage;
  test.beforeEach(async ({ page }) => {
    w = new HostEventPage(page);
    await w.goto();
  });

  test('Event title: maximum 50 characters (Salesforce limit 80)', async ({ page }) => {
    await expect(w.titleInput).toHaveAttribute('maxlength', '50');
    await expectMaxLength(w.titleInput, 50, 'Event title');
    expect(50).toBeLessThanOrEqual(SF_LIMITS.eventTitle);
    await snap(page, 'Event title limit');
  });

  test('Description 500 / Agenda 300 / What to Expect 1000 characters are enforced', async ({ page }) => {
    await expectEditorCap(page, w.editor('Description'), 500, 'Description');
    await expectEditorCap(page, w.editor('Agenda'), 300, 'Agenda');
    await expectEditorCap(page, w.editor('What to Expect'), 1000, 'What to Expect');
    await snap(page, 'Rich text limits');
  });

  test('Spaces-only title and What to Expect are rejected', async ({ page }) => {
    await w.uploadCover(FILES.validCover);
    await w.titleInput.pressSequentially('     ');
    await w.chooseCategory('Seminar');
    await page.locator('main .calendar-nav').nth(1).click();
    await page.locator('main .calendar-day:not(.disabled)').nth(10).click();
    await w.editor('What to Expect').click();
    await page.keyboard.type('     ');
    await w.saveAndProceed.click();
    await expect(page.getByText('This field is required').first()).toBeVisible();
    await w.expectStep(1);
    await snap(page, 'Spaces-only rejected');
  });

  test('Maximum participants: negative, zero and decimals are rejected', async ({ page }) => {
    knownBug('Maximum participants accepts 0 and decimals (1.5) without an error; only negative values are rejected.');
    const f = page.getByPlaceholder('Number of participants expected');
    await f.pressSequentially('-5');
    await f.blur();
    await expect.soft(page.getByText('Value cannot be negative'), '-5 rejected').toBeVisible();
    for (const v of ['0', '1.5']) {
      const appeared = await newTextDuring(page, async () => {
        await f.clear();
        await f.pressSequentially(v);
        await f.blur();
      }, 1500);
      const error = appeared.find(s => /must|cannot|whole number|greater|at least|invalid/i.test(s));
      expect.soft(error, `participants "${v}" must be rejected (new text: ${JSON.stringify(appeared)})`).toBeTruthy();
    }
    await snap(page, 'Participants validation');
  });

  test('Guests per participant: cannot go below 1 or be negative', async ({ page }) => {
    knownBug('Guests per participant accepts -3 and the "-" button goes down to 0 although guests are allowed (should be at least 1).');
    const f = page.getByLabel('How many guests can each participant bring?*');
    for (let i = 0; i < 3; i++) await page.locator('main').getByRole('button', { name: '-', exact: true }).click();
    expect.soft(Number(await f.inputValue()), '"-" button must stop at 1').toBeGreaterThanOrEqual(1);
    await f.clear();
    await f.pressSequentially('-3');
    await f.blur();
    const value = Number(await f.inputValue());
    const error = await page.locator('main').getByText(/cannot be negative|at least|must be/i).count();
    expect.soft(value >= 1 || error > 0, `guests "-3" must be rejected (field shows "${value}")`).toBe(true);
    await snap(page, 'Guests validation');
  });

  test('Cover photo: over 2 MB and non-image files are rejected with a message', async ({ page }) => {
    await expectUploadRejected(page, w.coverInput, FILES.png3mb, 'Cover 3 MB');
    await expect(page.getByText('Cover photo must be 2 MB or smaller').first()).toBeVisible();
    await expectUploadRejected(page, w.coverInput, FILES.notAnImage, 'Cover .txt');
    await snap(page, 'Cover upload validation');
  });
});
