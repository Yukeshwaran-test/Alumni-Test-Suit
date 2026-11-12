import { expect, type Locator, type Page } from '@playwright/test';
import { lightningUrl } from '../../utils/salesforce';

/** Salesforce Lightning record page for an Event Master (Ken_Event_Master__c). */
export class SfEventRecordPage {
  readonly approvalHistory: Locator;

  constructor(readonly page: Page) {
    this.approvalHistory = page.locator('article').filter({ hasText: 'Approval History' });
  }

  async goto(eventId: string) {
    await this.page.goto(`${lightningUrl()}/lightning/r/Ken_Event_Master__c/${eventId}/view`);
    await expect(this.page).toHaveTitle(/\| Event Master \| Salesforce$/, { timeout: 60_000 });
  }

  /** The current stage in the status path (Draft → In Review → Approved / Rejected / Cancelled). */
  currentStage(name: string): Locator {
    return this.page.locator('.slds-path__item.slds-is-current, .slds-path__item.slds-is-active').filter({ hasText: name }).first();
  }

  pendingStep(name = 'Alumni Admin Approval'): Locator {
    return this.approvalHistory.getByRole('link', { name });
  }

  /**
   * Approve from the approval request's own page. The Approval History card shows
   * "No actions available" for admins who aren't in the "Event Approvers" queue, but the
   * request page still offers Approve / Reject / Reassign to a System Administrator.
   */
  async decide(decision: 'Approve' | 'Reject', comment: string) {
    await this.pendingStep().click();
    await expect(this.page).toHaveURL(/ProcessInstanceWorkitem/);
    await this.page.getByRole('button', { name: decision, exact: true }).click();
    const dialog = this.page.getByRole('dialog');
    await dialog.getByRole('textbox').first().fill(comment);
    await dialog.getByRole('button', { name: decision, exact: true }).click();
    await expect(dialog).toBeHidden();
  }
}
