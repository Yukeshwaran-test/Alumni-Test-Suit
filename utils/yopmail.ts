import { expect, type BrowserContext, type FrameLocator, type Page } from '@playwright/test';

/**
 * Reads mail from a public YOPmail inbox in its own tab.
 * Inbox list lives in iframe#ifinbox (one `.m` per mail, newest first), the open mail in iframe#ifmail.
 *
 * YOPmail shows a "confirm you're human" check when it is polled too aggressively. This helper
 * polls gently with YOPmail's own Refresh button, and if the check still appears it never tries to
 * get past it: in a visible browser it waits for a person to complete it, otherwise it fails clearly.
 */
const HUMAN_CHECK = /confirm you.re human|captcha|not a robot/i;
const SHOW_BROWSER = !process.env.CI && !process.env.HEADLESS;

export class YopMail {
  private constructor(readonly page: Page, readonly inbox: string) {}

  static async open(context: BrowserContext, email: string) {
    const page = await context.newPage();
    const y = new YopMail(page, email.split('@')[0]);
    await page.goto(`https://yopmail.com/en/?login=${encodeURIComponent(y.inbox)}`, { waitUntil: 'load' });
    await y.settle(page.frameLocator('#ifinbox'));
    return y;
  }

  private async settle(frame: FrameLocator) {
    await frame.locator('body > *').first().waitFor({ timeout: 20_000 }).catch(() => {});
    await this.page.waitForTimeout(1500);
  }

  /** Click YOPmail's Refresh button (gentler than reloading the page). */
  async refresh() {
    const btn = this.page.locator('#refresh');
    if (await btn.isVisible().catch(() => false)) await btn.click();
    else await this.page.reload({ waitUntil: 'load' });
    await this.settle(this.page.frameLocator('#ifinbox'));
  }

  /** Subjects in the inbox, newest first. */
  async subjects() {
    return (await this.page.frameLocator('#ifinbox').locator('.m .lms').allInnerTexts().catch(() => [])).map(s => s.trim());
  }

  /** Count of mails whose subject matches (take it before an action, then wait for a newer one). */
  async count(subject: RegExp) {
    return (await this.subjects()).filter(s => subject.test(s)).length;
  }

  /** If YOPmail asks for a human check, wait for a person to do it (visible browser only). */
  private async waitForHumanIfAsked(frame: FrameLocator) {
    const body = () => frame.locator('body').innerText().catch(() => '');
    if (!HUMAN_CHECK.test(await body())) return;
    if (!SHOW_BROWSER) {
      throw new Error('YOPmail is asking for a human check. Re-run headed (npm run test:registration:headed) and complete it in the window.');
    }
    console.log('\n>>> YOPmail is asking "confirm you\'re human". Please complete it in the Chrome window (waiting up to 3 min)...\n');
    await this.page.bringToFront();
    const deadline = Date.now() + 180_000;
    while (HUMAN_CHECK.test(await body())) {
      if (Date.now() > deadline) throw new Error('YOPmail human check was not completed within 3 minutes.');
      await this.page.waitForTimeout(2000);
    }
  }

  /**
   * Poll the inbox for a mail whose subject matches, open the newest one and return its text + links.
   * `newerThanCount` = matching mails already there before the action (so we wait for a NEW one).
   */
  async waitForMail(subject: RegExp, { timeoutMs = 120_000, newerThanCount = 0, pollMs = 6000 } = {}) {
    const deadline = Date.now() + timeoutMs;
    const started = Date.now();
    while ((await this.count(subject)) <= newerThanCount) {
      if (Date.now() > deadline) {
        throw new Error(`No mail matching ${subject} in ${this.inbox}@yopmail.com within ${timeoutMs / 1000}s. Inbox: ${JSON.stringify(await this.subjects())}`);
      }
      await this.page.waitForTimeout(pollMs);
      await this.refresh();
    }
    const deliveredAfterMs = Date.now() - started;
    await this.page.frameLocator('#ifinbox').locator('.m').filter({ hasText: subject }).first().locator('button.lm').click();
    const mail = this.page.frameLocator('#ifmail');
    await this.settle(mail);
    await this.waitForHumanIfAsked(mail);
    await expect(mail.locator('body')).toContainText(/\S/, { timeout: 20_000 });
    const text = await mail.locator('body').innerText();
    const links = await mail.locator('a[href]').evaluateAll(as =>
      as.map(a => ({ text: (a.textContent ?? '').trim(), href: (a as HTMLAnchorElement).href })));
    return { text, links, deliveredAfterMs };
  }

  /** The `digits`-digit code that follows "OTP" / "code" in a mail body. */
  static otpFrom(text: string, digits = 4) {
    const m = text.match(new RegExp(`(?:OTP|code)\\s*[:\\-]?\\s*(\\d{${digits}})\\b`, 'i'));
    if (!m) throw new Error(`No ${digits}-digit OTP in mail:\n${text.slice(0, 800)}`);
    return m[1];
  }
}
