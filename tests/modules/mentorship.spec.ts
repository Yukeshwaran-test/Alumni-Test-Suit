import { test, expect, SENDER, RECEIVER } from '../network/fixtures';
import { MentorshipPage } from '../../pages/MentorshipPage';
import { NetworkPage } from '../../pages/NetworkPage';
import { note, snap } from '../../utils/report';
import { alumnusByEmail, hasSfSession, sfQuery } from '../../utils/salesforce';

const BLOCKED =
  `${SENDER.name} and ${RECEIVER.name} are not connected. A mentorship needs an ACCEPTED network ` +
  'connection, and Accept is currently broken (Ken_Notification__c DmlException - see Network module).';

test.describe('Mentorship module', () => {
  test('POSITIVE: mentor sees connections, calendar, Schedule a Call and Tasks', async ({ page }) => {
    const m = new MentorshipPage(page);
    await m.goto();
    await expect(page.getByText('Mentorship Connections')).toBeVisible();
    await expect(m.scheduleCall).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Tasks' })).toBeVisible();
    await expect(m.addTask).toBeVisible();
    await expect(m.editPreferences).toBeVisible();
    await snap(page, 'Mentorship - mentor view');
  });

  test('POSITIVE: user with no mentorships sees Find Mentors / Become a Mentor', async ({ receiver }) => {
    const m = new MentorshipPage(receiver);
    await m.goto();
    test.skip(!(await m.emptyState.isVisible()), `${RECEIVER.name} already has mentorship connections`);
    await expect(m.findMentors).toBeVisible();
    await expect(m.becomeMentor).toBeVisible();
    await m.findMentors.click();
    await expect(receiver).toHaveURL(/\/alumni\/network/);
    await snap(receiver, 'Find Mentors opens the Network directory');
  });

  test('POSITIVE: "Edit Mentorship Preferences" opens Settings > Mentorship', async ({ page }) => {
    const m = new MentorshipPage(page);
    await m.goto();
    await m.editPreferences.click();
    await expect(page).toHaveURL(/\/alumni\/settings/);
    await page.getByText('Mentorship', { exact: true }).filter({ visible: true }).last().click();
    await expect(page.getByRole('heading', { name: 'Be a Mentor' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Mentorship Availability' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Areas of Expertise' })).toBeVisible();
    await snap(page, 'Settings - Mentorship preferences');
  });

  test('NEGATIVE: Add Task with empty form shows required errors', async ({ page }) => {
    const m = new MentorshipPage(page);
    await m.goto();
    test.skip(!(await m.addTask.isVisible()), 'No mentorship connections');
    await m.addTask.click();
    await expect(page.getByRole('heading', { name: 'Add Task' })).toBeVisible();
    await m.saveTask.click();
    await expect(page.getByText('Title is required.')).toBeVisible();
    await expect(page.getByText('Please select Mentor or Mentee.')).toBeVisible();
    await expect(page.getByText('Status is required.')).toBeVisible();
    await snap(page, 'Add Task - required errors');
    await page.getByRole('button', { name: 'Cancel' }).click();
  });

  test('NEGATIVE: Schedule a Call with empty form shows required errors', async ({ page }) => {
    const m = new MentorshipPage(page);
    await m.goto();
    test.skip(!(await m.scheduleCall.isVisible()), 'No mentorship connections');
    await m.scheduleCall.click();
    await expect(page.getByRole('heading', { name: 'Schedule a Call' })).toBeVisible();
    await m.sendRequest.click();
    await expect(page.getByText('Title is required.')).toBeVisible();
    await expect(page.getByText('Please select start and end time.')).toBeVisible();
    await expect(page.getByText('Please enter the meeting link.')).toBeVisible();
    await snap(page, 'Schedule a Call - required errors');
    await page.getByRole('button', { name: 'Cancel' }).click();
  });

  test(`E2E: ${SENDER.name} sends a mentorship request to ${RECEIVER.name}, adds a task and schedules a meeting`, async ({ page, receiver }) => {
    const profile = await new NetworkPage(page).openProfile(RECEIVER.name);
    test.skip(!(await profile.messageButton.isVisible()), BLOCKED);

    // Everything below needs the users connected; it runs automatically once Accept is fixed.
    await test.step('Send the mentorship request from the profile menu', async () => {
      await profile.moreOptions.click();
      await page.getByText(/Request Mentorship|Request as Mentor|Mentorship/i).first().click();
      await snap(page, 'Mentorship request sent');
    });
    await test.step(`${RECEIVER.name} accepts the mentorship request`, async () => {
      await receiver.goto('./');
      await receiver.getByRole('button', { name: 'Notifications', exact: true }).click();
      await receiver.getByRole('tab', { name: 'Connection Requests' }).click();
      await receiver.locator('.row--request').filter({ hasText: SENDER.name }).getByRole('button', { name: 'Accept' }).click();
    });
    const m = new MentorshipPage(page);
    await test.step('Add a task', async () => {
      await m.goto();
      await m.connection(RECEIVER.name).click();
      await m.addTask.click();
      await m.taskTitle.pressSequentially(`QA task ${Date.now()}`);
      await m.assignTo('Mentee').check({ force: true });
      await m.pickOption(m.taskStatus, /Not Started|Open|To Do/i);
      await m.saveTask.click();
      await snap(page, 'Task added');
    });
    await test.step('Schedule a meeting', async () => {
      await m.scheduleCall.click();
      await m.callTitle.pressSequentially(`QA call ${Date.now()}`);
      await m.pickOption(m.startTime, /./);
      await m.pickOption(m.endTime, /./);
      await m.meetLink.pressSequentially('https://meet.example.com/qa-mentorship');
      await m.sendRequest.click();
      await snap(page, 'Meeting requested');
    });
    await test.step('Salesforce: mentorship record', async () => {
      test.skip(!(await hasSfSession()), 'Salesforce session missing');
      const [s, r] = [await alumnusByEmail(SENDER.email), await alumnusByEmail(RECEIVER.email)];
      const rows = await sfQuery(
        `SELECT Name, Mentor__r.Name, Mentee__r.Name, Mentorship_Status__c, Call_Request_Status__c, Meeting_Title__c
           FROM Ken_Mentorship__c WHERE (Mentor__c='${r.AccountId}' AND Mentee__c='${s.AccountId}')
             OR (Mentor__c='${s.AccountId}' AND Mentee__c='${r.AccountId}') ORDER BY CreatedDate DESC LIMIT 1`,
      );
      await note('Ken_Mentorship__c', rows);
      expect(rows.length).toBe(1);
    });
  });
});
