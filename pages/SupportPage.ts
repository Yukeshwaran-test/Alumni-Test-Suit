import { expect, type Locator, type Page } from '@playwright/test';

/** /alumni/service-support — FAQs, Request for a Service, Need Help? (Get Help dialog), request history. */
export class SupportPage {
  readonly needHelp: Locator;
  readonly requestService: Locator;
  readonly serviceRequestsTab: Locator;
  readonly supportTicketsTab: Locator;
  readonly getHelpTitle: Locator;

  constructor(readonly page: Page) {
    this.needHelp = page.getByRole('button', { name: 'Need Help?' });
    this.requestService = page.getByRole('button', { name: 'Request for a Service' });
    this.serviceRequestsTab = page.getByRole('button', { name: 'Service Requests' });
    this.supportTicketsTab = page.getByRole('button', { name: 'Support Tickets' });
    this.getHelpTitle = page.getByText('Get Help', { exact: true });
  }

  /** Records every portal Apex call (method + status + error body) so failures can be explained in the report. */
  watchApex() {
    const calls: { method: string; status: number; error?: string }[] = [];
    this.page.on('response', async r => {
      if (!/apex\/execute/.test(r.url())) return;
      const method = /"method":"(\w+)"/.exec(r.request().postData() ?? '')?.[1] ?? '?';
      let error: string | undefined;
      if (r.status() >= 400) error = (await r.text().catch(() => '')).slice(0, 200);
      calls.push({ method, status: r.status(), error });
    });
    return calls;
  }

  async openRequestForService() {
    await this.requestService.click();
    await expect(this.page).toHaveURL(/service-support\/request-service/);
    await expect(this.page.getByText('Request for a Service').first()).toBeVisible();
  }

  async goto() {
    await this.page.goto('service-support');
    await expect(this.page).toHaveTitle(/^Service Support( \| Kenverse)?$/);
    await expect(this.needHelp).toBeVisible({ timeout: 60_000 });
  }

  // ----- Get Help dialog -----
  get issueType() { return this.page.locator('main select').last(); }
  get subject() { return this.page.getByPlaceholder('Enter issue subject'); }
  get description() { return this.page.getByPlaceholder('Enter description'); }
  get document() { return this.page.locator('main input[type=file]'); }
  get submit() { return this.page.getByRole('button', { name: 'Submit', exact: true }).last(); }
  get cancel() { return this.page.getByRole('button', { name: 'Cancel', exact: true }).last(); }

  async openNeedHelp() {
    await this.needHelp.click();
    await expect(this.getHelpTitle).toBeVisible();
  }

  async fill(c: { type: string; subject: string; description: string; document?: string }) {
    await this.issueType.selectOption({ label: c.type });
    await this.subject.pressSequentially(c.subject, { delay: 5 });
    await this.description.pressSequentially(c.description, { delay: 3 });
    if (c.document) await this.document.setInputFiles(c.document);
  }
}
