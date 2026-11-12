import { expect, type Locator, type Page } from '@playwright/test';

/** /alumni/business */
export class BusinessDirectoryPage {
  readonly listYourBusiness: Locator;
  readonly search: Locator;
  readonly filters: Locator;

  constructor(readonly page: Page) {
    this.listYourBusiness = page.getByText('List Your Business', { exact: true });
    this.search = page.getByPlaceholder('Search', { exact: true });
    this.filters = page.getByRole('button', { name: 'Filters' });
  }

  async goto() {
    await this.page.goto('business');
    await expect(this.page).toHaveTitle(/^Business Directory( \| Kenverse)?$/);
    await expect(this.page.getByRole('heading', { name: 'My businesses' })).toBeVisible({ timeout: 60_000 });
  }

  /** Text of the "All businesses" section / "My businesses" section. */
  async sections() {
    const t = await this.page.locator('main').innerText();
    return { all: t.slice(t.indexOf('All businesses'), t.indexOf('My businesses')), mine: t.slice(t.indexOf('My businesses')) };
  }
}

/** /alumni/business/create-business — "List Your Business" form. */
export class ListBusinessPage {
  readonly main: Locator;
  readonly requestListing: Locator;

  constructor(readonly page: Page) {
    this.main = page.locator('main');
    this.requestListing = page.getByRole('button', { name: 'Request Listing' });
  }

  /** Click "Request Listing" and wait until the button stops showing "Saving..." (uploads can take a while). */
  async submit() {
    await this.requestListing.click();
    const saving = this.page.getByRole('button', { name: 'Saving...' });
    await saving.waitFor({ timeout: 5_000 }).catch(() => {});
    await expect(saving).toBeHidden({ timeout: 120_000 });
  }

  get cover() { return this.main.locator('input[type=file]').nth(0); }
  get logo() { return this.main.locator('input[type=file]').nth(1); }
  get name() { return this.page.getByPlaceholder('Enter name'); }
  get type() { return this.main.locator('select').first(); }
  get website() { return this.page.getByPlaceholder('https://www.example.com'); }
  get phone() { return this.page.getByPlaceholder('0000 0000 00'); }
  get email() { return this.page.getByPlaceholder('Enter email ID'); }
  get address() { return this.page.getByPlaceholder('Enter business address'); }
  get mapUrl() { return this.page.getByPlaceholder('https://maps.google.com/...'); }
  get description() { return this.main.locator('[contenteditable=true]').first(); }
  hideFromProfile(i: 0 | 1) { return this.main.getByRole('checkbox').nth(i); } // 0 = phone, 1 = email

  async goto() {
    await this.page.goto('business/create-business');
    await expect(this.page.getByRole('heading', { name: 'Please fill in the form to setup your business' })).toBeVisible({ timeout: 60_000 });
    await expect(this.name).toBeVisible();
  }

  async fill(b: Partial<{ name: string; type: string; website: string; phone: string; email: string; address: string; mapUrl: string; description: string; cover: string; logo: string }>) {
    if (b.cover) await this.cover.setInputFiles(b.cover);
    if (b.logo) await this.logo.setInputFiles(b.logo);
    if (b.name) await this.name.pressSequentially(b.name, { delay: 5 });
    if (b.type) await this.type.selectOption({ label: b.type });
    if (b.website) await this.website.pressSequentially(b.website);
    if (b.phone) await this.phone.pressSequentially(b.phone);
    if (b.email) await this.email.pressSequentially(b.email);
    if (b.address) await this.address.pressSequentially(b.address);
    if (b.mapUrl) await this.mapUrl.pressSequentially(b.mapUrl);
    if (b.description) { await this.description.click(); await this.page.keyboard.type(b.description); }
  }
}
