import { test, expect } from '../network/fixtures';
import { SF_AUTH_FILE } from '../../playwright.config';
import { CampaignDetailPage, CreateCampaignPage, FundraisePage } from '../../pages/FundraisePage';
import { SfApprovalPage } from '../../pages/sf/SfApprovalPage';
import { note, snap } from '../../utils/report';
import { hasSfSession, pendingWorkItem, sfQuery } from '../../utils/salesforce';
import { FIXTURES } from '../../utils/testData';

const day = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const VALID = {
  category: 'Student Scholarships',
  description: 'Automated QA campaign to fund scholarships.',
  currencyLabel: '₹ Indian Rupees (INR)',
  goal: '50000',
  start: day(10),
  end: day(40),
};

async function campaignByName(name: string) {
  const [c] = await sfQuery(
    `SELECT Id, Name, Approval_Status__c, Campaign_Status__c, Is_Published__c, Fundraise_Category__r.Name, Currency__c,
            Fundraising_Goal__c, Collection_Method__c, Start_Date__c, End_Date__c, Segmentation__c, Cover_Image__c, Description__c
       FROM Ken_Fundraise__c WHERE Name = '${name.replace(/'/g, "\\'")}' ORDER BY CreatedDate DESC LIMIT 1`,
  );
  return c;
}

test.describe('Fundraise module - page and validation', () => {
  test('POSITIVE: Fundraise page shows impact stats, causes and My Campaigns', async ({ page }) => {
    const f = new FundraisePage(page);
    await f.goto();
    await expect(page.getByRole('heading', { name: 'Donor Impact' })).toBeVisible();
    await expect(page.getByText('Campaigns launched by alumni')).toBeVisible();
    await expect(page.getByText('Goal set across alumni campaigns')).toBeVisible();
    await expect(f.donateSection).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Student Scholarships' })).toBeVisible();
    await expect(f.viewAllCampaigns).toBeVisible();
    await expect(f.createNew).toBeVisible();
    await snap(page, 'Fundraise page');
  });

  test('NEGATIVE: empty Setup Campaign shows every required-field error', async ({ page }) => {
    const c = new CreateCampaignPage(page);
    await c.goto();
    for (const step of ['Setup Campaign', 'Target Audience', 'Summary']) await expect(page.getByText(step).first()).toBeVisible();
    await c.next.click();
    for (const msg of ['Title is required', 'Please select a category', 'Description is required',
      'Fundraising goal is required', 'Start date is required', 'End date is required']) {
      await expect(page.getByText(msg), msg).toBeVisible();
    }
    await c.expectStep(1);
    await snap(page, 'Create campaign - required errors');
  });

  test('NEGATIVE: invalid goal, dates and link are rejected', async ({ page }) => {
    test.fail(true, 'KNOWN BUG (2026-09-30): no validation - goal 0/-100, end date before start, past start date and ' +
      '"not-a-url" are all accepted and saved to Ken_Fundraise__c. Each run leaves "QA Probe ..." drafts in Salesforce.');
    const c = new CreateCampaignPage(page);
    const probes = [
      { name: 'goal 0', goal: '0' },
      { name: 'goal negative', goal: '-100' },
      { name: 'end date before start date', start: day(20), end: day(10) },
      { name: 'start date in the past', start: day(-5), end: day(10) },
      { name: 'invalid external link', externalLink: 'not-a-url' },
    ];
    for (const p of probes) {
      await test.step(p.name, async () => {
        await c.goto();
        await c.fillSetup({ ...VALID, title: `QA Probe ${p.name}`, ...p });
        await c.next.click();
        const movedOn = await page.getByText('Step 2 out of 3').waitFor({ timeout: 8_000 }).then(() => true, () => false);
        await snap(page, `Probe - ${p.name}`);
        expect.soft(movedOn, `${p.name} must be rejected (stay on step 1)`).toBe(false);
      });
    }
  });
});

