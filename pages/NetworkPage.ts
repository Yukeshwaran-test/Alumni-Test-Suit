import { expect, type Locator, type Page } from '@playwright/test';

/** /alumni/network — the alumni directory (All Alumni / Your Connections / Map view). */
export class NetworkPage {
  readonly allAlumniTab: Locator;
  readonly yourConnectionsTab: Locator;
  readonly mapViewTab: Locator;
  readonly search: Locator;
  readonly sortBy: Locator;
  readonly filters: Locator;
  readonly noResults: Locator;

  constructor(readonly page: Page) {
    this.allAlumniTab = page.getByRole('button', { name: 'All Alumni', exact: true });
    this.yourConnectionsTab = page.getByRole('button', { name: 'Your Connections' });
    this.mapViewTab = page.getByRole('button', { name: 'Map view' });
    this.search = page.getByPlaceholder('Search', { exact: true });
    this.sortBy = page.getByRole('button', { name: 'Sort by' });
    this.filters = page.getByRole('button', { name: 'Filters' });
    this.noResults = page.getByText('No results found');
  }

  async goto() {
    await this.page.goto('network');
    await expect(this.page).toHaveTitle(/^Network( \| Kenverse)?$/);
    await expect(this.page.locator('.alumni-card').first()).toBeVisible({ timeout: 60_000 });
  }

  card(name: string): Locator {
    return this.page.locator('.alumni-card').filter({ has: this.page.getByRole('heading', { name, exact: true }) });
  }

  /** Search box only registers real keystrokes. */
  async searchFor(text: string) {
    await this.search.clear();
    await this.search.pressSequentially(text, { delay: 15 });
  }

  /**
   * Open someone's profile from the directory. Connected people are hidden from
   * "All Alumni", so fall back to "Your Connections".
   */
  async openProfile(name: string) {
    await this.goto();
    await this.searchFor(name);
    const inAll = this.card(name).first();
    const found = await inAll.waitFor({ timeout: 10_000 }).then(() => true, () => false);
    if (!found) {
      await this.search.clear();
      await this.yourConnectionsTab.click();
    }
    await this.card(name).first().click();
    const profile = new ProfilePage(this.page);
    await profile.waitForLoaded(name);
    return profile;
  }
}

/** Another alumnus's profile: /alumni/network?profileId=<AccountId>. */
export class ProfilePage {
  readonly connectButton: Locator;
  readonly requestedButton: Locator;
  readonly messageButton: Locator;
  readonly moreOptions: Locator;
  readonly removeConnection: Locator;
  readonly confirmRemove: Locator;
  readonly cancelRemove: Locator;

  constructor(readonly page: Page) {
    this.connectButton = page.getByRole('button', { name: 'Connect +' });
    this.requestedButton = page.getByRole('button', { name: /Connection Requested/ });
    this.messageButton = page.getByRole('button', { name: 'Message', exact: true });
    this.moreOptions = page.getByRole('button', { name: 'More options' });
    this.removeConnection = page.getByText('Remove Connection', { exact: true });
    this.confirmRemove = page.getByRole('button', { name: 'Yes, Remove' });
    this.cancelRemove = page.getByRole('button', { name: 'Cancel', exact: true });
  }

  async waitForLoaded(name: string) {
    await expect(this.page).toHaveURL(/profileId=/);
    await expect(this.page.getByText(name, { exact: true }).last()).toBeVisible();
    // One of the three relationship buttons is always shown once the profile has loaded.
    await expect(this.connectButton.or(this.requestedButton).or(this.messageButton).first()).toBeVisible({ timeout: 30_000 });
  }

  async openRemoveDialog() {
    if (!(await this.removeConnection.isVisible())) await this.moreOptions.click();
    await this.removeConnection.click();
    await expect(this.page.getByText('Are you sure you want to remove this connection?')).toBeVisible();
  }
}

/** Header bell → panel with "Notifications" and "Connection Requests" tabs. */
export class NotificationsPanel {
  readonly bell: Locator;
  readonly notificationsTab: Locator;
  readonly connectionRequestsTab: Locator;
  readonly caughtUp: Locator;

  constructor(readonly page: Page) {
    this.bell = page.getByRole('button', { name: 'Notifications', exact: true });
    this.notificationsTab = page.getByRole('tab', { name: 'Notifications' });
    this.connectionRequestsTab = page.getByRole('tab', { name: 'Connection Requests' });
    this.caughtUp = page.getByText(/all caught up/i);
  }

  /** Reload Home (so the panel shows fresh data) and open the bell panel. */
  async open() {
    await this.page.goto('./');
    await expect(this.bell).toBeVisible({ timeout: 60_000 });
    await this.bell.click();
    await expect(this.connectionRequestsTab).toBeVisible();
  }

  /** Open the "Connection Requests" tab and wait until it has finished loading. */
  async openConnectionRequests() {
    await this.open();
    await this.connectionRequestsTab.click();
    await expect(this.page.locator('.row--request').first().or(this.caughtUp)).toBeVisible();
  }

  requestFrom(name: string): Locator {
    return this.page.locator('.row--request').filter({ hasText: name });
  }

  recentNotification(text: string | RegExp): Locator {
    return this.page.getByText(text);
  }

  /** Count notifications with this text once the "Recent" list has finished loading (count is stable). */
  async countOf(text: string) {
    await expect(this.page.getByText('Recent', { exact: true })).toBeVisible();
    let last = -1;
    await expect(async () => {
      const n = await this.recentNotification(text).count();
      const stable = n === last;
      last = n;
      expect(stable).toBe(true);
    }).toPass({ intervals: [1000], timeout: 20_000 });
    return last;
  }
}

/** /alumni/chat */
export class ChatPage {
  readonly search: Locator;
  readonly input: Locator;
  readonly sendButton: Locator;

  constructor(readonly page: Page) {
    this.search = page.getByPlaceholder('Search conversations');
    this.input = page.getByPlaceholder('Type a message');
    this.sendButton = page.getByRole('button', { name: 'Send message' });
  }

  async goto() {
    await this.page.goto('chat');
    await expect(this.page).toHaveURL(/\/alumni\/chat/);
    await expect(this.page.getByRole('button', { name: 'Individuals' })).toBeVisible({ timeout: 60_000 });
  }

  conversation(name: string): Locator {
    return this.page.locator('.chat-card').filter({ has: this.page.getByText(name, { exact: true }) });
  }

  async open(name: string) {
    await this.conversation(name).first().click();
    await expect(this.page.getByRole('heading', { name, exact: true })).toBeVisible();
    await expect(this.input).toBeVisible();
  }

  message(text: string): Locator {
    return this.page.getByText(text, { exact: true });
  }

  async send(text: string) {
    await this.input.click();
    await this.input.pressSequentially(text, { delay: 15 });
    await expect(this.sendButton).toBeEnabled();
    await this.sendButton.click();
    await expect(this.message(text).last()).toBeVisible();
    await expect(this.input).toHaveValue('');
  }
}
