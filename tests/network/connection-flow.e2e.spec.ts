import type { Page } from '@playwright/test';
import { test, expect, SENDER, RECEIVER } from './fixtures';
import { ChatPage, NetworkPage, NotificationsPanel, ProfilePage } from '../../pages/NetworkPage';
import { note, snap } from '../../utils/report';
import {
  alumnusByEmail, chatMessagesSince, connectionBetween, connectionNotificationsSince, hasSfSession, sfNow,
  type NetworkConnection,
} from '../../utils/salesforce';

/**
 * Network module end-to-end: SENDER sends a connection request to RECEIVER, then
 *   reject path  -> Decline      -> SF Status Requested -> Rejected
 *   accept path  -> Accept       -> SF Status Requested -> Accepted -> chat both ways
 * Tests run in order; each one builds on the previous state.
 */
test.describe.configure({ mode: 'serial' });

const ACCEPT_BUG =
  'KNOWN BUG (2026-09-30): Accept fails for every portal user - Apex System.DmlException ' +
  '"fields being inaccessible on Sobject Ken_Notification__c" in KenNotificationFactory.create:149 ' +
  '(KenNetworkController.createConnectionAcceptedNotifications). The UI shows no error; status stays Requested.';
const NOTIFICATION_BUG =
  'KNOWN BUG (2026-09-30): no Ken_Notification__c record is created when a connection request is sent.';

let sf: null | { sender: { AccountId: string; ContactId: string }; receiver: { AccountId: string; ContactId: string } } = null;
const statusHistory: { step: string; status: string | undefined; at: string }[] = [];
let lastRequestAt = '';
let acceptedAt = '';
let acceptedNoticesBefore = 0;
const acceptedNotice = () => `${RECEIVER.name} accepted your connection request`;

async function sfConnection(step: string): Promise<NetworkConnection | undefined> {
  if (!sf) return undefined;
  const c = await connectionBetween(sf.sender.AccountId, sf.receiver.AccountId);
  statusHistory.push({ step, status: c?.Status__c, at: new Date().toISOString() });
  await note(`SF connection after: ${step}`, c ?? 'no record');
  return c;
}

async function openReceiverProfile(page: Page): Promise<ProfilePage> {
  return new NetworkPage(page).openProfile(RECEIVER.name);
}

async function declineIfPending(page: Page, fromName: string) {
  const panel = new NotificationsPanel(page);
  await panel.openConnectionRequests();
  const row = panel.requestFrom(fromName);
  if (await row.count()) {
    await row.first().getByRole('button', { name: 'Decline' }).click();
    await expect(row).toHaveCount(0);
  }
}

async function sendRequest(page: Page) {
  const profile = await openReceiverProfile(page);
  await expect(profile.connectButton).toBeVisible();
  lastRequestAt = sfNow();
  await profile.connectButton.click();
  await expect(profile.requestedButton).toBeVisible();
  return profile;
}

