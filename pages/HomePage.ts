import { expect, type Locator, type Page } from '@playwright/test';

export const NAV_ITEMS = [
  { label: 'Events', path: '/alumni/event', title: 'Event' },
  { label: 'Jobs', path: '/alumni/job', title: 'Job' },
  { label: 'Network', path: '/alumni/network', title: 'Network' },
  { label: 'Mentorship', path: '/alumni/mentorship', title: 'Mentorship' },
  { label: 'Fundraise', path: '/alumni/fundraise', title: 'Fundraise' },
  { label: 'Groups', path: '/alumni/group', title: 'Group' },
  { label: 'Business Directory', path: '/alumni/business', title: 'Business Directory' },
] as const;

export const HOME_WIDGETS = [
  'Feed',
  'Upcoming Events',
  'Upcoming Birthdays',
  'Quick Links',
  'Resources',
  'Invite Friends',
  'Businesses by Alumni',
] as const;

export class HomePage {
  readonly logoutButton: Locator;

  constructor(readonly page: Page) {
    this.logoutButton = page.getByText('Logout', { exact: true });
  }

  async goto() {
    await this.page.goto('./');
    await this.waitForLoaded();
  }

  async waitForLoaded() {
    await expect(this.page).toHaveTitle(/^Home( \| Kenverse)?$/);
    await expect(this.navItem('Home')).toBeVisible();
  }

  // Sidebar items are plain spans (no links); the sidebar renders before page content,
  // so .first() picks the sidebar copy when a label also appears in the page body.
  navItem(label: string): Locator {
    return this.page.getByText(label, { exact: true }).first();
  }

  userName(name: string): Locator {
    return this.page.getByRole('heading', { name });
  }

  async logout() {
    await this.logoutButton.click();
  }
}
