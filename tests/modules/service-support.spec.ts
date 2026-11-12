import { test, expect, SENDER } from '../network/fixtures';
import { SupportPage } from '../../pages/SupportPage';
import { note, snap } from '../../utils/report';
import { alumnusByEmail, alumniServicesFromSf, hasSfSession, sfQuery, type AlumniService } from '../../utils/salesforce';
import { FIXTURES } from '../../utils/testData';

/**
 * Bugs are NOT marked as "expected to fail" in this file: if the portal is broken, the test
 * FAILS (red) in the report. The `bug` annotation explains the known cause.
 */
const CASE_BUG = '"Need Help" never creates a Case - Apex createNeedHelpCase returns HTTP 400 ' +
  '"The Apex request is invalid." for every portal user, and the dialog stays open with no error message.';
const SERVICES_BUG = '"Request for a Service" page is empty - Apex getServices / getServiceOfferings return HTTP 400 ' +
  '"The Apex request is invalid.", so no Alumni Services, Service Offerings or Questionnaires are shown.';
const bug = (description: string) => test.info().annotations.push({ type: 'Known bug (2026-10-01)', description });

test.describe('Service & Support module', () => {
  let sfServices: AlumniService[] = [];

  test.beforeAll(async () => {
    if (await hasSfSession()) sfServices = await alumniServicesFromSf();
  });
  test('POSITIVE: page shows FAQs, service request categories, Need Help and request history', async ({ page }) => {
    const s = new SupportPage(page);
    await s.goto();
    await expect(page.getByText('Frequently Asked Questions')).toBeVisible();
    await expect(s.requestService).toBeVisible();
    for (const cat of ['Academics', 'Housing', 'Finance']) await expect(page.getByText(cat, { exact: true }).first()).toBeVisible();
    await expect(s.needHelp).toBeVisible();
    await expect(s.serviceRequestsTab).toBeVisible();
    await expect(s.supportTicketsTab).toBeVisible();
    await expect(page.getByPlaceholder('Search for help topics...')).toBeVisible();
    await snap(page, 'Service & Support');
  });

  // ---------------- Request for a Service (reference data = Salesforce) ----------------
  test('Request for a Service: shows every Alumni Service configured in Salesforce', async ({ page }) => {
    test.skip(!sfServices.length, 'Salesforce session missing (npm run sf:login) or no alumni services configured');
    bug(SERVICES_BUG);
    await note('Alumni Services in Salesforce (expected on the portal)', sfServices.map(s => ({ service: s.name, category: s.category, offerings: s.offerings.map(o => o.name) })));
    const s = new SupportPage(page);
    const apex = s.watchApex();
    await s.goto();
    await s.openRequestForService();
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
    await snap(page, 'Request for a Service - page');
    await note('Portal Apex calls', apex);

    await test.step('Portal loaded the services without server errors', async () => {
      const failed = apex.filter(c => ['getServices', 'getServiceOfferings'].includes(c.method) && c.status >= 400);
      expect.soft(failed, 'getServices / getServiceOfferings must succeed').toEqual([]);
    });
    for (const svc of sfServices) {
      await test.step(`Alumni Service shown: "${svc.name}"`, async () => {
        await expect.soft(page.getByText(svc.name, { exact: true }).first(), `service "${svc.name}" from Salesforce`).toBeVisible({ timeout: 10_000 });
      });
    }
  });

  test('Request for a Service: selecting a service shows its Service Offerings from Salesforce', async ({ page }) => {
    const svc = sfServices.find(s => s.offerings.length);
    test.skip(!svc, 'Salesforce session missing (npm run sf:login) or no alumni service has offerings');
    bug(SERVICES_BUG);
    await note('Expected Service Offerings (Salesforce)', { service: svc!.name, offerings: svc!.offerings.map(o => o.name) });
    const s = new SupportPage(page);
    await s.goto();
    await s.openRequestForService();
    await expect(page.getByText(svc!.name, { exact: true }).first(), `service "${svc!.name}" must be listed to select it`).toBeVisible({ timeout: 15_000 });
    await page.getByText(svc!.name, { exact: true }).first().click();
    await snap(page, `Service selected - ${svc!.name}`);
    for (const o of svc!.offerings) {
      await test.step(`Service Offering shown: "${o.name}"`, async () => {
        await expect.soft(page.getByText(o.name, { exact: true }).first(), `offering "${o.name}"`).toBeVisible({ timeout: 10_000 });
      });
    }
  });

  test('Request for a Service: selecting an offering shows its Questionnaire from Salesforce', async ({ page }) => {
    const svc = sfServices.find(s => s.offerings.some(o => o.questions.length));
    const offering = svc?.offerings.find(o => o.questions.length);
    test.skip(!offering, 'Salesforce session missing (npm run sf:login) or no alumni offering has a questionnaire');
    bug(SERVICES_BUG);
    await note('Expected Questionnaire (Salesforce)', { service: svc!.name, offering: offering!.name, questionnaire: offering!.questionnaire, questions: offering!.questions });
    const s = new SupportPage(page);
    await s.goto();
    await s.openRequestForService();
    await expect(page.getByText(svc!.name, { exact: true }).first(), `service "${svc!.name}" must be listed to select it`).toBeVisible({ timeout: 15_000 });
    await page.getByText(svc!.name, { exact: true }).first().click();
    await expect(page.getByText(offering!.name, { exact: true }).first(), `offering "${offering!.name}" must be listed to select it`).toBeVisible({ timeout: 10_000 });
    await page.getByText(offering!.name, { exact: true }).first().click();
    await snap(page, `Offering selected - ${offering!.name}`);
    for (const q of offering!.questions) {
      await test.step(`Question shown: "${q}"`, async () => {
        await expect.soft(page.getByText(q, { exact: false }).first(), `question "${q}" (${offering!.questionnaire})`).toBeVisible({ timeout: 10_000 });
      });
    }
  });

  // ---------------- Other checks ----------------
  test('Greeting shows the logged-in user\'s name', async ({ page }) => {
    bug('Greeting reads "Hi, ! What can we help you with?" - the name is missing (Apex getCurrentUserFullName returns HTTP 400).');
    const s = new SupportPage(page);
    await s.goto();
    await expect(page.getByRole('heading', { name: /What can we help you with\?/ })).toContainText(SENDER.name.split(' ')[0]);
  });

  test('NEGATIVE: Get Help validation (required fields, unsupported file, Cancel)', async ({ page }) => {
    const s = new SupportPage(page);
    await s.goto();
    await s.openNeedHelp();
    await test.step('Empty submit -> issue type, description and subject required', async () => {
      await s.submit.click();
      await expect(page.getByText('Please select an issue type')).toBeVisible();
      await expect(page.getByText('Description is required')).toBeVisible();
      await expect(page.getByText('Issue subject is required')).toBeVisible();
      await snap(page, 'Get Help - required errors');
    });
    await test.step('Unsupported file type is rejected', async () => {
      await s.document.setInputFiles(FIXTURES.notAnImage);
      await expect(page.getByText('Only PDF, PNG, JPG, DOC, or DOCX files are allowed.')).toBeVisible();
      await snap(page, 'Get Help - unsupported file');
    });
    await test.step('Cancel closes the dialog without creating anything', async () => {
      await s.cancel.click();
      await expect(s.getHelpTitle).toBeHidden();
    });
  });

  test('E2E: "Need Help" request creates a Case - Case ID shown in this report', async ({ page }, testInfo) => {
    bug(CASE_BUG);
    const request = {
      type: 'Others',
      subject: `QA Auto Need Help ${Date.now().toString().slice(-6)}`,
      description: 'Automated QA request: I cannot update my profile picture.',
      document: FIXTURES.validCover,
    };
    await note('Need Help request', request);
    const s = new SupportPage(page);
    await s.goto();
    await s.openNeedHelp();
    await s.fill(request);
    await snap(page, 'Get Help - filled');

    const call = page.waitForResponse(r => /apex\/execute/.test(r.url()) && (r.request().postData() ?? '').includes('createNeedHelpCase'));
    await s.submit.click();
    const res = await call;
    await note('createNeedHelpCase response', { status: res.status(), body: (await res.text()).slice(0, 500) });
    await snap(page, 'Get Help - after submit');
    await expect(s.getHelpTitle, 'dialog closes after a successful submit').toBeHidden({ timeout: 15_000 });

    await test.step('Ticket appears under Support Tickets', async () => {
      await s.supportTicketsTab.click();
      await expect(page.getByText(request.subject)).toBeVisible();
      await snap(page, 'Support Tickets');
    });

    await test.step('Salesforce: Case created - Case ID added to the report', async () => {
      test.skip(!(await hasSfSession()), 'Salesforce session missing - run: npm run sf:login');
      const who = await alumnusByEmail(SENDER.email);
      const [c] = await sfQuery(
        `SELECT Id, CaseNumber, Subject, Description, Status, Origin, Type, AccountId, ContactId, CreatedDate
           FROM Case WHERE Subject = '${request.subject}' ORDER BY CreatedDate DESC LIMIT 1`,
      );
      expect(c, `Case with subject "${request.subject}"`).toBeTruthy();
      // Shown at the top of this test in the HTML report:
      testInfo.annotations.push({ type: 'Case ID', description: `${c.CaseNumber} (${c.Id})` });
      await note(`Salesforce Case ${c.CaseNumber}`, c);
      console.log(`Created Case ${c.CaseNumber} (${c.Id})`);
      expect(c.Subject).toBe(request.subject);
      expect(c.Description).toContain(request.description);
      expect([c.AccountId, c.ContactId]).toContain(c.ContactId === who.ContactId ? who.ContactId : who.AccountId);
      await expect(page.getByText(c.CaseNumber)).toBeVisible();
    });
  });
});
