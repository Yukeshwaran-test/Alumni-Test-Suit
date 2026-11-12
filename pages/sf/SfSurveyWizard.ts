import { expect, type Locator, type Page } from '@playwright/test';
import { lightningUrl } from '../../utils/salesforce';

/** "dd-MMM-yyyy" as the Salesforce survey date inputs expect (e.g. 30-Sept-2026). */
export function sfSurveyDate(daysFromToday: number) {
  const d = new Date();
  d.setDate(d.getDate() + daysFromToday);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).replace(/ /g, '-');
}

/**
 * Salesforce backend: Surveys > New — 4-step wizard (About Survey, Target Audience, Setup Survey, Summary).
 */
export class SfSurveyWizard {
  readonly next: Locator;
  readonly submit: Locator;

  constructor(readonly page: Page) {
    // The saved-audience list has its own paging "Next"; the wizard's is the primary button.
    this.next = page.locator('button.btn-primary', { hasText: 'Next' });
    this.submit = page.getByRole('button', { name: 'Submit', exact: true });
  }

  get title() { return this.page.getByPlaceholder('Enter title'); }
  get description() { return this.page.getByPlaceholder('Enter description'); }
  get startDate() { return this.page.getByPlaceholder('Select date').nth(0); }
  get endDate() { return this.page.getByPlaceholder('Select date').nth(1); }

  async goto() {
    await this.page.goto(`${lightningUrl()}/lightning/o/Ken_Survey__c/new`);
    await this.expectStep(1);
  }

  async expectStep(n: number) {
    await expect(this.page.getByText(`Step ${n} out of 4`)).toBeVisible({ timeout: 60_000 });
  }

  async setDates(start: string, end: string) {
    await this.startDate.fill(start);
    await this.startDate.blur();
    await this.endDate.fill(end);
    await this.endDate.blur();
  }

  async addSavedAudience(name: string) {
    await this.page.getByPlaceholder('Search by name or ID').fill(name);
    await this.page.locator('body').locator(':scope *')
      .filter({ has: this.page.getByText(name, { exact: true }) })
      .filter({ has: this.page.getByRole('button', { name: 'Review & Add' }) })
      .last().getByRole('button', { name: 'Review & Add' }).click();
    await this.page.getByRole('dialog').last().getByRole('button', { name: 'Add Audience' }).click();
    await expect(this.page.getByText('Selected Audience')).toBeVisible();
  }

  /** Fill question `index` (0-based); adds a new question block first when index > 0. */
  async question(index: number, q: { text: string; type: 'Single Select' | 'Checkbox' | 'Linear Scale' | 'Short Answer'; options?: string[]; required?: boolean }) {
    if (index > 0) await this.page.getByRole('button', { name: 'Add Questions' }).click();
    await this.page.getByPlaceholder('Untitled question').nth(index).fill(q.text);
    // Each question block has a "Required" switch, in question order.
    if (q.required) await this.page.getByRole('switch').nth(index).check({ force: true });
    await this.page.getByRole('combobox').filter({ hasText: 'Select' }).last().click();
    await this.page.getByRole('option', { name: q.type, exact: true }).click();
    if (q.options) {
      const opts = this.page.getByPlaceholder('Add option');
      for (let i = 0; i < q.options.length; i++) await opts.nth(i).fill(q.options[i]);
    }
  }
}
