import { expect, type Locator, type Page } from '@playwright/test';

export class EventsPage {
  readonly upcomingSection: Locator;
  readonly upcomingTitles: Locator;
  readonly requestsSection: Locator;
  readonly hostEventButton: Locator;
  readonly filtersButton: Locator;
  readonly search: Locator;

  constructor(readonly page: Page) {
    this.upcomingSection = page.locator('.upcoming-events-section');
    this.upcomingTitles = this.upcomingSection.locator('.event-card .event-title');
    this.requestsSection = page.locator('.event-requests-container');
    this.hostEventButton = page.getByRole('button', { name: 'Host an event' });
    this.filtersButton = page.getByRole('button', { name: 'Filters' });
    this.search = page.getByPlaceholder('Search');
  }

  async goto() {
    await this.page.goto('event');
    await expect(this.page).toHaveTitle(/^Event( \| Kenverse)?$/);
    await expect(this.page.getByText(/^Upcoming events \(\d+\)$/).first()).toBeVisible();
    await expect(this.upcomingTitles.first()).toBeVisible();
  }

  /** The row for an event in the "Your event requests" widget. */
  request(title: string): Locator {
    return this.requestsSection.locator('.event-card').filter({ has: this.page.getByText(title, { exact: true }) });
  }

  upcomingCard(title: string): Locator {
    return this.upcomingSection.locator('.event-card').filter({ has: this.page.getByText(title, { exact: true }) });
  }
}

export class HostedEventsPage {
  constructor(readonly page: Page) {}

  async goto() {
    await this.page.goto('event/hosted-events');
    await expect(this.page).toHaveURL(/\/event\/hosted-events/);
    await expect(this.tab('In Review')).toBeVisible();
  }

  tab(name: 'In Review' | 'Approved' | 'Rejected' | 'Drafts'): Locator {
    return this.page.locator('main').getByText(name, { exact: true }).first();
  }

  card(title: string): Locator {
    return this.page.locator('main').getByText(title, { exact: true });
  }
}
