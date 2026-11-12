import { test, expect } from '@playwright/test';
import { SF_AUTH_FILE } from '../../playwright.config';
import { EventsPage, HostedEventsPage } from '../../pages/EventsPage';
import { HostEventPage } from '../../pages/HostEventPage';
import { SfEventRecordPage } from '../../pages/sf/SfEventRecordPage';
import { hideChatWidget, note, snap } from '../../utils/report';
import { displayDate, FIXTURES, newEventData } from '../../utils/testData';
import {
  findEventByTitle, hasSfSession, pendingApproval, sessionsForEvent, surveysForEvent,
} from '../../utils/salesforce';

/**
 * Business rule: alumni cannot create (publish) events from the portal. They can only submit an
 * event *request* through the 6-step wizard; it stays "In Review" until it's approved in Salesforce.
 *
 * Tests run in order and share the event created by the first test.
 * Tests tagged @sf-approval change data in Salesforce (approve the request).
 */
test.describe.configure({ mode: 'serial' });

const data = newEventData();
let eventId = '';

test.describe('Events module - Host event request (portal -> Salesforce)', () => {
  test.beforeEach(async ({ page }) => hideChatWidget(page));

  test('Portal: submit an event request through all 6 screens (positive + negative)', async ({ page }) => {
    const w = new HostEventPage(page);
    await note('Test data', data);

    await test.step('Open Host Event wizard', async () => {
      await w.goto();
    });

    await test.step('Screen 1 - Event Setup', async () => {
      await test.step('NEGATIVE: empty form shows all required-field errors', async () => {
        await w.saveAndProceed.click();
        await expect(page.getByText('Please fill all required fields and fix validation errors').first()).toBeVisible();
        await expect(page.getByText('Cover photo is required').first()).toBeVisible();
        await expect(page.getByText('Please select at least one category').first()).toBeVisible();
        await expect(page.getByText('Please select at least one date').first()).toBeVisible();
        await expect(page.getByText('This field is required')).toHaveCount(2); // title + what to expect
        await w.expectStep(1);
        await snap(page, 'S1 negative - required errors');
      });
      await test.step('NEGATIVE: square (non-landscape) cover photo is rejected', async () => {
        await w.uploadCover(FIXTURES.squareCover);
        await expect(page.getByText('Cover photo must be in landscape format. Try using a wider image.').first()).toBeVisible();
        await snap(page, 'S1 negative - square cover');
      });
      await test.step('NEGATIVE: non-image cover file is rejected', async () => {
        await w.uploadCover(FIXTURES.notAnImage);
        await expect(page.getByText('Please select a PNG or JPEG image').first()).toBeVisible();
        await snap(page, 'S1 negative - non-image cover');
      });
      await test.step('POSITIVE: fill Event Setup and proceed', async () => {
        await w.fillEventSetup(data);
        await snap(page, 'S1 positive - filled');
        await w.saveAndProceed.click();
        await w.expectStep(2);
      });
    });

    await test.step('Screen 2 - Target Audience (All Audience)', async () => {
      await test.step('NEGATIVE: proceeding without an audience is blocked', async () => {
        await w.saveAndProceed.click();
        await expect(page.getByText('Please select target audience before proceeding').first()).toBeVisible();
        await w.expectStep(2);
        await snap(page, 'S2 negative - no audience');
      });
      await test.step('NEGATIVE: unknown audience search shows no results', async () => {
        await w.type(w.audienceSearch, 'zzzz-no-such-audience');
        await expect(page.getByText('No saved audiences found').first()).toBeVisible();
        await snap(page, 'S2 negative - no search results');
      });
      await test.step('POSITIVE: add saved audience "all audience" and proceed', async () => {
        await w.addSavedAudience(data.audience);
        await expect(w.main.getByText('All Alumni')).toBeVisible();
        await snap(page, 'S2 positive - all audience added');
        await w.saveAndProceed.click();
        await w.expectStep(3);
      });
    });

    await test.step('Screen 3 - Schedule Setup', async () => {
      await test.step('NEGATIVE: cannot proceed before adding a session', async () => {
        await expect(page.getByText('Get started by adding the first session*').first()).toBeVisible();
        await expect(w.saveAndProceed).toBeDisabled();
        await snap(page, 'S3 negative - no session');
      });
      await page.getByRole('button', { name: 'Add Session' }).click();
      await test.step('NEGATIVE: end time before start time is rejected', async () => {
        await w.type(w.sessionTitle, data.session.title);
        await w.startTime.fill('14:00');
        await w.endTime.fill('13:00');
        await w.endTime.blur();
        await expect(page.getByText('End time must be later than start time').first()).toBeVisible();
        await expect(w.saveAndProceed).toBeDisabled();
        await snap(page, 'S3 negative - end before start');
      });
      await test.step('NEGATIVE: invalid online event link is rejected', async () => {
        await w.startTime.fill(data.session.start);
        await w.endTime.fill(data.session.end);
        await w.type(w.sessionAgenda, data.session.agenda);
        await w.main.getByText('Online event', { exact: true }).click();
        await w.type(w.eventLink, 'not-a-url');
        await w.eventLink.blur();
        await expect(page.getByText('Please enter a valid URL').first()).toBeVisible();
        await expect(w.saveAndProceed).toBeDisabled();
        await snap(page, 'S3 negative - invalid URL');
      });
      await test.step('POSITIVE: valid session enables Save & proceed', async () => {
        await w.fillSession(data.session);
        await expect(w.saveAndProceed).toBeEnabled();
        await snap(page, 'S3 positive - session filled');
        await w.saveAndProceed.click();
        await w.expectStep(4);
      });
    });

    await test.step('Screen 4 - Pre-Event Surveys', async () => {
      await expect(page.getByText('Offer Meals to Attendees').first()).toBeVisible();
      await expect(page.getByText('Custom Survey').first()).toBeVisible();
      await test.step('NEGATIVE: meals offered without dietary preferences is blocked', async () => {
        await w.mealsSwitch.check({ force: true });
        await w.saveAndProceed.click();
        await expect(page.getByText('Please select at least one dietary preference since meals are being offered.').first()).toBeVisible();
        await w.expectStep(4);
        await snap(page, 'S4 negative - no dietary preference');
      });
      await test.step('NEGATIVE: empty custom survey question is blocked', async () => {
        await w.tickMeal(data.date, data.meal);
        for (const d of data.dietary) await w.tickDietary(d);
        await w.customSurveySwitch.check({ force: true });
        await w.saveAndProceed.click();
        await expect(page.getByText(/Please complete the survey questions/).first()).toBeVisible();
        await expect(page.getByText('Question is required').first()).toBeVisible();
        await expect(page.getByText('Add at least 2 options').first()).toBeVisible();
        await w.expectStep(4);
        await snap(page, 'S4 negative - empty survey question');
      });
      await test.step('POSITIVE: meals + dietary + custom survey question, proceed', async () => {
        await w.fillQuestion(w.main, data.preEventQuestion);
        await snap(page, 'S4 positive - survey filled');
        await w.saveAndProceed.click();
        await w.expectStep(5);
      });
    });

    await test.step('Screen 5 - Feedback Form', async () => {
      await expect(w.main.getByText(data.session.title)).toBeVisible();
      await expect(page.getByText('No Feedback Form Added').first()).toBeVisible();
      await test.step('NEGATIVE: proceeding without a feedback form shows a warning', async () => {
        await w.saveAndProceed.click();
        await expect(w.noFeedbackWarning).toBeVisible();
        await snap(page, 'S5 negative - missing feedback warning');
        await page.getByRole('button', { name: 'Go Back' }).click();
        await expect(w.noFeedbackWarning).toBeHidden();
        await w.expectStep(5);
      });
      await test.step('NEGATIVE: saving an empty feedback form is blocked', async () => {
        await w.setupFormButton.click();
        const dlg = w.feedbackDialog;
        await expect(dlg.getByText('Setup Feedback Questions')).toBeVisible();
        await dlg.getByRole('button', { name: 'Save Form' }).click();
        await expect(dlg.getByText('Question is required')).toBeVisible();
        await expect(dlg.getByText('Add at least 2 options')).toBeVisible();
        await expect(dlg).toBeVisible();
        await snap(page, 'S5 negative - empty feedback form');
      });
      await test.step('POSITIVE: feedback form (auto-trigger at session end) saved, proceed', async () => {
        const dlg = w.feedbackDialog;
        await dlg.getByRole('combobox').filter({ hasText: 'Select' }).first().click();
        await page.getByRole('option', { name: 'At session end' }).click();
        await w.fillQuestion(dlg, data.feedbackQuestion);
        await dlg.getByRole('button', { name: 'Save Form' }).click();
        await expect(dlg).toBeHidden();
        await expect(page.getByText('1 Questions Added').first()).toBeVisible();
        await snap(page, 'S5 positive - feedback form added');
        await w.saveAndProceed.click();
        await w.expectStep(6);
      });
    });

    await test.step('Screen 6 - Summary', async () => {
      await test.step('POSITIVE: summary shows everything entered', async () => {
        const main = w.main;
        await expect(main.getByText(data.title, { exact: true })).toBeVisible();
        await expect(main.getByText(data.category, { exact: true })).toBeVisible();
        await expect(main.getByText('All Alumni', { exact: true })).toBeVisible();
        await expect(main.getByText(displayDate(data.date), { exact: true }).first()).toBeVisible();
        await expect(main.getByText(`${displayDate(data.date)} (${data.meal})`)).toBeVisible();
        await expect(main.getByText(data.session.title, { exact: true })).toBeVisible();
        await expect(main.getByText('1 Questions', { exact: true })).toHaveCount(2); // custom survey + feedback
        for (const section of ['Event Setup', 'Target Audience', 'Dates Selected', 'Pre Event Surveys', 'Session Details']) {
          await expect(main.getByRole('heading', { name: section })).toBeVisible();
        }
        await snap(page, 'S6 summary');
      });
      await test.step('POSITIVE: Confirm & Submit sends the request for review', async () => {
        await w.confirmAndSubmit.click();
        await expect(page.getByText('Event process completed').first()).toBeVisible({ timeout: 60_000 });
        await snap(page, 'S6 submitted - success');
        await expect(page).toHaveURL(/\/event\/hosted-events/, { timeout: 60_000 });
      });
    });
  });

  test('Portal NEGATIVE: submitted event is "In Review", not published to alumni', async ({ page }) => {
    const events = new EventsPage(page);
    await events.goto();
    await expect(events.request(data.title)).toBeVisible();
    await expect(events.request(data.title).getByText('In Review')).toBeVisible();
    await expect(events.upcomingCard(data.title), 'must NOT be listed as an upcoming event').toHaveCount(0);
    await snap(page, 'Events page - request In Review, not in upcoming list');

    const hosted = new HostedEventsPage(page);
    await hosted.goto();
    await expect(hosted.card(data.title)).toBeVisible();
    await snap(page, 'Hosted events - In Review');
  });

  test.describe('Salesforce', () => {
    test.use({ storageState: SF_AUTH_FILE });

    test.beforeAll(async () => {
      test.skip(!(await hasSfSession()), 'Salesforce session missing or expired - run: npm run sf:login');
    });

    test('SF: request is saved as In Review, unpublished, awaiting approval', async ({ page }) => {
      const rec = await findEventByTitle(data.title);
      expect(rec, `Ken_Event_Master__c named "${data.title}"`).toBeTruthy();
      eventId = rec.Id;
      await note('Salesforce event record', rec);

      expect(rec.Event_Status__c).toBe('In Review');
      expect(rec.Is_Published__c).toBe(false);
      expect(rec.Event_Type__c).toBe(data.category);
      expect(rec.Start_Date__c).toBe(data.date);
      expect(rec.Offer_Meals__c).toBe(true);
      expect(rec.Dietary_Preferences__c.split(';').sort()).toEqual([...data.dietary].sort());
      expect(rec.Description__c).toBe(data.description);
      expect(rec.What_to_Expect_From_Event__c).toBe(data.whatToExpect);

      const sessions = await sessionsForEvent(eventId);
      await note('Salesforce sessions', sessions);
      expect(sessions).toHaveLength(1);
      expect(sessions[0]).toMatchObject({
        Name: data.session.title,
        Location_Type__c: 'online',
        Session_Link__c: data.session.link,
        Meals__c: data.meal,
        Feedback_Trigger_Type__c: 'Auto-trigger',
      });

      const approval = await pendingApproval(eventId);
      await note('Pending approval', approval);
      expect(approval.ProcessInstance.Status).toBe('Pending');
      expect(approval.ProcessInstance.ProcessDefinition.Name).toBe('Event Publish Approval');

      const sf = new SfEventRecordPage(page);
      await sf.goto(eventId);
      await expect(page.getByText(data.title).first()).toBeVisible();
      await expect(sf.pendingStep()).toBeVisible();
      await expect(sf.approvalHistory.getByText('Pending')).toBeVisible();
      await snap(page, 'SF record - In Review, approval pending');
    });

    test('SF: custom survey and feedback questions are saved', async () => {
      test.fail(true, 'SUSPECTED BUG: portal logs "Error saving feedback questionnaire" (HTTP 500) and no survey records are created');
      const surveys = await surveysForEvent(eventId);
      await note('Ken_Survey__c records', surveys);
      expect(surveys.length).toBeGreaterThan(0);
    });

    test('SF: approve the event request', { tag: '@sf-approval' }, async ({ page }) => {
      const sf = new SfEventRecordPage(page);
      await sf.goto(eventId);
      await snap(page, 'SF record - before approval');
      await sf.decide('Approve', 'Approved by Playwright automation');
      await sf.goto(eventId);
      await expect(sf.approvalHistory.getByText('Approved').first()).toBeVisible();
      await snap(page, 'SF record - approved');
      const rec = await findEventByTitle(data.title);
      await note('Salesforce event record after approval', rec);
      expect(rec.Event_Status__c).toBe('Approved');
    });
  });

  test('Portal: approved event appears under Hosted Events > Approved', { tag: '@sf-approval' }, async ({ page }) => {
    test.skip(!eventId, 'needs the Salesforce approval step');
    const hosted = new HostedEventsPage(page);
    await hosted.goto();
    await hosted.tab('Approved').click();
    await expect(hosted.card(data.title)).toBeVisible();
    await snap(page, 'Hosted events - Approved');
  });
});
