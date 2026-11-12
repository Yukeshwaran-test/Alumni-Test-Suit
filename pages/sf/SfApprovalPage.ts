import { expect, type Page } from '@playwright/test';
import { lightningUrl, pendingWorkItem } from '../../utils/salesforce';

/**
 * Approve / reject any record that's in a Salesforce approval process, from the approval
 * request page (works for a System Administrator even when they're not in the approver queue).
 */
export class SfApprovalPage {
  constructor(readonly page: Page) {}

  async decide(recordId: string, decision: 'Approve' | 'Reject', comment: string) {
    const item = await pendingWorkItem(recordId);
    if (!item) throw new Error(`No pending approval for ${recordId}`);
    await this.page.goto(`${lightningUrl()}/lightning/r/ProcessInstanceWorkitem/${item.Id}/view`);
    await this.page.getByRole('button', { name: decision, exact: true }).click();
    const dialog = this.page.getByRole('dialog');
    await dialog.getByRole('textbox').first().fill(comment);
    await dialog.getByRole('button', { name: decision, exact: true }).click();
    await expect(dialog).toBeHidden();
  }
}
