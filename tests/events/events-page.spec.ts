import { test, expect } from '@playwright/test';
import { EventsPage } from '../../pages/EventsPage';
import { HostEventPage, WIZARD_STEPS } from '../../pages/HostEventPage';
import { hideChatWidget, snap } from '../../utils/report';

test.describe('Events module - Events page (portal)', () => {
  let events: EventsPage;

  test.beforeEach(async ({ page }) => {
    await hideChatWidget(page);
    events = new EventsPage(page);
  });

  test('POSITIVE: sidebar "Events" opens the Events page', async ({ page }) => {
    await page.goto('./');
    await page.getByText('Events', { exact: true }).first().click();
    await expect(page).toHaveURL(/\/alumni\/event$/);
    await expect(page).toHaveTitle(/^Event( \| Kenverse)?$/);
    await snap(page, 'Events page');
  });

  test('POSITIVE: Events page shows upcoming events, registered events and event requests', async ({ page }) => {
    await events.goto();
    await expect(events.upcomingTitles.first()).toBeVisible();
    await expect(events.filtersButton).toBeVisible();
    await expect(events.search).toBeVisible();
    await expect(page.getByText('Registered events')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Upcoming', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Past events' })).toBeVisible();
    await expect(page.getByText('Your event requests')).toBeVisible();
    await expect(events.hostEventButton).toBeVisible();
    await snap(page, 'Events page sections');
  });

  test('POSITIVE: "Host an event" opens the 6-step wizard in the right order', async ({ page }) => {
    await events.goto();
    await events.hostEventButton.click();
    await expect(page).toHaveURL(/\/event\/host-event$/);
    const wizard = new HostEventPage(page);
    await wizard.expectStep(1);
    const stepper = await page.locator('main').innerText();
    const positions = WIZARD_STEPS.map(s => stepper.indexOf(s));
    expect(positions.every(p => p >= 0), `all steps shown: ${WIZARD_STEPS.join(', ')}`).toBe(true);
    expect(positions, 'steps in order').toEqual([...positions].sort((a, b) => a - b));
    await snap(page, 'Host event - step 1');
  });

  test('NEGATIVE: portal offers no direct "create / publish event" action', async ({ page }) => {
    await events.goto();
    // Alumni can only *request* an event (Host an event → Confirm & Submit → In Review).
    // Publishing happens in Salesforce after approval.
    await expect(page.getByRole('button', { name: /create event|new event|add event|publish/i })).toHaveCount(0);
    await expect(page.getByRole('link', { name: /create event|new event|add event|publish/i })).toHaveCount(0);
    await snap(page, 'No create/publish action');
  });

  test('NEGATIVE: logged-out user cannot open the Host Event wizard', async ({ browser }) => {
    const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await context.newPage();
    await page.goto(new URL('event/host-event', process.env.BASE_URL).toString());
    await expect(page).toHaveURL(/\/alumni\/login/);
    await expect(page.getByRole('textbox', { name: /^Email/ })).toBeVisible();
    await snap(page, 'Redirected to login');
    await context.close();
  });
});
