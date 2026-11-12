import { test, expect } from '../network/fixtures';
import { BusinessDirectoryPage, ListBusinessPage } from '../../pages/BusinessPage';
import { note, snap } from '../../utils/report';
import { hasSfSession, sfDelete, sfGet, sfQuery } from '../../utils/salesforce';
import { FIXTURES } from '../../utils/testData';

const stamp = Date.now().toString().slice(-6);
const BUSINESS = {
  name: `QA Auto Business ${stamp}`,
  type: 'Technology & Software',
  website: 'https://qa-auto.example.com',
  phone: '9876543210',
  email: 'qa.business@example.com',
  address: '12 QA Street, Coimbatore',
  mapUrl: 'https://maps.google.com/?q=Coimbatore',
  description: 'Automated QA business listing.',
  cover: FIXTURES.validCover,
  logo: FIXTURES.squareCover,
};
const REQUIRED_ONLY = { name: `QA Biz Probe ${stamp}`, type: 'Technology & Software' };

test.describe('Business Directory module', () => {
  test.describe.configure({ mode: 'serial' });

  test.afterAll(async () => {
    if (!(await hasSfSession())) return;
    // Cleanup requested: delete this run's listings and their business Accounts from Salesforce.
    const names = [BUSINESS.name, REQUIRED_ONLY.name].map(n => `'${n}'`).join(',');
    const listings = await sfQuery(`SELECT Id, Business_Account__c FROM Ken_Business_Directory__c WHERE Business_Account__r.Name IN (${names})`);
    const accounts = await sfQuery(`SELECT Id FROM Account WHERE Name IN (${names})`);
    const report = [
      await sfDelete('Ken_Business_Directory__c', listings.map((l: any) => l.Id)),
      await sfDelete('Account', accounts.map((a: any) => a.Id)),
    ];
    console.log('SF cleanup:', JSON.stringify(report.map(r => ({ object: r.object, deleted: r.results.filter(x => x.ok).length, failed: r.results.filter(x => !x.ok) }))));
  });

  test('POSITIVE: Business Directory shows featured, All businesses and My businesses', async ({ page }) => {
    const d = new BusinessDirectoryPage(page);
    await d.goto();
    await expect(page.getByText(/Featured Business/)).toBeVisible();
    await expect(page.getByRole('heading', { name: 'All businesses' })).toBeVisible();
    await expect(d.search).toBeVisible();
    await expect(d.filters).toBeVisible();
    await expect(d.listYourBusiness).toBeVisible();
    await snap(page, 'Business Directory');
  });

  test('NEGATIVE: "List Your Business" field validation', async ({ page }) => {
    const f = new ListBusinessPage(page);
    await test.step('Empty form -> name and type required', async () => {
      await f.goto();
      await f.requestListing.click();
      await expect(page.getByText('Business name is required.')).toBeVisible();
      await expect(page.getByText('Business type is required.')).toBeVisible();
      await snap(page, 'Required errors');
    });
    const probes: [string, Parameters<ListBusinessPage['fill']>[0], string][] = [
      ['invalid website', { website: 'not-a-url' }, 'Enter a valid URL starting with http:// or https://.'],
      ['phone shorter than 10 digits', { phone: '123' }, 'India phone numbers must be 10 digits.'],
      ['invalid email', { email: 'not-an-email' }, 'Enter a valid email address.'],
      ['invalid map URL', { mapUrl: 'not-a-url' }, 'Enter a valid URL starting with http:// or https://.'],
    ];
    for (const [label, values, message] of probes) {
      await test.step(`${label} -> "${message}"`, async () => {
        await f.goto();
        await f.fill({ name: `QA Biz Invalid ${stamp}`, type: BUSINESS.type, ...values });
        await f.requestListing.click();
        await expect(page.getByText(message)).toBeVisible();
        await expect(page).toHaveURL(/create-business/);
        await snap(page, label);
      });
    }
    await test.step('Letters cannot be typed into the phone number', async () => {
      await f.goto();
      await f.phone.pressSequentially('abcdefghij');
      await expect(f.phone).toHaveValue('');
    });
    await test.step('Business name, email and phone are hidden from profile by default', async () => {
      await expect(f.hideFromProfile(0)).toBeChecked();
      await expect(f.hideFromProfile(1)).toBeChecked();
    });
  });

  test('NEGATIVE: cover picture narrower than 1028px is rejected', async ({ page }) => {
    test.fail(true, 'KNOWN BUG (2026-09-30): the form says "Min width: 1028px" but an 800px-wide cover is accepted and shown.');
    const f = new ListBusinessPage(page);
    await f.goto();
    await f.cover.setInputFiles(FIXTURES.squareCover); // 800 x 800
    await snap(page, 'Narrow cover accepted');
    await expect(page.getByText(/1028|too small|minimum width|wider/i).filter({ hasNotText: 'Max image size' }).first()).toBeVisible({ timeout: 5_000 });
  });

  test('POSITIVE: list a business with only the required fields', async ({ page }) => {
    const f = new ListBusinessPage(page);
    await f.goto();
    await f.fill(REQUIRED_ONLY);
    await f.submit();
    const d = new BusinessDirectoryPage(page);
    await expect(async () => {
      await d.goto();
      expect((await d.sections()).mine).toContain(REQUIRED_ONLY.name);
    }).toPass({ timeout: 60_000 });
  });

  test('POSITIVE: list a business with every field, shown as "In review"', async ({ page }) => {
    const f = new ListBusinessPage(page);
    await f.goto();
    await f.fill(BUSINESS);
    await snap(page, 'All fields filled');
    await f.submit();
    await snap(page, 'After Request Listing');
    const d = new BusinessDirectoryPage(page);
    await expect(async () => {
      await d.goto();
      const s = await d.sections();
      expect(s.mine).toContain(BUSINESS.name);
    }).toPass({ timeout: 60_000 });
    const s = await d.sections();
    const mine = s.mine.slice(s.mine.indexOf(BUSINESS.name), s.mine.indexOf(BUSINESS.name) + 120);
    expect(mine).toContain('In review');
    expect(mine).toContain(BUSINESS.address);
    expect(s.all, 'not listed publicly before approval').not.toContain(BUSINESS.name);
    await snap(page, 'My businesses - In review');
  });

  test('SF: Business Directory record and business Account hold every field', async () => {
    test.skip(!(await hasSfSession()), 'Salesforce session missing - run: npm run sf:login');
    const [listing] = await sfQuery(`SELECT Id, Name, Business_Account__c, Constituent_Role__c FROM Ken_Business_Directory__c WHERE Business_Account__r.Name = '${BUSINESS.name}'`);
    expect(listing, 'Ken_Business_Directory__c created').toBeTruthy();
    const acct = await sfGet(`/sobjects/Account/${listing.Business_Account__c}`);
    await note('Ken_Business_Directory__c', listing);
    await note('Business Account', Object.fromEntries(Object.entries(acct).filter(([k, v]) => v !== null && /Name|Phone|Website|Business|Location|Logo|Cover|Hide/.test(k))));
    expect(acct).toMatchObject({
      Name: BUSINESS.name,
      Business_Display_Name__c: BUSINESS.name,
      Business_Type__c: BUSINESS.type,
      Website: BUSINESS.website,
      Phone: BUSINESS.phone,
      Business_Email__c: BUSINESS.email,
      Business_Address__c: BUSINESS.address,
      Location_URL__c: BUSINESS.mapUrl,
      Business_Description__c: BUSINESS.description,
      Hide_Business_Email__c: true,
      Hide_Business_Phone__c: true,
      Business_Approval__c: 'Pending',
    });
    expect(acct.Cover_Image_Url__c, 'cover uploaded').toBeTruthy();
    expect(acct.Logo_URL__c, 'logo uploaded').toBeTruthy();
  });
});
