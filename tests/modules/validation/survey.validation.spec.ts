import { test, expect } from '../../network/fixtures';
import { SF_AUTH_FILE } from '../../../playwright.config';
import { sfSurveyDate, SfSurveyWizard } from '../../../pages/sf/SfSurveyWizard';
import { snap } from '../../../utils/report';
import { hasSfSession } from '../../../utils/salesforce';
import { expectMaxLength, INPUTS, knownBug, SF_LIMITS } from '../../../utils/validation';

/**
 * Feedback & Survey - Salesforce backend survey wizard input validation.
 * Nothing is saved until Submit on step 4, which these tests never click.
 */
test.describe('Validation - Feedback & Survey (Salesforce survey wizard)', () => {
  test.use({ storageState: SF_AUTH_FILE });
  let w: SfSurveyWizard;

  test.beforeEach(async ({ page }) => {
    test.skip(!(await hasSfSession()), 'Salesforce session missing or expired - run: npm run sf:login');
    w = new SfSurveyWizard(page);
    await w.goto();
  });

  async function toQuestions() {
    await w.title.fill('QA Val survey');
    await w.setDates(sfSurveyDate(0), sfSurveyDate(5));
    await w.next.click();
    await w.expectStep(2);
    await w.addSavedAudience('all audience');
    await w.next.click();
    await w.expectStep(3);
  }

  test('Survey title is limited to the Salesforce field size (80)', async () => {
    knownBug('Survey title has no length limit; Ken_Survey__c.Name holds 80 characters.');
    await expectMaxLength(w.title, SF_LIMITS.surveyTitle, 'Survey title');
  });

  test('Spaces-only title and past start date are rejected', async ({ page }) => {
    await w.title.fill(INPUTS.spaces);
    await w.setDates(sfSurveyDate(0), sfSurveyDate(5));
    await w.next.click();
    await expect(page.getByText('Survey title is required.')).toBeVisible();
    await w.title.fill('QA Val survey');
    await w.setDates(sfSurveyDate(-3), sfSurveyDate(5));
    await w.next.click();
    // A past date is refused: the field shows "Value must be <today> or later." or is cleared ("Start date is required.").
    await expect(page.getByText(/Value must be .* or later\.|Start date is required\./).first()).toBeVisible();
    await w.expectStep(1);
    await snap(page, 'Survey step 1 validation');
  });

  test('Questions: blank or spaces-only question text is rejected', async ({ page }) => {
    await toQuestions();
    await page.getByRole('combobox').filter({ hasText: 'Select' }).last().click();
    await page.getByRole('option', { name: 'Short Answer', exact: true }).click();
    await w.next.click();
    await w.expectStep(3);
    await page.getByPlaceholder('Untitled question').first().fill(INPUTS.spaces);
    await w.next.click();
    await w.expectStep(3);
    await snap(page, 'Blank question rejected');
  });

  test('Single Select: blank options and duplicate options are rejected', async ({ page }) => {
    knownBug('Two identical options ("Same" / "Same") are accepted and the wizard moves on to the Summary.');
    await toQuestions();
    await w.question(0, { text: 'Pick one', type: 'Single Select' });
    await w.next.click();
    await w.expectStep(3); // blank options blocked
    const opts = page.getByPlaceholder('Add option');
    await opts.nth(0).fill('Same');
    await opts.nth(1).fill('Same');
    await w.next.click();
    await expect.soft(page.getByText('Step 3 out of 4'), 'duplicate options must be rejected').toBeVisible({ timeout: 5_000 });
    await snap(page, 'Duplicate options');
  });
});
