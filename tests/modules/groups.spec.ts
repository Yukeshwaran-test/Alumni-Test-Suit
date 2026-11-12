import { test, expect, RECEIVER } from '../network/fixtures';
import { SF_AUTH_FILE } from '../../playwright.config';
import { CreateGroupPage, GroupDetailPage, GroupsPage } from '../../pages/GroupsPage';
import { HostEventPage } from '../../pages/HostEventPage';
import { SfApprovalPage } from '../../pages/sf/SfApprovalPage';
import { note, snap } from '../../utils/report';
import { alumnusByEmail, hasSfSession, pendingWorkItem, sfDelete, sfQuery } from '../../utils/salesforce';
import { newEventData } from '../../utils/testData';

/**
 * Groups module end-to-end.
 *  - Public group, target audience "all audience"   -> SF approve -> receiver joins
 *  - Private group, 2 specific individuals (incl. RECEIVER) -> SF approve -> receiver requests
 *    -> admin rejects -> receiver requests again -> admin accepts
 *  - Event inside the group -> SF approve -> receiver sees / accepts it   (@sf-approval)
 *  - afterAll: deletes every record this run created from the Salesforce backend.
 */
test.describe.configure({ mode: 'serial' });

const stamp = Date.now().toString().slice(-6);
const PUBLIC = { name: `QA Auto Public Group ${stamp}`, type: 'Public' as const, tags: 'qa, automation', description: 'Automated QA public group.', rules: 'Be respectful.' };
const PRIVATE = { name: `QA Auto Private Group ${stamp}`, type: 'Private' as const, tags: 'qa', description: 'Automated QA private group.' };
const PRIVATE_AUDIENCE = `QA Auto Private Audience ${stamp}`;
const EVENT_AUDIENCE = `QA Auto Group Event Audience ${stamp}`;
const SECOND_USER: [string, string] = ['Surya Testing', 'alumnitestuser1@yopmail.com'];
const EVENT = { ...newEventData(), title: `QA Group Event ${stamp}` };
const ids = { publicGroup: '', privateGroup: '', event: '' };

async function groupByName(name: string) {
  const [g] = await sfQuery(
    `SELECT Id, Name, Group_Type__c, Status__c, Is_Active__c, Category__c, Tags__c, Member_Count__c, Segmentation__c, Segmentation__r.Name, Created_By__r.Name
       FROM Ken_Group__c WHERE Name = '${name}' ORDER BY CreatedDate DESC LIMIT 1`,
  );
  return g;
}
async function membership(groupId: string, email: string) {
  const person = await alumnusByEmail(email);
  const [m] = await sfQuery(`SELECT Id, Role__c, Status__c, Approved_Rejected_By__r.Name FROM Ken_Group_Member__c WHERE Group__c='${groupId}' AND Member__c='${person.AccountId}' ORDER BY LastModifiedDate DESC LIMIT 1`);
  return m;
}

