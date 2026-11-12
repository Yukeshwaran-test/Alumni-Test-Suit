import { test, expect } from '../../network/fixtures';
import { MentorshipPage } from '../../../pages/MentorshipPage';
import { snap } from '../../../utils/report';
import { expectMaxLength } from '../../../utils/validation';

/**
 * Mentorship > Add Task / Schedule a Call input validation.
 * Every check leaves a required field empty or invalid, so no task or call is ever created.
 */
test.describe('Validation - Mentorship', () => {
  let m: MentorshipPage;
  test.beforeEach(async ({ page }) => {
    m = new MentorshipPage(page);
    await m.goto();
    test.skip(!(await m.addTask.isVisible()), 'This user has no mentorship connections');
  });

  test('Add Task: title limited to 255 characters', async ({ page }) => {
    await m.addTask.click();
    await expect(m.taskTitle).toHaveAttribute('maxlength', '255');
    await expectMaxLength(m.taskTitle, 255, 'Task title');
    await page.getByRole('button', { name: 'Cancel' }).click();
  });

  test('Add Task: spaces-only title is treated as empty', async ({ page }) => {
    await m.addTask.click();
    await m.taskTitle.fill('     ');
    await m.saveTask.click(); // status is still empty, so nothing can be saved
    await expect(page.getByText('Title is required.')).toBeVisible();
    await expect(page.getByText('Status is required.')).toBeVisible();
    await snap(page, 'Task - spaces-only title');
    await page.getByRole('button', { name: 'Cancel' }).click();
  });

  test('Schedule a Call: spaces-only title and malformed meeting link are rejected', async ({ page }) => {
    test.info().annotations.push({ type: 'Known bug (2026-10-01)', description: 'Meeting link accepts "ftp://example.com"; only http:// or https:// links make sense for an online meeting.' });
    await m.scheduleCall.click();
    await m.callTitle.fill('     ');
    for (const link of ['not-a-url', 'meet.example.com', 'ftp://example.com']) {
      await test.step(`meeting link "${link}"`, async () => {
        await m.meetLink.fill(link);
        await m.sendRequest.click();
        await expect.soft(page.getByText(/Invalid URL|invalid format|valid URL/i).first(), `"${link}" must be rejected`).toBeVisible();
      });
    }
    await expect(page.getByText('Title is required.')).toBeVisible();
    await snap(page, 'Schedule a Call - invalid inputs');
    await page.getByRole('button', { name: 'Cancel' }).click();
  });
});
