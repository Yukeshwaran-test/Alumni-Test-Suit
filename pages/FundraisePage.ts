import { expect, type Locator, type Page } from '@playwright/test';

export class FundraisePage {
  readonly createNew: Locator;
  readonly viewAllCampaigns: Locator;
  readonly myCampaigns: Locator;
  readonly donateSection: Locator;

  constructor(readonly page: Page) {
    this.createNew = page.getByText('Create New Campaign');
    this.viewAllCampaigns = page.getByRole('button', { name: 'View All Campaigns' });
    this.myCampaigns = page.locator('.my-campaigns-panel');
    this.donateSection = page.getByRole('heading', { name: 'Donate for a Cause' });
  }

  async goto() {
    await this.page.goto('fundraise');
    await expect(this.page).toHaveTitle(/^Fundraise( \| Kenverse)?$/);
    await expect(this.page.getByRole('heading', { name: 'My Campaigns' })).toBeVisible({ timeout: 60_000 });
  }

  myCampaign(title: string): Locator {
    return this.myCampaigns.locator('.card').filter({ has: this.page.getByRole('heading', { name: title, exact: true }) });
  }
}

/** /alumni/fundraise/create-campaign — 3 steps: Setup Campaign, Target Audience, Summary. */
export class CreateCampaignPage {
  readonly main: Locator;
  readonly next: Locator;
  readonly back: Locator;
  readonly submit: Locator;

  constructor(readonly page: Page) {
    this.main = page.locator('main');
    this.next = page.getByRole('button', { name: 'Next' }).last();
    // "Previous" belongs to the audience list's paging; the wizard's own button is "Back".
    this.back = page.getByRole('button', { name: 'Back', exact: true });
    this.submit = page.getByRole('button', { name: 'Submit Campaign' });
  }

  get cover() { return this.main.locator('input[type=file]').first(); }
  get title() { return this.page.getByPlaceholder('Add title'); }
  get category() { return this.main.locator('select[name=category]'); }
  get description() { return this.page.getByPlaceholder('Please provide a detailed explanation of why the funds are needed'); }
  get currency() { return this.main.locator('select[name=currency]'); }
  get goal() { return this.page.getByPlaceholder('00'); }
  get startDate() { return this.page.getByPlaceholder('Start date'); }
  get endDate() { return this.page.getByPlaceholder('End date'); }
  get externalLink() { return this.page.getByPlaceholder('Paste link'); }

  async goto() {
    await this.page.goto('fundraise/create-campaign');
    await this.expectStep(1);
  }

  async expectStep(n: number) {
    await expect(this.page.getByText(`Step ${n} out of 3`)).toBeVisible({ timeout: 60_000 });
  }

  /** Text inputs only register real keystrokes. */
  async type(field: Locator, text: string) {
    await field.clear();
    await field.pressSequentially(text, { delay: 5 });
  }

  async fillSetup(c: { title: string; category: string; description: string; currencyLabel?: string; goal: string; start: string; end: string; externalLink?: string; cover?: string }) {
    if (c.cover) await this.cover.setInputFiles(c.cover);
    await this.type(this.title, c.title);
    await this.category.selectOption({ label: c.category });
    await this.type(this.description, c.description);
    if (c.currencyLabel) await this.currency.selectOption({ label: c.currencyLabel });
    await this.type(this.goal, c.goal);
    if (c.externalLink !== undefined) {
      await this.main.getByText('External fundraising link', { exact: true }).click();
      await this.type(this.externalLink, c.externalLink);
    }
    await this.startDate.fill(c.start);
    await this.endDate.fill(c.end);
  }

  async addSavedAudience(name: string) {
    await this.type(this.page.getByPlaceholder('Search by name or ID'), name);
    await this.main
      .locator(':scope *')
      .filter({ has: this.page.getByText(name, { exact: true }) })
      .filter({ has: this.page.getByRole('button', { name: 'Review & Add' }) })
      .last()
      .getByRole('button', { name: 'Review & Add' })
      .click();
    await this.page.getByRole('dialog').getByRole('button', { name: 'Add Audience' }).click();
    await expect(this.main.getByText('Selected Audience')).toBeVisible();
  }
}

/** /alumni/fundraise/campaign-detail?recordId=... */
export class CampaignDetailPage {
  readonly deleteButton: Locator;
  readonly editButton: Locator;

  constructor(readonly page: Page) {
    this.deleteButton = page.getByRole('button', { name: 'Delete' });
    this.editButton = page.getByRole('button', { name: 'Edit' });
  }

  recordId() {
    return new URL(this.page.url()).searchParams.get('recordId');
  }
}
