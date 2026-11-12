import { test, type Page } from '@playwright/test';

/** Attach a full-page screenshot to the HTML report under a readable name. */
export async function snap(page: Page, name: string) {
  await test.info().attach(name, {
    body: await page.screenshot({ fullPage: true }),
    contentType: 'image/png',
  });
}

/** Attach a plain-text/JSON note (e.g. created record ids, field values) to the HTML report. */
export async function note(name: string, data: unknown) {
  await test.info().attach(name, {
    body: typeof data === 'string' ? data : JSON.stringify(data, null, 2),
    contentType: typeof data === 'string' ? 'text/plain' : 'application/json',
  });
}

/**
 * The "Your Alumni Profile" wizard (4 steps, added Nov 2026) pops up over any page until the
 * profile is completed and blocks clicks. Close it whenever it appears, mid-test included.
 */
export async function closeProfileWizard(page: Page) {
  const wizard = page.locator('c-ken-profile-wizard').getByRole('dialog');
  await page.addLocatorHandler(wizard, async () => {
    await wizard.getByRole('button', { name: 'Close' }).first().click();
  });
}

/** Hide the floating "Open Alumni Chat" widget — it sits on top of the wizard's Save buttons. */
export async function hideChatWidget(page: Page) {
  await closeProfileWizard(page);
  await page.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => {
      const style = document.createElement('style');
      style.textContent = '#kai-chatbot-container { display: none !important; }';
      document.head.appendChild(style);
    });
  });
}
