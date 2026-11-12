import { test, expect } from '../../network/fixtures';
import { CreateCampaignPage } from '../../../pages/FundraisePage';
import { snap } from '../../../utils/report';
import { expectMaxLength, expectUploadRejected, FILES, INPUTS, knownBug, SF_LIMITS } from '../../../utils/validation';

/**
 * Fundraise > Create Campaign - Step 1 input validation.
 * Title is left empty (or invalid) in every check, so no draft campaign is created.
 * Goal / date validation (0, negative, end before start, past start) is covered in fundraise.spec.ts.
 */
test.describe('Validation - Fundraise (Create Campaign)', () => {
  let c: CreateCampaignPage;
  test.beforeEach(async ({ page }) => {
    c = new CreateCampaignPage(page);
    await c.goto();
  });

  test('Campaign title is limited to the Salesforce field size (80)', async () => {
    knownBug('Campaign title has no length limit; Salesforce Ken_Fundraise__c.Name holds 80 characters.');
    await expectMaxLength(c.title, SF_LIMITS.campaignTitle, 'Campaign title');
  });

  test('Spaces-only title and description are rejected', async ({ page }) => {
    const d = (n: number) => { const x = new Date(); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };
    await c.fillSetup({ title: INPUTS.spaces, category: 'Student Scholarships', description: INPUTS.spaces, goal: '5000', start: d(10), end: d(20) });
    await c.next.click();
    await expect(page.getByText('Title is required')).toBeVisible();
    await expect(page.getByText('Description is required')).toBeVisible();
    await c.expectStep(1);
    await snap(page, 'Spaces-only title/description');
  });

  test('Fundraising goal accepts numbers only, with at most 2 decimals', async ({ page }) => {
    knownBug('Goal accepts "1e3" (scientific notation) and "12.345" (3 decimals) without an error.');
    await c.goal.pressSequentially('abc');
    await expect(c.goal, 'letters are blocked').toHaveValue('');
    for (const v of ['1e3', '12.345']) {
      await test.step(v, async () => {
        await c.goal.clear();
        await c.goal.pressSequentially(v);
        await c.next.click(); // title empty -> cannot advance anyway
        const value = await c.goal.inputValue();
        const err = await page.getByText(/valid amount|decimal|whole number|invalid/i).count();
        expect.soft(value !== v || err > 0, `goal "${v}" must be rejected or corrected`).toBe(true);
      });
    }
  });

  test('External fundraising link is required when that option is chosen', async ({ page }) => {
    await page.locator('main').getByText('External fundraising link', { exact: true }).click();
    await c.next.click();
    await expect(page.getByText('Please paste the fundraiser link')).toBeVisible();
    await expectMaxLength(c.externalLink, SF_LIMITS.campaignLink, 'External link');
  });

  test('Cover photo: over 5 MB and non-image files are rejected with a message', async ({ page }) => {
    knownBug('A 6 MB file and a .txt file are both accepted as the campaign cover (broken preview, no message).');
    const accepted = page.getByText('Click to change photo');
    await expectUploadRejected(page, c.cover, FILES.png6mb, 'Cover 6 MB', accepted);
    await c.goto();
    await expectUploadRejected(page, c.cover, FILES.notAnImage, 'Cover .txt', accepted);
    await snap(page, 'Campaign cover validation');
  });
});
