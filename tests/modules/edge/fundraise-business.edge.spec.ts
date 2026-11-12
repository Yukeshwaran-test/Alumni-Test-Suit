import fs from 'node:fs';
import { test, expect } from '../../network/fixtures';
import { SF_AUTH_FILE } from '../../../playwright.config';
import { BusinessDirectoryPage, ListBusinessPage } from '../../../pages/BusinessPage';
import { CampaignDetailPage, CreateCampaignPage } from '../../../pages/FundraisePage';
import { SfApprovalPage } from '../../../pages/sf/SfApprovalPage';
import { note, snap } from '../../../utils/report';
import { hasSfSession, sfDelete, sfQuery } from '../../../utils/salesforce';
import { newTextDuring } from '../../../utils/validation';

/**
 * Edge cases that need a Salesforce approval first:
 *   FUN-023 donate to a running campaign, FUN-024 donate 0 / negative amount,
 *   BIZ-021 approved business listing appears publicly.
 * Tagged @sf-approval because they approve records in Salesforce.
 */
const iso = (n = 0) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

test.describe('Edge cases - Fundraise donations', { tag: '@sf-approval' }, () => {
  // Tests run in file order. Not "serial": a failed check must not skip the next test. Playwright restarts
  // the worker after a failure, so the campaign created in Setup is shared through a small state file.
  const STATE = '.auth/edge-donate.json';
  let title = `QA Edge Donate ${Date.now().toString().slice(-6)}`;
  let campaignId = '';
  test.beforeEach(async ({}, testInfo) => {
    if (!campaignId && !testInfo.title.startsWith('Setup') && fs.existsSync(STATE)) ({ title, campaignId } = JSON.parse(fs.readFileSync(STATE, 'utf8')));
  });

  test('Setup: campaign that starts today, approved in Salesforce', async ({ page, browser }) => {
    test.skip(!(await hasSfSession()), 'Salesforce session missing - run: npm run sf:login');
    const c = new CreateCampaignPage(page);
    await c.goto();
    await c.fillSetup({ title, category: 'Student Scholarships', description: 'QA edge-case donation campaign.', goal: '10000', start: iso(0), end: iso(30) });
    await c.next.click();
    await c.expectStep(2);
    await c.addSavedAudience('all audience');
    await c.next.click();
    await c.expectStep(3);
    await c.submit.click();
    await expect(page).toHaveURL(/campaign-detail\?recordId=/, { timeout: 60_000 });
    campaignId = new CampaignDetailPage(page).recordId()!;
    await note('Campaign', { title, campaignId });
    const ctx = await browser.newContext({ storageState: SF_AUTH_FILE });
    await new SfApprovalPage(await ctx.newPage()).decide(campaignId, 'Approve', 'Approved by Playwright automation (donation edge case)');
    await ctx.close();
    const [rec] = await sfQuery(`SELECT Approval_Status__c FROM Ken_Fundraise__c WHERE Id='${campaignId}'`);
    expect(rec.Approval_Status__c).toBe('Approved');
    fs.writeFileSync(STATE, JSON.stringify({ title, campaignId }));
  });

  async function openContribute(receiver: import('@playwright/test').Page) {
    await receiver.goto(`fundraise/campaign-detail?recordId=${campaignId}`);
    await expect(receiver.getByText(title).first()).toBeVisible({ timeout: 60_000 });
    await receiver.getByRole('button', { name: 'Contribute To This Cause' }).click();
    await expect(receiver.getByText('Contribution Amount*')).toBeVisible();
    return receiver.getByPlaceholder('Custom Amount');
  }

  test('FUN-023: a valid contribution is recorded (payment step / confirmation)', async ({ receiver }) => {
    test.skip(!campaignId, 'needs the approved campaign');
    test.info().annotations.push({ type: 'Known bug (2026-10-01)', description: '"Continue To Payment" saves a Pending donation and just closes the panel: no payment step and no confirmation message.' });
    const amount = await openContribute(receiver);
    await amount.fill('');
    await amount.pressSequentially('100');
    const saved = receiver.waitForResponse(r => /apex\/execute/.test(r.url()) && (r.request().postData() ?? '').includes('submitDonation'));
    await receiver.getByRole('button', { name: 'Continue To Payment' }).click();
    const res = await saved;
    await note('submitDonation response', { status: res.status(), body: (await res.text()).slice(0, 200) });
    await receiver.waitForTimeout(4000);
    await snap(receiver, 'After Continue To Payment (₹100)');
    await test.step('Salesforce: donation recorded as Pending for this donor', async () => {
      const [d] = await sfQuery(`SELECT Name, Amount__c, Currency__c, Payment_Status__c, Constituent_Role__c FROM Ken_Donation__c WHERE Fundraise__c='${campaignId}' ORDER BY CreatedDate DESC LIMIT 1`);
      await note('Ken_Donation__c', d);
      expect(d).toMatchObject({ Amount__c: 100, Currency__c: 'INR', Payment_Status__c: 'Pending' });
    });
    await test.step('User sees a payment step or a confirmation', async () => {
      await expect.soft(receiver.getByText(/payment gateway|pay now|card number|upi|thank you|contribution (received|successful)|success/i).first(),
        'a payment step or confirmation must follow "Continue To Payment"').toBeVisible({ timeout: 5_000 });
    });
  });

  test('FUN-024: contribution below ₹100, zero or negative is rejected', async ({ receiver }) => {
    test.skip(!campaignId, 'needs the approved campaign');
    await receiver.goto(`fundraise/campaign-detail?recordId=${campaignId}`);
    await expect(receiver.getByText(title).first()).toBeVisible({ timeout: 60_000 });
    await test.step('A campaign that starts today is shown as running', async () => {
      test.info().annotations.push({ type: 'Known bug (2026-10-01)', description: 'A campaign whose start date is today is labelled "Upcoming" instead of "Ongoing".' });
      await expect.soft(receiver.getByText('Ongoing', { exact: true }).first(), 'status should be Ongoing').toBeVisible({ timeout: 5_000 });
    });
    const amount = await openContribute(receiver);
    await expect(receiver.getByText('Minimum contribution ₹100')).toBeVisible();
    test.info().annotations.push({ type: 'Known bug (2026-10-01)', description: 'A negative amount (-10) is silently ignored: Continue To Payment does nothing and no message explains why.' });
    for (const v of ['0', '-10', '99']) {
      await test.step(`amount ₹${v}`, async () => {
        const appeared = await newTextDuring(receiver, async () => {
          await amount.fill('');
          await amount.pressSequentially(v);
          await receiver.getByRole('button', { name: 'Continue To Payment' }).click();
        }, 2500);
        await snap(receiver, `Contribute ${v}`);
        const error = appeared.find(s => /minimum|at least|greater|valid|amount|must/i.test(s));
        const leftPage = !/campaign-detail/.test(receiver.url());
        expect.soft(!leftPage && !!error, `₹${v} must be rejected with a message (new text ${JSON.stringify(appeared)}, url ${receiver.url()})`).toBe(true);
        if (leftPage) await openContribute(receiver);
      });
    }
  });
});

