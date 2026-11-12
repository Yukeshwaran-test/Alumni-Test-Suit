import { test, expect } from '../../network/fixtures';
import { SupportPage } from '../../../pages/SupportPage';
import { snap } from '../../../utils/report';
import { expectMaxLength, expectUploadRejected, FILES, INPUTS, knownBug, SF_LIMITS } from '../../../utils/validation';

/** Service & Support > Need Help? (Get Help dialog) input validation. Issue type stays empty, so nothing is submitted. */
test.describe('Validation - Service & Support (Get Help)', () => {
  let s: SupportPage;
  test.beforeEach(async ({ page }) => {
    s = new SupportPage(page);
    await s.goto();
    await s.openNeedHelp();
  });

  test('Subject and description stay within the Salesforce Case field sizes', async ({ page }) => {
    knownBug('Issue subject and description have no length limit; Salesforce Case.Subject holds 255 and Case.Description 32,000 characters.');
    await expectMaxLength(s.subject, SF_LIMITS.caseSubject, 'Issue subject');
    // Paste up to just under the limit (fast), then TYPE past it so any length limit gets a chance to apply.
    await s.description.fill('D'.repeat(SF_LIMITS.caseDescription - 10));
    await s.description.press('End');
    await s.description.pressSequentially('E'.repeat(40), { delay: 0 });
    const len = (await s.description.inputValue()).length;
    expect.soft(len, `Description holds ${len} characters, Salesforce limit is ${SF_LIMITS.caseDescription}`).toBeLessThanOrEqual(SF_LIMITS.caseDescription);
    await snap(page, 'Get Help length limits');
  });

  test('Spaces-only subject and description are rejected', async ({ page }) => {
    await s.subject.fill(INPUTS.spaces);
    await s.description.fill(INPUTS.spaces);
    await s.submit.click();
    await expect(page.getByText('Please select an issue type')).toBeVisible();
    await expect(page.getByText('Issue subject is required')).toBeVisible();
    await expect(page.getByText('Description is required')).toBeVisible();
  });

  test('Supporting document: over 5 MB and unsupported types are rejected with a message', async ({ page }) => {
    await expectUploadRejected(page, s.document, FILES.pdf6mb, 'Document 6 MB');
    await expect(page.getByText('File size must not exceed 5 MB.')).toBeVisible();
    await expectUploadRejected(page, s.document, FILES.notAnImage, 'Document .txt');
    await expect(page.getByText('Only PDF, PNG, JPG, DOC, or DOCX files are allowed.')).toBeVisible();
    await snap(page, 'Document validation');
  });
});
