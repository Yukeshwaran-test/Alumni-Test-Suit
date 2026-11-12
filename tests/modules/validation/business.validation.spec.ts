import { test, expect } from '../../network/fixtures';
import { ListBusinessPage } from '../../../pages/BusinessPage';
import { snap } from '../../../utils/report';
import { expectEditorCap, expectMaxLength, expectUploadRejected, FILES, knownBug, SF_LIMITS } from '../../../utils/validation';

/**
 * Business Directory > List Your Business input validation.
 * Business type is left empty in format checks, so a bad value can never be saved.
 */
test.describe('Validation - Business Directory (List Your Business)', () => {
  let f: ListBusinessPage;
  test.beforeEach(async ({ page }) => {
    f = new ListBusinessPage(page);
    await f.goto();
  });

  test('Text lengths stay within the Salesforce field sizes', async ({ page }) => {
    knownBug('Business name, website, email and map URL have no length limit; Salesforce stores at most 255 / 255 / 80 / 255 characters.');
    await expectMaxLength(f.name, SF_LIMITS.businessName, 'Business name');
    await expectMaxLength(f.website, SF_LIMITS.businessWebsite, 'Website');
    await expectMaxLength(f.email, SF_LIMITS.businessEmail, 'Email ID');
    await expectMaxLength(f.mapUrl, SF_LIMITS.businessMapUrl, 'Map URL');
    await expectEditorCap(page, f.description, 8000, 'Business description');
  });

  test('Website and Map URL must be http:// or https:// links', async ({ page }) => {
    for (const [field, value] of [
      [f.website, 'www.example.com'],
      [f.website, 'ftp://example.com'],
      [f.website, 'http://'],
      [f.mapUrl, 'javascript:alert(1)'],
      [f.mapUrl, 'maps.google.com'],
    ] as const) {
      await test.step(`${value}`, async () => {
        await f.goto();
        await f.name.pressSequentially('QA Val probe');
        // The form can re-render right after load and drop early keystrokes - make sure the value really landed.
        await expect(async () => {
          if ((await field.inputValue()) !== value) { await field.clear(); await field.pressSequentially(value); }
          await expect(field).toHaveValue(value, { timeout: 2_000 });
        }).toPass({ timeout: 15_000 });
        await f.requestListing.click();
        await expect.soft(page.getByText(/URL must start with http|Enter a valid URL starting with http/).first(), `"${value}" must be rejected`).toBeVisible();
      });
    }
    await snap(page, 'URL validation');
  });

  test('Email ID must be a valid address', async ({ page }) => {
    for (const value of ['a@b', 'qa user@example.com', 'qa@@example.com', 'qa@example', '@example.com']) {
      await test.step(value, async () => {
        await f.goto();
        await f.name.pressSequentially('QA Val probe');
        await f.email.pressSequentially(value);
        await f.requestListing.click();
        await expect.soft(page.getByText('Enter a valid email address.'), `"${value}" must be rejected`).toBeVisible();
      });
    }
  });

  test('Phone number: digits only, exactly 10 digits, +91 prefix not corrupted', async ({ page }) => {
    knownBug('Pasting "+919876543210" keeps the first 10 digits ("9198765432") - a wrong number - instead of dropping the +91 or showing an error.');
    await f.phone.pressSequentially('abcdefghij');
    await expect(f.phone, 'letters are blocked').toHaveValue('');
    await f.phone.pressSequentially('987654321012');
    await expect(f.phone, 'more than 10 digits are blocked').toHaveValue('9876543210');
    await f.goto();
    await f.name.pressSequentially('QA Val probe');
    await f.phone.pressSequentially('123');
    await f.requestListing.click();
    await expect(page.getByText('India phone numbers must be 10 digits.')).toBeVisible();
    await f.phone.clear();
    await f.phone.pressSequentially('+919876543210');
    expect.soft(await f.phone.inputValue(), '+91 prefix must not shift the digits').toBe('9876543210');
  });

  test('Spaces-only business name is rejected', async ({ page }) => {
    await f.name.pressSequentially('     ');
    await f.requestListing.click(); // business type also empty -> nothing can be saved
    await expect(page.getByText('Business type is required.')).toBeVisible();
    knownBug('A spaces-only business name passes the form check (only "Business type is required." is shown).');
    await expect.soft(page.getByText('Business name is required.'), 'spaces-only name must be treated as empty').toBeVisible();
    await snap(page, 'Spaces-only name');
  });

  test('Cover (5 MB, PNG/JPEG) and logo (1 MB, PNG/JPEG) uploads are validated with a message', async ({ page }) => {
    knownBug('Cover/logo over the size limit are silently ignored (no message), and a .txt file is accepted as cover and as logo.');
    await expectUploadRejected(page, f.cover, FILES.png6mb, 'Cover 6 MB');
    await expectUploadRejected(page, f.cover, FILES.notAnImage, 'Cover .txt', page.getByText('Change cover picture'));
    await f.goto();
    await expectUploadRejected(page, f.logo, FILES.png1_5mb, 'Logo 1.5 MB');
    await expectUploadRejected(page, f.logo, FILES.notAnImage, 'Logo .txt', page.locator('main').getByText('not-an-image.txt'));
    await snap(page, 'Upload validation');
  });
});
