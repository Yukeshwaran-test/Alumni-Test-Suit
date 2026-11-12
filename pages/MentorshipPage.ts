import { expect, type Locator, type Page } from '@playwright/test';

/**
 * /alumni/mentorship
 * A mentorship needs an ACCEPTED network connection, and the other person must have
 * Settings > Mentorship > "Be a Mentor" switched on. The request is then sent from their
 * profile's "More options" menu (the menu shows "Remove Mentorship" once one exists).
 */
export class MentorshipPage {
  readonly scheduleCall: Locator;
  readonly addTask: Locator;
  readonly editPreferences: Locator;
  readonly findMentors: Locator;
  readonly becomeMentor: Locator;
  readonly emptyState: Locator;
  readonly dialog: Locator;

  constructor(readonly page: Page) {
    this.scheduleCall = page.getByRole('button', { name: 'Schedule a Call' });
    this.addTask = page.getByRole('button', { name: 'Add a Task' });
    this.editPreferences = page.getByRole('button', { name: 'Edit Mentorship Preferences' });
    this.findMentors = page.getByRole('button', { name: 'Find Mentors' });
    this.becomeMentor = page.getByRole('button', { name: 'Become a Mentor' });
    this.emptyState = page.getByRole('heading', { name: 'No Mentorship Connections Yet' });
    // The Add Task / Schedule a Call panels are headed sections inside <main>, not role=dialog.
    this.dialog = page.locator('main');
  }

  async goto() {
    await this.page.goto('mentorship');
    await expect(this.page).toHaveTitle(/^Mentorship( \| Kenverse)?$/);
    await expect(this.addTask.or(this.emptyState)).toBeVisible({ timeout: 60_000 });
  }

  connection(name: string): Locator {
    return this.page.getByRole('heading', { name, exact: true });
  }

  // ----- Add Task -----
  get taskTitle() { return this.page.getByPlaceholder('Enter title'); }
  assignTo(who: 'Mentor' | 'Mentee') { return this.page.getByLabel(who, { exact: true }); }
  get taskStatus() { return this.page.getByRole('combobox').filter({ hasText: 'Select status' }); }
  get taskPriority() { return this.page.getByRole('combobox').filter({ hasText: 'Select priority' }); }
  get saveTask() { return this.page.getByRole('button', { name: 'Save', exact: true }); }

  // ----- Schedule a Call -----
  get scheduleFor() { return this.page.getByRole('combobox').first(); }
  get callTitle() { return this.page.getByPlaceholder('Enter title'); }
  get startTime() { return this.page.getByRole('combobox').filter({ hasText: 'Start time' }); }
  get endTime() { return this.page.getByRole('combobox').filter({ hasText: 'End time' }); }
  get meetLink() { return this.page.getByPlaceholder('Enter meet link'); }
  get sendRequest() { return this.page.getByRole('button', { name: 'Send Request' }); }

  async pickOption(combo: Locator, option: string | RegExp) {
    await combo.click();
    await this.page.getByRole('option', { name: option }).first().click();
  }
}
