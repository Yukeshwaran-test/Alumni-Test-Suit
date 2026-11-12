import { expect, type Locator, type Page } from '@playwright/test';

/** /alumni/group — Discover, Groups Joined, Created Groups. */
export class GroupsPage {
  readonly search: Locator;
  readonly createGroup: Locator;
  readonly noMatch: Locator;

  constructor(readonly page: Page) {
    this.search = page.getByPlaceholder('Search', { exact: true });
    this.createGroup = page.getByRole('button', { name: 'Create Group' });
    this.noMatch = page.getByText('No groups match your filters');
  }

  async goto() {
    await this.page.goto('group');
    await expect(this.page).toHaveTitle(/^Group( \| Kenverse)?$/);
    await expect(this.createGroup).toBeVisible({ timeout: 60_000 });
  }
}

/** /alumni/group/create-group — Setup Group, Target Audience, Summary. */
export class CreateGroupPage {
  readonly main: Locator;
  readonly next: Locator;
  readonly submit: Locator;

  constructor(readonly page: Page) {
    this.main = page.locator('main');
    this.next = page.getByRole('button', { name: 'Next' }).last();
    this.submit = page.getByRole('button', { name: 'Submit', exact: true });
  }

  get name() { return this.page.getByPlaceholder('Group name will be visible in the platform'); }
  get tags() { return this.page.getByPlaceholder('Add tags'); }
  get category() { return this.main.locator('select').first(); }
  editor(i: 0 | 1) { return this.main.locator('[contenteditable=true]').nth(i); } // 0 = Description, 1 = Rules
  get submitted() { return this.page.getByText('Group Submitted!'); }

  async goto() {
    await this.page.goto('group/create-group');
    await this.expectStep(1);
  }

  async expectStep(n: number) {
    await expect(this.page.getByText(`Step ${n} out of 3`)).toBeVisible({ timeout: 60_000 });
  }

  async fillSetup(g: { name: string; type: 'Public' | 'Private'; tags?: string; description?: string; rules?: string }) {
    await this.name.clear();
    await this.name.pressSequentially(g.name, { delay: 5 });
    if (g.tags) await this.tags.pressSequentially(g.tags, { delay: 5 });
    await this.main.getByText(g.type === 'Public' ? 'Public - Anyone can join' : 'Private - Users must request to join', { exact: true }).click();
    await this.category.selectOption({ label: 'Group' });
    if (g.description) { await this.editor(0).click(); await this.page.keyboard.type(g.description); }
    if (g.rules) { await this.editor(1).click(); await this.page.keyboard.type(g.rules); }
  }

  async addSavedAudience(name: string) {
    await this.page.getByPlaceholder('Search by name or ID').pressSequentially(name, { delay: 10 });
    await this.main.locator(':scope *')
      .filter({ has: this.page.getByText(name, { exact: true }) })
      .filter({ has: this.page.getByRole('button', { name: 'Review & Add' }) })
      .last().getByRole('button', { name: 'Review & Add' }).click();
    await this.page.getByRole('dialog').getByRole('button', { name: 'Add Audience' }).click();
    await expect(this.main.getByText('Selected Audience')).toBeVisible();
  }

  /** Add New Audience > Specific Individuals; `people` = [name, email] pairs. */
  async addIndividuals(people: [string, string][]) {
    await this.page.getByRole('button', { name: 'Add New Audience' }).click();
    await this.main.getByText('Specific Individuals', { exact: true }).click();
    const box = this.page.getByPlaceholder('Search by name, email, ID or phone number');
    for (const [name, email] of people) {
      await box.clear();
      await box.pressSequentially(email, { delay: 15 });
      const card = this.main.locator('article.resultCard')
        .filter({ has: this.page.getByText(name, { exact: true }) })
        .filter({ has: this.page.getByText(email, { exact: true }) });
      // The "+" is an icon-only button with no accessible name.
      await card.locator('button.selectButton').click();
      await expect(card.locator('button.selectButton')).toHaveAttribute('aria-pressed', 'true');
    }
    await expect(this.main.getByText('Individuals Added')).toBeVisible();
  }

  get saveAudienceDialog() { return this.page.getByRole('dialog').filter({ hasText: 'Save Audience' }); }
}

/** /alumni/group/group-detail?groupId=... */
export class GroupDetailPage {
  readonly tabs: Record<'About' | 'Feed' | 'Events' | 'Members', Locator>;
  readonly joinGroup: Locator;
  readonly requestToJoin: Locator;
  readonly requested: Locator;
  readonly leaveGroup: Locator;
  readonly createEvent: Locator;
  readonly inviteMembers: Locator;
  readonly pendingTab: Locator;

  constructor(readonly page: Page) {
    const tab = (n: string) => page.locator('main').getByRole('button', { name: n, exact: true });
    this.tabs = { About: tab('About'), Feed: tab('Feed'), Events: tab('Events'), Members: tab('Members') };
    this.joinGroup = page.getByRole('button', { name: 'Join Group' });
    this.requestToJoin = page.getByRole('button', { name: 'Request to Join' });
    this.requested = page.getByRole('button', { name: 'Requested to join' });
    this.leaveGroup = page.getByRole('button', { name: 'Leave Group' });
    this.createEvent = page.getByRole('button', { name: 'Create an Event' });
    this.inviteMembers = page.getByRole('button', { name: 'Invite Members' });
    this.pendingTab = page.getByRole('button', { name: 'Pending Requests' });
  }

  async goto(groupId: string) {
    await this.page.goto(`group/group-detail?groupId=${groupId}`);
    await expect(this.page.getByText('Created by:')).toBeVisible({ timeout: 60_000 });
  }

  requestRow(name: string): Locator {
    return this.page.locator('.request-row').filter({ hasText: name });
  }

  /** Accept (✓) / reject (✗) a join request — icon buttons on the request row. */
  async decideRequest(name: string, decision: 'accept' | 'reject') {
    await this.tabs.Members.click();
    await this.pendingTab.click();
    const row = this.requestRow(name);
    await expect(row).toBeVisible();
    const btn = decision === 'accept'
      ? row.getByRole('button', { name: /^(Accept|Approve)$/ })
      : row.getByRole('button', { name: /^(Reject|Decline)$/ });
    await btn.click();
    await expect(row).toHaveCount(0);
  }
}
