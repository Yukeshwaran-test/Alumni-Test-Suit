import { test, expect, RECEIVER } from '../../network/fixtures';
import { SF_AUTH_FILE } from '../../../playwright.config';
import { SfApprovalPage } from '../../../pages/sf/SfApprovalPage';
import { sfSurveyDate, SfSurveyWizard } from '../../../pages/sf/SfSurveyWizard';
import { SurveyPage } from '../../../pages/SurveyPage';
import { note, snap } from '../../../utils/report';
import { alumnusByEmail, hasSfSession, sfDelete, sfQuery, sfUpdate } from '../../../utils/salesforce';

/**
 * Feedback & Survey edge cases: SUR-023 required question enforced, SUR-021 retake, SUR-022 expired survey.
 * Creates its own survey in Salesforce and deletes it afterwards.
 */
test.describe.configure({ mode: 'serial' });

const S = {
  title: `QA Auto Survey Edge ${Date.now().toString().slice(-6)}`,
  q1: { text: 'Rate the alumni portal (required)', type: 'Single Select' as const, options: ['Good', 'Poor'], required: true },
  q2: { text: 'Anything else?', type: 'Short Answer' as const },
};
let surveyId = '';

test.describe('Edge cases - Feedback & Survey', () => {
  test.beforeAll(async () => {
    test.skip(!(await hasSfSession()), 'Salesforce session missing - run: npm run sf:login');
  });

  test.afterAll(async () => {
    if (!surveyId) return;
    const [s] = await sfQuery(`SELECT Assessment_Question_Set__c FROM Ken_Survey__c WHERE Id='${surveyId}'`);
    const assessments = await sfQuery(`SELECT Id FROM Assessment WHERE Ken_Survey__c='${surveyId}'`);
    const aIds = assessments.map((a: any) => `'${a.Id}'`).join(',') || "''";
    const responses = await sfQuery(`SELECT Id FROM AssessmentQuestionResponse WHERE AssessmentId IN (${aIds})`);
    const r = [
      await sfDelete('AssessmentQuestionResponse', responses.map((x: any) => x.Id)),
      await sfDelete('Assessment', assessments.map((x: any) => x.Id)),
      await sfDelete('Ken_Survey__c', [surveyId]),
      await sfDelete('AssessmentQuestionSet', s?.Assessment_Question_Set__c ? [s.Assessment_Question_Set__c] : []),
    ];
    console.log('SF cleanup:', JSON.stringify(r.map(x => ({ object: x.object, deleted: x.results.filter(y => y.ok).length }))));
  });

  test.describe('Salesforce setup', () => {
    test.use({ storageState: SF_AUTH_FILE });
    test('Setup: survey with a required question, approved', async ({ page }) => {
      const w = new SfSurveyWizard(page);
      await w.goto();
      await w.title.fill(S.title);
      await w.setDates(sfSurveyDate(0), sfSurveyDate(10));
      await w.next.click();
      await w.expectStep(2);
      await w.addSavedAudience('all audience');
      await w.next.click();
      await w.expectStep(3);
      await w.question(0, S.q1);
      await w.question(1, S.q2);
      await snap(page, 'SF - question 1 marked Required');
      await w.next.click();
      await w.expectStep(4);
      await w.submit.click();
      await expect(page).toHaveURL(/\/lightning\/r\/Ken_Survey__c\/\w+\/view/, { timeout: 60_000 });
      surveyId = page.url().match(/Ken_Survey__c\/(\w+)\/view/)![1];
      await new SfApprovalPage(page).decide(surveyId, 'Approve', 'Approved by Playwright automation (survey edge cases)');
      const [s] = await sfQuery(`SELECT Approval_Status__c, Is_Active__c FROM Ken_Survey__c WHERE Id='${surveyId}'`);
      expect(s).toMatchObject({ Approval_Status__c: 'Approved', Is_Active__c: true });
    });
  });

  test('SUR-023: a required question must be answered before submitting', async ({ receiver }) => {
    test.skip(!surveyId, 'needs the approved survey');
    const s = new SurveyPage(receiver);
    await s.goto();
    await s.start(S.title);
    await s.textAnswer.pressSequentially('Only the optional answer', { delay: 5 });
    await s.submit.click();
    // Either an inline "required" error, or the confirmation dialog must not allow the submit to go through.
    const yes = s.confirmYes;
    if (await yes.isVisible()) await yes.click();
    await receiver.waitForTimeout(3000);
    await snap(receiver, 'Submit without the required answer');
    await expect(receiver.getByText('Survey Submitted Successfully'), 'must NOT submit with the required question unanswered').toHaveCount(0);
    await expect(receiver.getByText(/required/i).first(), 'a "required" message is shown').toBeVisible();
    await test.step('Answer the required question and submit', async () => {
      if (await s.reviewForm.isVisible()) await s.reviewForm.click();
      await s.choose('Good');
      await s.submit.click();
      await s.confirmYes.click();
      await expect(receiver.getByText('Survey Submitted Successfully')).toBeVisible();
    });
  });

  test('SUR-021: a completed survey can be retaken', async ({ receiver }) => {
    test.skip(!surveyId, 'needs the answered survey');
    const s = new SurveyPage(receiver);
    await s.goto();
    await expect(s.card(S.title)).toContainText('Completed');
    await s.card(S.title).getByRole('button', { name: 'Retake' }).click();
    if (await s.introDialog.isVisible().catch(() => false)) await s.introDialog.getByRole('button', { name: 'Get Started' }).click();
    await expect(receiver).toHaveURL(/survey-form/, { timeout: 30_000 });
    await s.choose('Poor');
    await s.submit.click();
    await s.confirmYes.click();
    await expect(receiver.getByText('Survey Submitted Successfully')).toBeVisible();
    await snap(receiver, 'Retake submitted');
    const who = await alumnusByEmail(RECEIVER.email);
    const rows = await sfQuery(`SELECT Id, AssessmentStatus FROM Assessment WHERE Ken_Survey__c='${surveyId}' AND Respondent__c='${who.AccountId}'`);
    await note('Assessments for this respondent', rows);
    expect(rows.length, 'retake saved (new or updated response)').toBeGreaterThanOrEqual(1);
    const answers = await sfQuery(`SELECT ResponseValue FROM AssessmentQuestionResponse WHERE AssessmentId IN (${rows.map((r: any) => `'${r.Id}'`).join(',')})`);
    expect(answers.map((a: any) => a.ResponseValue), 'latest answer "Poor" stored').toContain('Poor');
  });

  test('SUR-022: an expired survey can no longer be answered', async ({ receiver }) => {
    test.skip(!surveyId, 'needs the survey');
    test.info().annotations.push({ type: 'Known bug (2026-10-01)', description: 'A survey whose end date has passed still opens with all questions and an active Submit button.' });
    const yesterday = new Date(Date.now() - 86_400_000).toISOString();
    const twoDaysAgo = new Date(Date.now() - 2 * 86_400_000).toISOString();
    await sfUpdate('Ken_Survey__c', surveyId, { Start_Date__c: twoDaysAgo, End_Date__c: yesterday }); // our own test survey
    const s = new SurveyPage(receiver);
    await s.goto();
    await receiver.waitForTimeout(2000);
    await snap(receiver, 'Survey list after expiry');
    const listed = await receiver.getByRole('heading', { name: S.title, exact: true }).count();
    if (listed) {
      const card = s.card(S.title);
      const actions = card.getByRole('button', { name: /Get Started|Retake/ });
      const enabled = (await actions.count()) && !(await actions.first().isDisabled());
      if (enabled) {
        await actions.first().click();
        if (await s.introDialog.isVisible().catch(() => false)) await s.introDialog.getByRole('button', { name: 'Get Started' }).click();
        await receiver.waitForTimeout(3000);
        await snap(receiver, 'Opening an expired survey');
        await expect(receiver.getByText(/expired|closed|no longer|ended/i).first(), 'expired survey must say it is closed').toBeVisible();
        await expect(s.submit, 'no Submit on an expired survey').toHaveCount(0);
      } else {
        await expect(card).toContainText(/expired|closed|ended/i);
      }
    }
  });
});