test.describe('Groups module', () => {
  let sf = false;
  test.beforeAll(async () => { sf = await hasSfSession(); });

  test.afterAll(async () => {
    if (!sf) return;
    // Cleanup requested: remove this run's data from the Salesforce backend.
    const groupIds = [ids.publicGroup, ids.privateGroup].filter(Boolean);
    const quoted = (a: string[]) => a.map(i => `'${i}'`).join(',') || "''";
    const events = await sfQuery(`SELECT Id FROM Ken_Event_Master__c WHERE Name = '${EVENT.title}' OR Evvent_Group__c IN (${quoted(groupIds)})`);
    const sessions = events.length ? await sfQuery(`SELECT Id FROM Ken_Schedule_Sessions__c WHERE Event_Reference__c IN (${quoted(events.map((e: any) => e.Id))})`) : [];
    const members = groupIds.length ? await sfQuery(`SELECT Id FROM Ken_Group_Member__c WHERE Group__c IN (${quoted(groupIds)})`) : [];
    const audiences = await sfQuery(`SELECT Id FROM Ken_Segmentation__c WHERE Name IN ('${PRIVATE_AUDIENCE}', '${EVENT_AUDIENCE}')`);
    const report = [
      await sfDelete('Ken_Schedule_Sessions__c', sessions.map((r: any) => r.Id)),
      await sfDelete('Ken_Event_Master__c', events.map((r: any) => r.Id)),
      await sfDelete('Ken_Group_Member__c', members.map((r: any) => r.Id)),
      await sfDelete('Ken_Group__c', groupIds),
      await sfDelete('Ken_Segmentation__c', audiences.map((r: any) => r.Id)),
    ];
    console.log('SF cleanup:', JSON.stringify(report.map(r => ({ object: r.object, deleted: r.results.filter(x => x.ok).length, failed: r.results.filter(x => !x.ok) }))));
  });

  // ---------------- Negative validation ----------------
  test('NEGATIVE: Setup Group validation (required name, 50-char limit, audience required)', async ({ page }) => {
    const c = new CreateGroupPage(page);
    await c.goto();
    await test.step('Empty form -> "Group name is required."', async () => {
      await c.next.click();
      await expect(page.getByText('Group name is required.')).toBeVisible();
      await c.expectStep(1);
    });
    await test.step('Group name is capped at 50 characters', async () => {
      await c.name.pressSequentially('X'.repeat(60), { delay: 2 });
      await expect(c.name).toHaveValue('X'.repeat(50));
      await expect(page.getByText('50/50')).toBeVisible();
    });
    await snap(page, 'Setup Group - validation');
  });

  // ---------------- Public group ----------------
  test('POSITIVE: create a PUBLIC group for "all audience"', async ({ page }) => {
    const c = new CreateGroupPage(page);
    await c.goto();
    await c.fillSetup(PUBLIC);
    await snap(page, 'Public group - setup');
    await c.next.click();
    await c.expectStep(2);
    await test.step('NEGATIVE: cannot continue without an audience', async () => {
      await c.next.click();
      await c.expectStep(2);
    });
    await c.addSavedAudience('all audience');
    await c.next.click();
    await c.expectStep(3);
    await expect(c.main.getByText(PUBLIC.name, { exact: true })).toBeVisible();
    await expect(c.main.getByText('Public - Anyone can join')).toBeVisible();
    await expect(c.main.getByText('All Alumni', { exact: true })).toBeVisible();
    await snap(page, 'Public group - summary');
    await c.submit.click();
    await expect(c.submitted).toBeVisible();
    await expect(page.getByText('Your group has been submitted for approval.')).toBeVisible();
    await snap(page, 'Public group - submitted for approval');
  });

  test('SF: public group is In Review, then approved', async ({ browser }) => {
    test.skip(!sf, 'Salesforce session missing - run: npm run sf:login');
    const g = await groupByName(PUBLIC.name);
    ids.publicGroup = g.Id;
    await note('Ken_Group__c (public) before approval', g);
    expect(g).toMatchObject({ Group_Type__c: 'Public', Status__c: 'In Review', Category__c: 'Group', Tags__c: PUBLIC.tags });
    expect(g.Segmentation__r?.Name).toBe('all audience');
    expect((await pendingWorkItem(g.Id))?.ProcessInstance.ProcessDefinition.Name).toBe('Ken Group Approval');

    const ctx = await browser.newContext({ storageState: SF_AUTH_FILE });
    const sfPage = await ctx.newPage();
    await new SfApprovalPage(sfPage).decide(g.Id, 'Approve', 'Approved by Playwright automation');
    await ctx.close();
    const after = await groupByName(PUBLIC.name);
    await note('Ken_Group__c (public) after approval', after);
    expect(after).toMatchObject({ Status__c: 'Approved', Is_Active__c: true });
  });

  test('POSITIVE: admin sees the approved group with admin tools', async ({ page }) => {
    test.skip(!ids.publicGroup, 'needs the approved public group');
    const d = new GroupDetailPage(page);
    await d.goto(ids.publicGroup);
    await expect(page.getByText(PUBLIC.name).first()).toBeVisible();
    for (const t of ['About', 'Feed', 'Events', 'Members'] as const) await expect(d.tabs[t]).toBeVisible();
    await expect(page.getByRole('button', { name: 'Edit Group Details' })).toBeVisible();
    await d.tabs.Members.click();
    await expect(d.inviteMembers).toBeVisible();
    await expect(page.getByRole('button', { name: 'Copy Invite Link' })).toBeVisible();
    await snap(page, 'Public group - admin view');
  });

  test('NEGATIVE: receiver can find the approved public group in Discover', async ({ receiver }) => {
    test.fail(true, 'KNOWN BUG (2026-09-30): newly approved public groups targeted to "all audience" are missing from ' +
      "Discover and search (search only filters the pre-loaded list). Members can only join via the group's direct link.");
    const g = new GroupsPage(receiver);
    await g.goto();
    await g.search.pressSequentially(PUBLIC.name, { delay: 10 });
    await snap(receiver, 'Receiver - Discover search');
    await expect(receiver.getByText(PUBLIC.name).first()).toBeVisible({ timeout: 15_000 });
  });

  test('POSITIVE: receiver joins the public group', async ({ receiver }) => {
    test.skip(!ids.publicGroup, 'needs the approved public group');
    const d = new GroupDetailPage(receiver);
    await d.goto(ids.publicGroup);
    await test.step('NEGATIVE: non-member sees only About, no Feed/Events/Members', async () => {
      await expect(d.joinGroup).toBeVisible();
      await expect(d.tabs.Feed).toHaveCount(0);
      await expect(d.tabs.Members).toHaveCount(0);
    });
    await d.joinGroup.click();
    await expect(receiver.getByText('You have successfully joined the group.')).toBeVisible();
    await expect(d.leaveGroup).toBeVisible();
    await expect(d.tabs.Feed).toBeVisible();
    await snap(receiver, 'Receiver - joined public group');
    if (sf) {
      const m = await membership(ids.publicGroup, RECEIVER.email);
      await note('Receiver membership (public)', m);
      expect(m).toMatchObject({ Role__c: 'Member', Status__c: 'Approved' });
    }
  });

  test('GRP-024: receiver leaves the public group', async ({ receiver }) => {
    test.skip(!ids.publicGroup, 'needs the approved public group');
    const d = new GroupDetailPage(receiver);
    await d.goto(ids.publicGroup);
    await expect(d.leaveGroup).toBeVisible();
    await d.leaveGroup.click();
    // A confirmation may be asked first.
    const confirm = receiver.getByRole('button', { name: /^(Leave|Yes, Leave|Yes|Confirm)$/ });
    if (await confirm.first().waitFor({ timeout: 4_000 }).then(() => true, () => false)) await confirm.first().click();
    await expect(d.joinGroup, 'Join Group shown again after leaving').toBeVisible({ timeout: 30_000 });
    await expect(d.tabs.Feed, 'member-only tabs hidden again').toHaveCount(0);
    await snap(receiver, 'Receiver - left the group');
    if (sf) {
      const m = await membership(ids.publicGroup, RECEIVER.email);
      await note('Receiver membership after leaving', m ?? 'record removed');
      expect(m === undefined || ['Left', 'Removed'].includes(m.Status__c), `membership status after leaving: ${m?.Status__c}`).toBe(true);
    }
  });

  // ---------------- Private group ----------------
  test('POSITIVE: create a PRIVATE group for 2 specific people (incl. receiver)', async ({ page }) => {
    const c = new CreateGroupPage(page);
    await c.goto();
    await c.fillSetup(PRIVATE);
    await c.next.click();
    await c.expectStep(2);
    await c.addIndividuals([[RECEIVER.name, RECEIVER.email], SECOND_USER]);
    await snap(page, 'Private group - 2 individuals added');
    await test.step('NEGATIVE: a new audience must be saved with a name', async () => {
      await c.next.click();
      await expect(c.saveAudienceDialog).toBeVisible();
      await c.saveAudienceDialog.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(page.getByText('Audience name is required.').first()).toBeVisible();
    });
    await c.saveAudienceDialog.getByPlaceholder('Enter audience name').pressSequentially(PRIVATE_AUDIENCE, { delay: 5 });
    await c.saveAudienceDialog.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(c.main.getByText(PRIVATE_AUDIENCE)).toBeVisible();
    await c.next.click();
    await c.expectStep(3);
    await expect(c.main.getByText('Private - Users must request to join')).toBeVisible();
    await expect(c.main.getByText(RECEIVER.name, { exact: true })).toBeVisible();
    await expect(c.main.getByText(SECOND_USER[0], { exact: true })).toBeVisible();
    await snap(page, 'Private group - summary');
    await c.submit.click();
    await expect(c.submitted).toBeVisible();
  });

  test('SF: private group is In Review with a 2-member audience, then approved', async ({ browser }) => {
    test.skip(!sf, 'Salesforce session missing - run: npm run sf:login');
    const g = await groupByName(PRIVATE.name);
    ids.privateGroup = g.Id;
    await note('Ken_Group__c (private) before approval', g);
    expect(g).toMatchObject({ Group_Type__c: 'Private', Status__c: 'In Review' });
    expect(g.Segmentation__r?.Name).toBe(PRIVATE_AUDIENCE);
    const [seg] = await sfQuery(`SELECT Member_Count__c FROM Ken_Segmentation__c WHERE Id='${g.Segmentation__c}'`);
    expect(seg.Member_Count__c).toBe(2);

    const ctx = await browser.newContext({ storageState: SF_AUTH_FILE });
    await new SfApprovalPage(await ctx.newPage()).decide(g.Id, 'Approve', 'Approved by Playwright automation');
    await ctx.close();
    expect((await groupByName(PRIVATE.name)).Status__c).toBe('Approved');
  });

  test('REJECT: receiver requests to join, admin rejects', async ({ page, receiver }) => {
    test.skip(!ids.privateGroup, 'needs the approved private group');
    const r = new GroupDetailPage(receiver);
    await r.goto(ids.privateGroup);
    await expect(r.tabs.Feed, 'private content hidden from non-members').toHaveCount(0);
    await r.requestToJoin.click();
    await expect(receiver.getByText('The admin will review your request.')).toBeVisible();
    await expect(r.requested).toBeVisible();
    await snap(receiver, 'Receiver - request sent');
    if (sf) expect((await membership(ids.privateGroup, RECEIVER.email)).Status__c).toBe('Pending');

    const a = new GroupDetailPage(page);
    await a.goto(ids.privateGroup);
    await a.decideRequest(RECEIVER.name, 'reject');
    await snap(page, 'Admin - request rejected');
    if (sf) expect((await membership(ids.privateGroup, RECEIVER.email)).Status__c).toBe('Rejected');

    await r.goto(ids.privateGroup);
    await expect(r.requestToJoin, 'can request again after rejection').toBeVisible();
    await expect(r.leaveGroup).toHaveCount(0);
  });

  test('ACCEPT: receiver requests again, admin accepts', async ({ page, receiver }) => {
    test.skip(!ids.privateGroup, 'needs the approved private group');
    const r = new GroupDetailPage(receiver);
    await r.goto(ids.privateGroup);
    await r.requestToJoin.click();
    await expect(r.requested).toBeVisible();

    const a = new GroupDetailPage(page);
    await a.goto(ids.privateGroup);
    await a.decideRequest(RECEIVER.name, 'accept');
    await expect(page.getByText('Member request approved.')).toBeVisible();
    await expect(page.locator('main').getByText(RECEIVER.name, { exact: true }).first()).toBeVisible();
    await snap(page, 'Admin - request accepted, receiver in Members');
    if (sf) {
      const m = await membership(ids.privateGroup, RECEIVER.email);
      await note('Receiver membership (private)', m);
      expect(m).toMatchObject({ Status__c: 'Approved', Role__c: 'Member' });
      expect(m.Approved_Rejected_By__r?.Name).toBeTruthy();
    }
    await r.goto(ids.privateGroup);
    await expect(r.leaveGroup).toBeVisible();
    await expect(r.tabs.Feed).toBeVisible();
    await snap(receiver, 'Receiver - member of private group');
  });

  // ---------------- Event inside the group ----------------
  test('POSITIVE: admin creates an event inside the private group', async ({ page }) => {
    test.skip(!ids.privateGroup, 'needs the approved private group');
    const d = new GroupDetailPage(page);
    await d.goto(ids.privateGroup);
    await d.tabs.Events.click();
    await expect(page.getByText('No events are linked to this group yet.')).toBeVisible();
    await d.createEvent.click();
    await expect(page).toHaveURL(new RegExp(`host-event\\?preselectGroupId=${ids.privateGroup}`));
    const w = new HostEventPage(page);
    await w.expectStep(1);
    await w.fillEventSetup(EVENT);
    await w.saveAndProceed.click();
    await w.expectStep(2);
    await expect(w.main.getByText('Groups Added')).toBeVisible();
    await expect(w.main.getByText(PRIVATE.name)).toBeVisible();
    await snap(page, 'Group event - audience = the group');
    // A pre-selected group is an unsaved audience: it has to be saved (with a name) before
    // "Save and proceed" does anything - otherwise the click is silently ignored.
    await test.step('NEGATIVE: Save and proceed is ignored until the group audience is saved', async () => {
      await w.saveAndProceed.click();
      await expect(page.getByText('Step 3 out of 6')).toBeHidden({ timeout: 5_000 });
      await w.expectStep(2);
    });
    await page.locator('main').getByRole('button', { name: 'Save Audience' }).click();
    const saveDlg = page.getByRole('dialog').filter({ hasText: 'Save Audience' });
    await saveDlg.getByPlaceholder('Enter audience name').pressSequentially(EVENT_AUDIENCE, { delay: 5 });
    await saveDlg.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(saveDlg).toBeHidden();
    await w.saveAndProceed.click();
    await w.expectStep(3);
    await page.getByRole('button', { name: 'Add Session' }).click();
    await w.fillSession(EVENT.session);
    await w.saveAndProceed.click();
    await w.expectStep(4);
    await w.saveAndProceed.click();
    await w.expectStep(5);
    await w.saveAndProceed.click();
    await page.getByRole('button', { name: 'Continue Anyway' }).click();
    await w.expectStep(6);
    await w.confirmAndSubmit.click();
    await expect(page.getByText('Event process completed')).toBeVisible({ timeout: 60_000 });
    await snap(page, 'Group event submitted');
    if (sf) {
      const [e] = await sfQuery(`SELECT Id, Event_Status__c, Evvent_Group__c, Segmentation__r.Name, Segmentation__r.Definition_JSON__c FROM Ken_Event_Master__c WHERE Name='${EVENT.title}'`);
      ids.event = e.Id;
      await note('Group event in Salesforce', e);
      expect(e.Event_Status__c).toBe('In Review');
      expect(e.Segmentation__r?.Definition_JSON__c ?? '', 'event audience is the group').toContain(ids.privateGroup);
    }
  });

  test('SF: group event is linked to its group (Event Group lookup)', async () => {
    test.skip(!sf || !ids.event, 'needs the group event and a Salesforce session');
    test.fail(true, 'KNOWN BUG (2026-09-30): events created from a group\'s "Create an Event" get the group as their ' +
      'audience, but Ken_Event_Master__c.Evvent_Group__c stays empty, so the group\'s Events tab may never list them.');
    const [e] = await sfQuery(`SELECT Evvent_Group__c FROM Ken_Event_Master__c WHERE Id='${ids.event}'`);
    expect(e.Evvent_Group__c).toBe(ids.privateGroup);
  });

  test('SF: approve the group event', { tag: '@sf-approval' }, async ({ browser }) => {
    test.skip(!sf || !ids.event, 'needs the group event and a Salesforce session');
    const ctx = await browser.newContext({ storageState: SF_AUTH_FILE });
    await new SfApprovalPage(await ctx.newPage()).decide(ids.event, 'Approve', 'Approved by Playwright automation');
    await ctx.close();
    const [e] = await sfQuery(`SELECT Event_Status__c FROM Ken_Event_Master__c WHERE Id='${ids.event}'`);
    expect(e.Event_Status__c).toBe('Approved');
  });

  test('POSITIVE: receiver sees the group event and accepts it', { tag: '@sf-approval' }, async ({ receiver }) => {
    test.skip(!ids.event, 'needs the approved group event');
    const d = new GroupDetailPage(receiver);
    await d.goto(ids.privateGroup);
    await d.tabs.Events.click();
    await expect(receiver.getByText(EVENT.title).first()).toBeVisible();
    await receiver.getByText(EVENT.title).first().click();
    await receiver.getByRole('button', { name: /Register|Accept|RSVP|Attend|Join/i }).first().click();
    await expect(receiver.getByText(/registered|accepted|confirmed|see you/i).first()).toBeVisible();
    await snap(receiver, 'Receiver - group event accepted');
  });
});
