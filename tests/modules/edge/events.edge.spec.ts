import { test, expect } from '../../network/fixtures';
import { HostEventPage } from '../../../pages/HostEventPage';
import { note, snap } from '../../../utils/report';
import { displayDate, newEventData } from '../../../utils/testData';

/**
 * Events edge cases: EVT-016 multi-day, EVT-024 start = end time, EVT-025 On-site/Hybrid,
 * EVT-036 Save as Draft (+ resume), EVT-037 Previous step keeps data, EVT-038 Cancel.
 * Note: the wizard saves a draft after every step, so these tests leave "QA Edge ..." drafts in the sandbox.
 */
const stamp = () => Date.now().toString().slice(-6);

async function audienceAll(w: HostEventPage) {
  await w.type(w.audienceSearch, 'all audience');
  await w.savedAudienceRow('all audience').getByRole('button', { name: 'Review & Add' }).click();
  await w.page.getByRole('dialog').getByRole('button', { name: 'Add Audience' }).click();
  await expect(w.main.getByText('Selected Audience')).toBeVisible();
}

test.describe('Edge cases - Events (Host an event)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('./'); // warm-up; each test opens the wizard itself
  });

  test('EVT-038: Cancel asks for confirmation and leaves the wizard', async ({ page }) => {
    const w = new HostEventPage(page);
    await w.goto();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page.getByText('Cancel Event Creation')).toBeVisible();
    await expect(page.getByText('Are you sure you want to cancel? Any unsaved changes will be lost.')).toBeVisible();
    await snap(page, 'Cancel confirmation');
    await page.getByRole('button', { name: 'Yes, cancel' }).click();
    await expect(page).not.toHaveURL(/host-event/, { timeout: 30_000 });
    await snap(page, 'After cancel');
  });

  test('EVT-016 / 037 / 024 / 025: multi-day event, Previous keeps data, time and venue checks', async ({ page }) => {
    const w = new HostEventPage(page);
    const d = { ...newEventData(), title: `QA Edge Multi ${stamp()}` };
    await note('Event (left as draft)', d.title);
    await w.goto();
    let dates: string[] = [];

    await test.step('EVT-016: pick two dates', async () => {
      await w.uploadCover('tests/fixtures/cover-1200x800.png');
      await w.type(w.titleInput, d.title);
      await w.chooseCategory('Seminar');
      await w.main.locator('.calendar-nav').nth(1).click();
      const days = w.main.locator('.calendar-day:not(.disabled)');
      dates = [(await days.nth(12).getAttribute('data-date'))!, (await days.nth(13).getAttribute('data-date'))!];
      await days.nth(12).click();
      await days.nth(13).click();
      for (const iso of dates) await expect(w.main.getByText(displayDate(iso), { exact: true })).toBeVisible();
      await w.editor('What to Expect').click();
      await page.keyboard.type('Multi-day edge case.');
      await snap(page, 'Two dates selected');
      await w.saveAndProceed.click();
      await w.expectStep(2);
    });

    await test.step('EVT-037: Previous step keeps title and both dates', async () => {
      await w.previousStep.click();
      await w.expectStep(1);
      await expect(w.titleInput).toHaveValue(d.title);
      for (const iso of dates) await expect(w.main.getByText(displayDate(iso), { exact: true })).toBeVisible();
      await snap(page, 'Back on step 1 - data kept');
      await w.saveAndProceed.click();
      await w.expectStep(2);
    });

    await audienceAll(w);
    await w.saveAndProceed.click();
    await w.expectStep(3);

    await test.step('EVT-016: Schedule Setup shows one tab per day', async () => {
      for (const iso of dates) await expect(page.getByRole('button', { name: displayDate(iso) })).toBeVisible();
    });

    await page.getByRole('button', { name: 'Add Session' }).first().click();
    await w.type(w.sessionTitle, 'Day 1 session');
    await test.step('EVT-024: start time equal to end time is rejected', async () => {
      await w.startTime.fill('10:00');
      await w.endTime.fill('10:00');
      await w.endTime.blur();
      await expect(page.getByText('End time must be later than start time')).toBeVisible();
    });
    await w.endTime.fill('11:00');
    await w.type(w.sessionAgenda, 'Agenda');

    await test.step('EVT-025: On-site needs a venue address', async () => {
      await w.main.getByText('On-site', { exact: true }).first().click();
      await expect(page.getByPlaceholder('Enter venue address')).toBeVisible();
      await w.saveAndProceed.click();
      await expect(page.getByText('This field is required for On University Campus event')).toBeVisible();
      await w.expectStep(3);
      await snap(page, 'On-site - address required');
    });
    await test.step('EVT-025: Hybrid asks for venue address and event link', async () => {
      await w.main.getByText('Hybrid', { exact: true }).first().click();
      await expect(page.getByPlaceholder('Enter venue address')).toBeVisible();
      await expect(page.getByPlaceholder('Enter event link')).toBeVisible();
      await page.getByPlaceholder('Enter venue address').fill('12 QA Street, Coimbatore');
      await w.type(w.eventLink, 'https://meet.example.com/edge');
    });
    await test.step('EVT-016: every day needs a session before continuing', async () => {
      test.info().annotations.push({ type: 'Note', description: 'The wizard stays on step 3 with no message when the second day has no session.' });
      await w.saveAndProceed.click();
      await w.expectStep(3);
      await expect(page.getByText('Step 4 out of 6')).toBeHidden({ timeout: 5_000 });
      await snap(page, 'Day 2 without a session - still on step 3');
    });
  });

  test('EVT-036: Save as Draft keeps the event under Drafts and it can be resumed', async ({ page }) => {
    const w = new HostEventPage(page);
    const d = { ...newEventData(), title: `QA Edge Draft ${stamp()}` };
    await note('Draft event', d.title);
    await w.goto();
    await w.fillEventSetup(d);
    await w.saveAndProceed.click();
    await w.expectStep(2);
    await audienceAll(w);
    await w.saveAndProceed.click();
    await w.expectStep(3);
    await page.getByRole('button', { name: 'Add Session' }).click();
    await w.fillSession(d.session);
    await w.saveAndProceed.click();
    await w.expectStep(4);

    await test.step('Save as Draft on step 4', async () => {
      await w.saveAsDraft.click();
      await page.waitForTimeout(4000);
      await snap(page, 'After Save as Draft');
    });
    await test.step('Draft listed under Hosted Events > Drafts', async () => {
      await page.goto('event/hosted-events');
      await page.locator('main').getByText('Drafts', { exact: true }).first().click();
      const card = page.locator('main .event-card').filter({ hasText: d.title });
      await expect(card).toBeVisible();
      await expect(card.getByRole('button', { name: 'Continue Event Setup' })).toBeVisible();
      await snap(page, 'Drafts tab');
    });
    await test.step('Continue Event Setup resumes and sessions can still be edited', async () => {
      test.info().annotations.push({ type: 'Note', description: 'Seen once during exploration: a draft saved at step 2 (before any session) showed no day tabs on resume and "Add Session" did nothing. Drafts saved later resume correctly.' });
      await page.locator('main .event-card').filter({ hasText: d.title }).getByRole('button', { name: 'Continue Event Setup' }).click();
      await expect(page).toHaveURL(/host-event/);
      await expect(page.getByText(/Step [2-6] out of 6/)).toBeVisible({ timeout: 60_000 });
      // Resume can land before or after Schedule Setup - move to step 3 either way.
      for (let i = 0; i < 4 && !(await page.getByText('Step 3 out of 6').isVisible()); i++) {
        const current = Number((await page.getByText(/Step \d out of 6/).innerText()).match(/Step (\d)/)![1]);
        await (current < 3 ? w.saveAndProceed : w.previousStep).click();
        await page.waitForTimeout(3000);
      }
      await snap(page, 'Resumed draft - schedule step');
      await expect.soft(page.getByRole('button', { name: displayDate(d.date) }), 'event day shown on resume').toBeVisible({ timeout: 10_000 });
      await page.getByRole('button', { name: 'Add Session' }).first().click();
      await expect.soft(w.sessionTitle.first(), 'Add Session opens a session form on a resumed draft').toBeVisible({ timeout: 10_000 });
    });
  });
});