test.describe('Fundraise module - create campaign end-to-end (portal -> Salesforce)', () => {
  test.describe.configure({ mode: 'serial' });
  const title = `QA Auto Campaign ${Date.now().toString().slice(-6)}`;
  let recordId = '';

  test('POSITIVE: create a campaign through all 3 steps', async ({ page }) => {
    const c = new CreateCampaignPage(page);
    await note('Campaign', { title, ...VALID });
    await test.step('Step 1 - Setup Campaign', async () => {
      await c.goto();
      await c.fillSetup({ ...VALID, title, cover: FIXTURES.validCover });
      await snap(page, 'Step 1 filled');
      await c.next.click();
      await c.expectStep(2);
    });
    await test.step('Step 2 - NEGATIVE: cannot continue without an audience', async () => {
      await c.next.click();
      await c.expectStep(2);
      await snap(page, 'Step 2 - no audience, still on step 2');
    });
    await test.step('Step 2 - POSITIVE: add "all audience"', async () => {
      await c.addSavedAudience('all audience');
      await snap(page, 'Step 2 - all audience added');
      await c.next.click();
      await c.expectStep(3);
    });
    await test.step('Step 3 - Summary shows what was entered', async () => {
      const main = c.main;
      await expect(main.getByText(title, { exact: true })).toBeVisible();
      await expect(main.getByText(VALID.category, { exact: true })).toBeVisible();
      await expect(main.getByText('₹50,000')).toBeVisible();
      await expect(main.getByText('Within the Alumni Community')).toBeVisible();
      await expect(main.getByText('All Alumni', { exact: true })).toBeVisible();
      await snap(page, 'Step 3 - summary');
    });
    await test.step('Submit Campaign', async () => {
      await c.submit.click();
      await expect(page).toHaveURL(/campaign-detail\?recordId=/, { timeout: 60_000 });
      recordId = new CampaignDetailPage(page).recordId()!;
      await note('Campaign record Id', recordId);
    });
  });

  test('POSITIVE: submitted campaign is "In Review" in the portal, not open for donations', async ({ page }) => {
    await page.goto(`fundraise/campaign-detail?recordId=${recordId}`);
    await expect(page.getByText(title).first()).toBeVisible();
    await expect(page.getByText('In Review', { exact: true })).toBeVisible();
    await expect(page.getByText('₹50,000')).toBeVisible();
    await expect(page.getByText('0 Donated')).toBeVisible();
    await snap(page, 'Campaign detail - In Review');

    const f = new FundraisePage(page);
    await f.goto();
    await expect(f.myCampaign(title)).toContainText('In Review');
    await snap(page, 'My Campaigns - In Review');
  });

  test('NEGATIVE: an In Review campaign cannot be deleted from the portal', async ({ page }) => {
    await page.goto(`fundraise/campaign-detail?recordId=${recordId}`);
    await expect(page.getByText('Only approved campaigns can be deleted.')).toBeAttached();
    await snap(page, 'Delete blocked for In Review');
  });

  test.describe('Salesforce', () => {
    test.use({ storageState: SF_AUTH_FILE });
    test.beforeAll(async () => {
      test.skip(!(await hasSfSession()), 'Salesforce session missing or expired - run: npm run sf:login');
    });

    test('SF: campaign saved In Review, unpublished, with approval pending', async () => {
      const rec = await campaignByName(title);
      await note('Ken_Fundraise__c', rec);
      expect(rec.Id).toBe(recordId);
      expect(rec.Approval_Status__c).toBe('In Review');
      expect(rec.Campaign_Status__c).toBe('Upcoming');
      expect(rec.Is_Published__c).toBe(false);
      expect(rec.Fundraise_Category__r?.Name).toBe(VALID.category);
      expect(rec.Currency__c).toBe('INR');
      expect(rec.Fundraising_Goal__c).toBe(Number(VALID.goal));
      expect(rec.Collection_Method__c).toBe('Internal');
      expect(rec.Start_Date__c).toBe(VALID.start);
      expect(rec.End_Date__c).toBe(VALID.end);
      expect(rec.Segmentation__c, 'target audience linked').toBeTruthy();
      expect(rec.Cover_Image__c, 'cover uploaded').toBeTruthy();
      const item = await pendingWorkItem(recordId);
      await note('Pending approval', item);
      expect(item?.ProcessInstance.ProcessDefinition.Name).toBe('Fundraise Campaign Approval Process');
    });

    test('SF: approve the campaign', { tag: '@sf-approval' }, async ({ page }) => {
      await new SfApprovalPage(page).decide(recordId, 'Approve', 'Approved by Playwright automation');
      await snap(page, 'SF - campaign approved');
      const rec = await campaignByName(title);
      await note('Ken_Fundraise__c after approval', rec);
      expect(rec.Approval_Status__c).toBe('Approved');
    });
  });

  test('POSITIVE: approved campaign shows as Approved in the portal', { tag: '@sf-approval' }, async ({ page }) => {
    await page.goto(`fundraise/campaign-detail?recordId=${recordId}`);
    await expect(page.getByText('In Review', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Only approved campaigns can be deleted.')).toHaveCount(0);
    await snap(page, 'Campaign detail - approved');
  });
});
