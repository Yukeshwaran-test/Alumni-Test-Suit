import { test as base, type Page } from '@playwright/test';
import { RECEIVER_AUTH_FILE, VIEWPORT } from '../../playwright.config';
import { hideChatWidget } from '../../utils/report';

export const SENDER = { name: process.env.NET_SENDER_NAME!, email: process.env.ALUMNI_USER! };
export const RECEIVER = { name: process.env.NET_RECEIVER_NAME!, email: process.env.NET_RECEIVER_USER! };

/**
 * `page`     = sender (ALUMNI_USER), from the project's storageState.
 * `receiver` = second Chrome window logged in as NET_RECEIVER_USER.
 * Both windows record a video + trace into the HTML report.
 * Note: the receiver's actions show up in the trace but not as report steps, so tests wrap them in test.step().
 */
export const test = base.extend<{ receiver: Page }>({
  page: async ({ page }, use) => {
    await hideChatWidget(page);
    await use(page);
  },
  receiver: async ({ browser }, use, testInfo) => {
    const context = await browser.newContext({
      storageState: RECEIVER_AUTH_FILE,
      baseURL: process.env.BASE_URL,
      viewport: VIEWPORT,
      recordVideo: { dir: testInfo.outputPath('receiver-video'), size: VIEWPORT },
    });
    // Playwright records this context's trace automatically (trace: 'on'); it's merged into the report.
    const page = await context.newPage();
    await hideChatWidget(page);

    await use(page);

    const video = page.video();
    await context.close();
    if (video) await testInfo.attach(`receiver video (${RECEIVER.name})`, { path: await video.path(), contentType: 'video/webm' });
  },
});

export { expect } from '@playwright/test';
