import { test, expect, RECEIVER } from '../network/fixtures';
import { SF_AUTH_FILE } from '../../playwright.config';
import { SfApprovalPage } from '../../pages/sf/SfApprovalPage';
import { sfSurveyDate, SfSurveyWizard } from '../../pages/sf/SfSurveyWizard';
import { SurveyPage } from '../../pages/SurveyPage';
import { note, snap } from '../../utils/report';
import { alumnusByEmail, hasSfSession, sfDelete, sfQuery } from '../../utils/salesforce';

/**
 * Feedback & Survey end-to-end:
 *   Salesforce backend creates a survey for "all audience" -> SF approval -> portal user answers it
 *   -> responses verified in Salesforce -> survey deleted from the Salesforce backend (afterAll).
 */
test.describe.configure({ mode: 'serial' });

const SURVEY = {
  title: `QA Auto Survey ${Date.now().toString().slice(-6)}`,
  description: 'Automated QA survey created from the Salesforce backend.',
  q1: { text: 'How satisfied are you with the alumni portal?', type: 'Single Select' as const, options: ['Very satisfied', 'Not satisfied'] },
  q2: { text: 'Any suggestions?', type: 'Short Answer' as const },
  answer1: 'Very satisfied',
  answer2: 'More mentorship events please',
};
let surveyId = '';

