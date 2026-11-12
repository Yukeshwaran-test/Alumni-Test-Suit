import { expect, type Locator, type Page } from '@playwright/test';

/** Portal: /alumni/survey (list) and /alumni/survey/survey-form?surveyId=... */
export class SurveyPage {
  readonly introDialog: Locator;
  readonly submit: Locator;
  readonly cancel: Locator;
  readonly confirmYes: Locator;
  readonly reviewForm: Locator;

  constructor(readonly page: Page) {
    // "Your Opinion Matters!" intro pop-up (not a role=dialog).
    this.introDialog = page.locator('.begin-survey-dialog');
    this.submit = page.getByRole('button', { name: 'Submit', exact: true });
    this.cancel = page.getByRole('button', { name: 'Cancel', exact: true });
    this.confirmYes = page.getByRole('button', { name: 'Yes', exact: true });
    this.reviewForm = page.getByRole('button', { name: 'Review Form' });
  }

  async goto() {
    await this.page.goto('survey');
    await expect(this.page.getByText('All Surveys & Feedback')).toBeVisible({ timeout: 60_000 });
  }

  card(title: string): Locator {
    return this.page.locator('main').locator(':scope *')
      .filter({ has: this.page.getByRole('heading', { name: title, exact: true }) })
      .filter({ has: this.page.getByRole('button') })
      .last();
  }

  async start(title: string) {
    await this.card(title).getByRole('button', { name: 'Get Started' }).click();
    await expect(this.introDialog.getByText('Your Opinion Matters!')).toBeVisible();
    await this.introDialog.getByRole('button', { name: 'Get Started' }).click();
    await expect(this.page).toHaveURL(/survey\/survey-form\?surveyId=/);
  }

  progress(): Locator {
    return this.page.getByText(/\d+ of \d+ questions completed/);
  }

  /** Radios are visually hidden; click the option text. */
  async choose(option: string) {
    await this.page.locator('main').getByText(option, { exact: true }).click();
    await expect(this.page.getByLabel(option, { exact: true })).toBeChecked();
  }

  get textAnswer() { return this.page.getByPlaceholder('Enter your response'); }
}
