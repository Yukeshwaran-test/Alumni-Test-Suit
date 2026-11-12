import { expect, type Locator, type Page } from '@playwright/test';
import { displayDate, FIXTURES, type EventData } from '../utils/testData';

export const WIZARD_STEPS = [
  'Event Setup',
  'Target Audience',
  'Schedule Setup',
  'Pre Event Surveys',
  'Feedback Form',
  'Summary',
] as const;

/**
 * The portal's 6-step "Host an event" wizard (/alumni/event/host-event).
 *
 * Text inputs here only register real keystrokes: Playwright's fill() sets the value but the
 * component resets it on the next re-render. Always use type() below.
 */
export class HostEventPage {
  readonly main: Locator;
  readonly saveAndProceed: Locator;
  readonly previousStep: Locator;
  readonly saveAsDraft: Locator;
  readonly errorBanner: Locator;

  constructor(readonly page: Page) {
    this.main = page.locator('main');
    // Screens 1–2 say "Save and proceed", screens 3–5 say "Save & proceed".
    this.saveAndProceed = page.getByRole('button', { name: /^Save (and|&) proceed$/ });
    this.previousStep = page.getByRole('button', { name: 'Previous step' });
    this.saveAsDraft = page.getByRole('button', { name: 'Save as Draft' });
    this.errorBanner = page.getByText('Error', { exact: true });
  }

  async type(field: Locator, text: string) {
    await field.clear();
    await field.pressSequentially(text, { delay: 10 });
  }

  async goto() {
    await this.page.goto('event/host-event');
    await this.expectStep(1);
  }

  async expectStep(n: number) {
    await expect(this.page.getByText(`Step ${n} out of 6`)).toBeVisible({ timeout: 60_000 });
  }

  // ---------- Step 1: Event Setup ----------
  get coverInput() { return this.main.locator('input[type=file]').first(); }
  get titleInput() { return this.page.getByPlaceholder('Event title will be visible in the platform'); }
  get categoryDropdown() { return this.main.getByText('Event categories'); }
  /** Rich-text editors in page order: Description, Agenda, What to Expect. */
  editor(name: 'Description' | 'Agenda' | 'What to Expect') {
    return this.main.locator('[contenteditable=true]').nth({ Description: 0, Agenda: 1, 'What to Expect': 2 }[name]);
  }

  async uploadCover(path: string) {
    await this.coverInput.setInputFiles(path);
  }

  async chooseCategory(category: string) {
    await this.categoryDropdown.click();
    await this.main.getByText(category, { exact: true }).click();
  }

  async pickDate(iso: string) {
    for (let i = 0; i < 24; i++) {
      const day = this.main.locator(`.calendar-day[data-date="${iso}"]:not(.disabled)`);
      if (await day.isVisible()) {
        await day.click();
        await expect(this.main.getByText(displayDate(iso), { exact: true })).toBeVisible();
        return;
      }
      await this.main.locator('.calendar-nav').nth(1).click(); // next month
    }
    throw new Error(`Date ${iso} not selectable in the calendar`);
  }

  async fillEventSetup(d: EventData) {
    // Upload the cover first, then type the text fields.
    await this.uploadCover(FIXTURES.validCover);
    await expect(this.page.getByRole('button', { name: 'Choose a different picture' })).toBeVisible();
    await this.type(this.titleInput, d.title);
    await this.chooseCategory(d.category);
    await this.pickDate(d.date);
    await this.editor('Description').click();
    await this.page.keyboard.type(d.description);
    await this.editor('Agenda').click();
    await this.page.keyboard.type(d.agenda);
    await this.editor('What to Expect').click();
    await this.page.keyboard.type(d.whatToExpect);
    await expect(this.titleInput).toHaveValue(d.title);
  }

  // ---------- Step 2: Target Audience ----------
  get audienceSearch() { return this.page.getByPlaceholder('Search by name or ID'); }

  savedAudienceRow(name: string) {
    return this.main
      .locator(':scope *')
      .filter({ has: this.page.getByText(name, { exact: true }) })
      .filter({ has: this.page.getByRole('button', { name: 'Review & Add' }) })
      .last();
  }

  async addSavedAudience(name: string) {
    await this.type(this.audienceSearch, name);
    await this.savedAudienceRow(name).getByRole('button', { name: 'Review & Add' }).click();
    const dialog = this.page.getByRole('dialog');
    await expect(dialog.getByText('Review Saved Audience & Add')).toBeVisible();
    await expect(dialog.getByText(/\d+ members in total/)).toBeVisible();
    await dialog.getByRole('button', { name: 'Add Audience' }).click();
    await expect(this.main.getByText('Selected Audience')).toBeVisible();
    await expect(this.main.getByText('Audiences Added')).toBeVisible();
  }

  // ---------- Step 3: Schedule Setup ----------
  get sessionTitle() { return this.page.getByPlaceholder('Give a title for your session'); }
  get startTime() { return this.page.getByLabel('Start Time*'); }
  get endTime() { return this.page.getByLabel('End Time*'); }
  get sessionAgenda() { return this.page.getByPlaceholder('Outline session expectations'); }
  get eventLink() { return this.page.getByPlaceholder('Enter event link'); }

  async fillSession(s: EventData['session']) {
    await this.type(this.sessionTitle, s.title);
    await this.startTime.fill(s.start);
    await this.endTime.fill(s.end);
    await this.type(this.sessionAgenda, s.agenda);
    await this.main.getByText('Online event', { exact: true }).click();
    await this.type(this.eventLink, s.link);
    await this.eventLink.blur();
  }

  // ---------- Step 4: Pre Event Surveys ----------
  get mealsSwitch() { return this.page.getByRole('switch').first(); }
  /** Last switch on the screen once meals are on (the middle one is the locked dietary switch). */
  get customSurveySwitch() { return this.page.getByRole('switch').last(); }

  async tickMeal(iso: string, meal: string) {
    const box = this.main.locator(`input[data-meal="${meal}"][data-date-key="${iso}"]`);
    await box.locator('xpath=..').click(); // the checkbox is visually hidden; click its table cell
    await expect(box).toBeChecked();
  }

  async tickDietary(option: string) {
    await this.main.getByLabel(option, { exact: true }).check({ force: true });
  }

  async fillQuestion(scope: Locator, q: { text: string; options: string[] }) {
    await this.type(scope.getByPlaceholder('Enter your question here'), q.text);
    const opts = scope.getByPlaceholder('Add option');
    for (let i = 0; i < q.options.length; i++) await this.type(opts.nth(i), q.options[i]);
  }

  // ---------- Step 5: Feedback Form ----------
  get setupFormButton() { return this.page.getByRole('button', { name: 'Setup Form' }); }
  get feedbackDialog() { return this.page.getByRole('dialog'); }
  get noFeedbackWarning() { return this.page.getByText(/Some sessions don.t have a feedback form/); }

  async setupFeedbackAtSessionEnd(q: { text: string; options: string[] }) {
    await this.setupFormButton.click();
    const dlg = this.feedbackDialog;
    await expect(dlg.getByText('Setup Feedback Questions')).toBeVisible();
    await dlg.getByRole('combobox').filter({ hasText: 'Select' }).first().click();
    await this.page.getByRole('option', { name: 'At session end' }).click();
    await this.fillQuestion(dlg, q);
    await dlg.getByRole('button', { name: 'Save Form' }).click();
    await expect(dlg).toBeHidden();
  }

  // ---------- Step 6: Summary ----------
  get confirmAndSubmit() { return this.page.getByRole('button', { name: 'Confirm & Submit' }); }
}