test.describe('Feedback & Survey module', () => {
  test.beforeAll(async () => {
    test.skip(!(await hasSfSession()), 'Salesforce session missing or expired - run: npm run sf:login');
  });

  test.afterAll(async () => {
    if (!surveyId) return;
    // Cleanup requested: delete the survey (and its responses / questions) from the Salesforce backend.
    const [s] = await sfQuery(`SELECT Assessment_Question_Set__c FROM Ken_Survey__c WHERE Id='${surveyId}'`);
    const assessments = await sfQuery(`SELECT Id FROM Assessment WHERE Ken_Survey__c='${surveyId}'`);
    const aIds = assessments.map((a: any) => `'${a.Id}'`).join(',') || "''";
    const responses = await sfQuery(`SELECT Id FROM AssessmentQuestionResponse WHERE AssessmentId IN (${aIds})`);
    const questions = await sfQuery(`SELECT Id FROM AssessmentQuestion WHERE DeveloperName LIKE '${SURVEY.title.replace(/\W/g, '_')}%'`);
    const report = [
      await sfDelete('AssessmentQuestionResponse', responses.map((r: any) => r.Id)),
      await sfDelete('Assessment', assessments.map((a: any) => a.Id)),
      await sfDelete('Ken_Survey__c', [surveyId]),
      await sfDelete('AssessmentQuestionSet', s?.Assessment_Question_Set__c ? [s.Assessment_Question_Set__c] : []),
      // Salesforce blocks deleting questions with an ACTIVE version; these stay in the question bank.
      await sfDelete('AssessmentQuestion', questions.map((q: any) => q.Id)),
    ];
    console.log('SF cleanup:', JSON.stringify(report.map(r => ({ object: r.object, deleted: r.results.filter(x => x.ok).length, notDeleted: r.results.filter(x => !x.ok).length }))));
  });

  test.describe('Salesforce backend', () => {
    test.use({ storageState: SF_AUTH_FILE });

    test('SF NEGATIVE: survey wizard validation on every step', async ({ page }) => {
      const w = new SfSurveyWizard(page);
      await w.goto();
      await test.step('Step 1: empty -> title, start and end date required', async () => {
        await w.next.click();
        await expect(page.getByText('Survey title is required.')).toBeVisible();
        await expect(page.getByText('Start date is required.')).toBeVisible();
        await expect(page.getByText('End date is required.')).toBeVisible();
      });
      await test.step('Step 1: end date before start date', async () => {
        await w.title.fill('QA Auto Survey validation');
        await w.setDates(sfSurveyDate(10), sfSurveyDate(5));
        await w.next.click();
        await expect(page.getByText('End date must be equal to or after the start date.')).toBeVisible();
        await w.expectStep(1);
        await snap(page, 'SF survey - date validation');
      });
      await test.step('Step 2: cannot continue without an audience', async () => {
        await w.setDates(sfSurveyDate(0), sfSurveyDate(20));
        await w.next.click();
        await w.expectStep(2);
        await w.next.click();
        await w.expectStep(2);
      });
      await test.step('Step 3: at least one question required', async () => {
        await w.addSavedAudience('all audience');
        await w.next.click();
        await w.expectStep(3);
        await w.next.click();
        await expect(page.getByText('Add at least one question.')).toBeVisible();
        await w.expectStep(3);
        await snap(page, 'SF survey - question required');
      });
      // Nothing is saved until Submit on step 4, so leaving here creates no record.
    });

    test('SF: create a survey for "all audience" from the backend', async ({ page }) => {
      const w = new SfSurveyWizard(page);
      await note('Survey', SURVEY);
      await w.goto();
      await w.title.fill(SURVEY.title);
      await w.description.fill(SURVEY.description);
      await w.setDates(sfSurveyDate(0), sfSurveyDate(20));
      await w.next.click();
      await w.expectStep(2);
      await w.addSavedAudience('all audience');
      await snap(page, 'SF survey - all audience');
      await w.next.click();
      await w.expectStep(3);
      await w.question(0, SURVEY.q1);
      await w.question(1, SURVEY.q2);
      await snap(page, 'SF survey - questions');
      await w.next.click();
      await w.expectStep(4);
      for (const text of [SURVEY.title, SURVEY.description, 'All Alumni', SURVEY.q1.text, ...SURVEY.q1.options, SURVEY.q2.text]) {
        await expect(page.getByText(text, { exact: true }).first(), `summary shows "${text}"`).toBeVisible();
      }
      await snap(page, 'SF survey - summary');
      await w.submit.click();
      await expect(page.getByText('Survey created successfully.')).toBeVisible();
      await expect(page).toHaveURL(/\/lightning\/r\/Ken_Survey__c\/\w+\/view/, { timeout: 60_000 });
      surveyId = page.url().match(/Ken_Survey__c\/(\w+)\/view/)![1];

      const [s] = await sfQuery(`SELECT Name, Type__c, Approval_Status__c, Is_Active__c, Module__c, Segmentation__r.Name, Assessment_Question_Set__c FROM Ken_Survey__c WHERE Id='${surveyId}'`);
      await note('Ken_Survey__c', s);
      expect(s).toMatchObject({ Name: SURVEY.title, Type__c: 'Survey', Approval_Status__c: 'Pending Approval', Is_Active__c: false, Module__c: 'Alumni' });
      expect(s.Segmentation__r?.Name).toBe('all audience');
      const qs = await sfQuery(`SELECT QuestionText FROM AssessmentQuestion WHERE DeveloperName LIKE '${SURVEY.title.replace(/\W/g, '_')}%'`);
      expect(qs.map((q: any) => q.QuestionText).sort()).toEqual([SURVEY.q1.text, SURVEY.q2.text].sort());
    });

    test('SF: approve the survey so alumni can see it', async ({ page }) => {
      test.skip(!surveyId, 'needs the survey');
      await new SfApprovalPage(page).decide(surveyId, 'Approve', 'Approved by Playwright automation');
      const [s] = await sfQuery(`SELECT Approval_Status__c, Is_Active__c FROM Ken_Survey__c WHERE Id='${surveyId}'`);
      expect(s).toMatchObject({ Approval_Status__c: 'Approved', Is_Active__c: true });
    });
  });

  test('PORTAL: alumnus sees the survey and answers it', async ({ receiver }) => {
    test.skip(!surveyId, 'needs the approved survey');
    const s = new SurveyPage(receiver);
    await s.goto();
    await expect(s.card(SURVEY.title)).toContainText('Total Questions');
    await expect(s.card(SURVEY.title)).toContainText('2');
    await snap(receiver, 'Portal - survey listed');
    await s.start(SURVEY.title);
    await expect(receiver.getByText(`1. ${SURVEY.q1.text}`)).toBeVisible();
    await expect(receiver.getByText(`2. ${SURVEY.q2.text}`)).toBeVisible();
    await expect(s.progress()).toHaveText('0 of 2 questions completed');

    await test.step('NEGATIVE: Submit with nothing answered asks for confirmation; "Review Form" returns to the form', async () => {
      await s.submit.click();
      await expect(receiver.getByText('Are you sure you want to submit your feedback?')).toBeVisible();
      await snap(receiver, 'Portal - confirm dialog');
      await s.reviewForm.click();
      await expect(receiver).toHaveURL(/survey-form/);
    });
    await test.step('Answer both questions', async () => {
      await s.choose(SURVEY.answer1);
      await s.textAnswer.pressSequentially(SURVEY.answer2, { delay: 5 });
      await s.textAnswer.blur();
      await expect(s.progress()).toContainText('of 2 questions completed');
      await snap(receiver, 'Portal - answered');
    });
    await test.step('Submit and confirm', async () => {
      await s.submit.click();
      await s.confirmYes.click();
      await expect(receiver.getByText('Survey Submitted Successfully')).toBeVisible();
      await expect(receiver.getByText(`Your response for "${SURVEY.title}" has been submitted.`)).toBeVisible();
      await snap(receiver, 'Portal - submitted');
    });
    await test.step('Survey now shows as Completed (with Retake)', async () => {
      await s.goto();
      await expect(s.card(SURVEY.title)).toContainText('Completed');
      await expect(s.card(SURVEY.title).getByRole('button', { name: 'Retake' })).toBeVisible();
    });
  });

  test('SF: survey responses are saved against the respondent', async () => {
    test.skip(!surveyId, 'needs the answered survey');
    const who = await alumnusByEmail(RECEIVER.email);
    const [a] = await sfQuery(`SELECT Id, AssessmentStatus, Respondent__c, Response_Category__c, Submitted_Date__c FROM Assessment WHERE Ken_Survey__c='${surveyId}' ORDER BY CreatedDate DESC LIMIT 1`);
    await note('Assessment (response header)', a);
    expect(a).toMatchObject({ AssessmentStatus: 'Completed', Respondent__c: who.AccountId, Response_Category__c: 'Survey' });
    const answers = await sfQuery(`SELECT AssessmentQuestion.QuestionText, ResponseValue FROM AssessmentQuestionResponse WHERE AssessmentId='${a.Id}'`);
    await note('AssessmentQuestionResponse', answers);
    const byQuestion = Object.fromEntries(answers.map((r: any) => [r.AssessmentQuestion?.QuestionText, r.ResponseValue]));
    expect(byQuestion[SURVEY.q1.text]).toBe(SURVEY.answer1);
    expect(byQuestion[SURVEY.q2.text]).toBe(SURVEY.answer2);
  });
});