test.describe(`Network module - connection request ${SENDER.name} -> ${RECEIVER.name}`, () => {
  test.beforeAll(async () => {
    if (await hasSfSession()) {
      sf = { sender: await alumnusByEmail(SENDER.email), receiver: await alumnusByEmail(RECEIVER.email) };
    }
  });

  test.afterAll(async () => {
    if (statusHistory.length) console.log('SF Connection Status history:', statusHistory.map(s => `${s.step}=${s.status}`).join(' | '));
  });

  test('Setup: the two users start NOT connected', async ({ page, receiver }) => {
    await test.step('Clear any pending request in either direction', async () => {
      await declineIfPending(receiver, SENDER.name);
      await declineIfPending(page, RECEIVER.name);
    });
    await test.step('Remove an existing connection', async () => {
      const profile = await openReceiverProfile(page);
      if (await profile.messageButton.isVisible()) {
        await profile.openRemoveDialog();
        await profile.confirmRemove.click();
        await expect(page.getByText('Connection Removed').first()).toBeVisible();
      }
      await expect(profile.connectButton).toBeVisible();
      await snap(page, 'Start - not connected (Connect + shown)');
    });
    const c = await sfConnection('setup');
    if (c) expect(['Rejected', 'Cancelled']).toContain(c.Status__c);
  });

  test('POSITIVE: send a connection request (and NEGATIVE: cannot send it twice)', async ({ page }) => {
    const profile = await sendRequest(page);
    await expect(profile.requestedButton).toHaveText(/Connection Requested/);
    await expect(profile.requestedButton, 'duplicate request blocked').toBeDisabled();
    await expect(profile.connectButton).toHaveCount(0);
    await expect(profile.messageButton, 'no chat before acceptance').toHaveCount(0);
    await snap(page, 'Sender - Connection Requested');

    const c = await sfConnection('request sent (reject path)');
    if (sf) {
      expect(c?.Status__c).toBe('Requested');
      expect(c?.Initiator__c).toBe(sf.sender.AccountId);
      expect(c?.Recipient__c).toBe(sf.receiver.AccountId);
    }
  });

  test('POSITIVE: receiver sees the request in Notifications > Connection Requests', async ({ receiver }) => {
    const panel = new NotificationsPanel(receiver);
    await panel.openConnectionRequests();
    const row = panel.requestFrom(SENDER.name);
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('has requested to connect.');
    await expect(row.getByRole('button', { name: 'Accept' })).toBeVisible();
    await expect(row.getByRole('button', { name: 'Decline' })).toBeVisible();
    await snap(receiver, 'Receiver - connection request with Accept / Decline');
  });

  test('SF: a notification record is created for the connection request', async () => {
    test.skip(!sf, 'Salesforce session missing - run: npm run sf:login');
    test.fail(true, NOTIFICATION_BUG);
    const rows = await connectionNotificationsSince(lastRequestAt);
    await note('Ken_Notification__c since request', rows);
    expect(rows.length).toBeGreaterThan(0);
  });

  test('REJECT: receiver declines -> request removed, SF status Rejected', async ({ page, receiver }) => {
    await test.step('Receiver clicks Decline', async () => {
      const panel = new NotificationsPanel(receiver);
      await panel.openConnectionRequests();
      await panel.requestFrom(SENDER.name).getByRole('button', { name: 'Decline' }).click();
      await expect(panel.requestFrom(SENDER.name)).toHaveCount(0);
      await snap(receiver, 'Receiver - after Decline');
    });
    await test.step('Salesforce: Requested -> Rejected', async () => {
      const c = await sfConnection('declined');
      if (sf) {
        expect(c?.Status__c).toBe('Rejected');
        expect(c?.Accepted_Date__c).toBeNull();
      }
    });
    await test.step('Sender: not connected, can send a new request', async () => {
      const profile = await openReceiverProfile(page);
      await expect(profile.connectButton).toBeVisible();
      await expect(profile.messageButton).toHaveCount(0);
      await snap(page, 'Sender - after being declined (Connect + again)');
    });
    await test.step('Receiver: sender is not in Your Connections', async () => {
      const network = new NetworkPage(receiver);
      await network.goto();
      await network.yourConnectionsTab.click();
      await expect(network.card(SENDER.name)).toHaveCount(0);
    });
  });

  test('ACCEPT: receiver accepts -> both users connected', async ({ page, receiver }) => {
    test.fail(true, ACCEPT_BUG);
    await test.step('Sender: count existing "accepted" notifications (older ones may exist)', async () => {
      const panel = new NotificationsPanel(page);
      await panel.open();
      acceptedNoticesBefore = await panel.countOf(acceptedNotice());
      await note('Accepted notifications before', acceptedNoticesBefore);
    });
    await test.step('Sender sends a new request', async () => {
      await sendRequest(page);
      const c = await sfConnection('request sent (accept path)');
      if (sf) expect(c?.Status__c).toBe('Requested');
    });
    await test.step('Receiver clicks Accept', async () => {
      acceptedAt = sfNow();
      const panel = new NotificationsPanel(receiver);
      await panel.openConnectionRequests();
      await panel.requestFrom(SENDER.name).getByRole('button', { name: 'Accept' }).click();
      await snap(receiver, 'Receiver - after Accept');
      await expect(panel.requestFrom(SENDER.name)).toHaveCount(0);
    });
    await test.step('Sender now sees "Message" on the profile and the receiver in Your Connections', async () => {
      const profile = await openReceiverProfile(page);
      await expect(profile.messageButton).toBeVisible();
      await expect(profile.connectButton).toHaveCount(0);
      await snap(page, 'Sender - connected (Message shown)');
      const network = new NetworkPage(page);
      await network.goto();
      await network.yourConnectionsTab.click();
      await expect(network.card(RECEIVER.name)).toHaveCount(1);
    });
  });

  test('SF: Connection Status changes from Requested to Accepted', async () => {
    test.skip(!sf, 'Salesforce session missing - run: npm run sf:login');
    test.fail(true, ACCEPT_BUG);
    const c = await sfConnection('accepted');
    await note('SF Connection Status history', statusHistory);
    const acceptPath = statusHistory.slice(statusHistory.findIndex(s => s.step === 'request sent (accept path)'));
    expect(acceptPath[0]?.status, 'before accept').toBe('Requested');
    expect(c?.Status__c, 'after accept').toBe('Accepted');
    expect(c?.Accepted_Date__c, 'Accepted Date filled in').not.toBeNull();
  });

  test('POSITIVE: sender gets a NEW "accepted your connection request" notification', async ({ page }) => {
    test.fail(true, ACCEPT_BUG);
    const panel = new NotificationsPanel(page);
    await panel.open();
    await snap(page, 'Sender - notifications after accept');
    expect(await panel.countOf(acceptedNotice()), 'one more than before accepting').toBe(acceptedNoticesBefore + 1);
    if (sf) {
      const rows = (await connectionNotificationsSince(acceptedAt)).filter((n: any) => /accept/i.test(`${n.Title__c} ${n.Type__c}`));
      await note('Ken_Notification__c (accepted) since accept', rows);
      expect(rows.length).toBeGreaterThan(0);
    }
  });

  test('CHAT: connected users can message each other', async ({ page, receiver }) => {
    const profile = await openReceiverProfile(page);
    test.skip(!(await profile.messageButton.isVisible()), `Not connected - blocked by: ${ACCEPT_BUG}`);
    const since = sfNow();
    const hello = `QA hello ${Date.now()}`;
    const reply = `QA reply ${Date.now()}`;

    await test.step('Sender opens the chat from the profile "Message" button', async () => {
      await profile.messageButton.click();
      await expect(page).toHaveURL(/\/alumni\/chat/);
    });
    const senderChat = new ChatPage(page);
    await test.step('NEGATIVE: Send is disabled for an empty / blank message', async () => {
      await expect(senderChat.sendButton).toBeDisabled();
      await senderChat.input.pressSequentially('   ');
      await expect(senderChat.sendButton).toBeDisabled();
      await senderChat.input.clear();
    });
    await test.step('Sender sends a message', async () => {
      await senderChat.send(hello);
      await snap(page, 'Sender - message sent');
    });
    await test.step('Receiver sees it and replies', async () => {
      const chat = new ChatPage(receiver);
      await chat.goto();
      await chat.open(SENDER.name);
      await expect(chat.message(hello)).toBeVisible();
      await chat.send(reply);
      await snap(receiver, 'Receiver - message received and reply sent');
    });
    await test.step('Sender sees the reply', async () => {
      await senderChat.goto();
      await senderChat.open(RECEIVER.name);
      await expect(senderChat.message(reply)).toBeVisible();
      await snap(page, 'Sender - reply received');
    });
    await test.step('Salesforce: chat messages saved', async () => {
      test.skip(!sf, 'Salesforce session missing');
      const sent = await chatMessagesSince(sf!.sender.ContactId, since);
      const received = await chatMessagesSince(sf!.receiver.ContactId, since);
      await note('Ken_Chat_Message__c', { sent, received });
      expect(sent.length).toBeGreaterThan(0);
      expect(received.length).toBeGreaterThan(0);
      expect(received[0].Thread__c).toBe(sent[0].Thread__c);
    });
  });

  test('NEGATIVE: cancelling "Remove Connection" keeps the connection', async ({ page }) => {
    const profile = await openReceiverProfile(page);
    test.skip(!(await profile.messageButton.isVisible()), `Not connected - blocked by: ${ACCEPT_BUG}`);
    await profile.openRemoveDialog();
    await snap(page, 'Remove connection - confirm dialog');
    await profile.cancelRemove.click();
    await expect(profile.messageButton).toBeVisible();
    await expect(profile.connectButton).toHaveCount(0);
    const c = await sfConnection('remove cancelled');
    if (sf) expect(c?.Status__c).toBe('Accepted');
  });
});