test.describe('Edge cases - Business Directory approval', { tag: '@sf-approval' }, () => {
  test.describe.configure({ mode: 'serial' });
  const name = `QA Edge Business ${Date.now().toString().slice(-6)}`;
  let accountId = '';

  test.afterAll(async () => {
    if (!accountId) return;
    const listings = await sfQuery(`SELECT Id FROM Ken_Business_Directory__c WHERE Business_Account__c='${accountId}'`);
    const r = [await sfDelete('Ken_Business_Directory__c', listings.map((l: any) => l.Id)), await sfDelete('Account', [accountId])];
    console.log('SF cleanup:', JSON.stringify(r.map(x => ({ object: x.object, deleted: x.results.filter(y => y.ok).length }))));
  });

  test('BIZ-021: approved listing appears in All businesses', async ({ page, browser }) => {
    test.skip(!(await hasSfSession()), 'Salesforce session missing - run: npm run sf:login');
    const f = new ListBusinessPage(page);
    await f.goto();
    await f.fill({ name, type: 'Technology & Software', address: '12 QA Street, Coimbatore' });
    await f.submit();
    const d = new BusinessDirectoryPage(page);
    await expect(async () => {
      await d.goto();
      expect((await d.sections()).mine).toContain(name);
    }).toPass({ timeout: 60_000 });
    expect((await d.sections()).all, 'not public before approval').not.toContain(name);

    const [acct] = await sfQuery(`SELECT Id FROM Account WHERE Name='${name}' ORDER BY CreatedDate DESC LIMIT 1`);
    accountId = acct.Id;
    const ctx = await browser.newContext({ storageState: SF_AUTH_FILE });
    await new SfApprovalPage(await ctx.newPage()).decide(accountId, 'Approve', 'Approved by Playwright automation (business edge case)');
    await ctx.close();
    const [after] = await sfQuery(`SELECT Business_Approval__c FROM Account WHERE Id='${accountId}'`);
    await note('Business_Approval__c after approval', after);
    expect(after.Business_Approval__c).toBe('Approved');

    await test.step('My businesses shows it as Active', async () => {
      await expect(async () => {
        await d.goto();
        const mine = (await d.sections()).mine;
        expect(mine.slice(mine.indexOf(name), mine.indexOf(name) + 60)).toContain('Active');
      }).toPass({ timeout: 90_000 });
    });
    await test.step('Other alumni can find it in All businesses (search)', async () => {
      // "All businesses" only shows the first page, so search for the listing by name.
      await d.search.pressSequentially(name, { delay: 10 });
      await expect(page.locator('main').getByRole('heading', { name, exact: true }).first()).toBeVisible({ timeout: 30_000 });
      await snap(page, 'Approved business found in All businesses');
    });
  });
});
