import { test, expect } from '../../network/fixtures';
import { CreateGroupPage } from '../../../pages/GroupsPage';
import { snap } from '../../../utils/report';
import { expectEditorCap, expectMaxLength, expectUploadRejected, FILES, INPUTS, knownBug, SF_LIMITS, watchDialogs } from '../../../utils/validation';

/** Groups > Create Group input validation. Nothing is saved before the step-3 Submit, which these tests never click. */
test.describe('Validation - Groups (Create Group)', () => {
  let c: CreateGroupPage;
  test.beforeEach(async ({ page }) => {
    c = new CreateGroupPage(page);
    await c.goto();
  });

  test('Name 50 / Tags 100 / Description 1000 / Rules 1000 characters are enforced', async ({ page }) => {
    await expectMaxLength(c.name, 50, 'Group name');
    expect(50).toBeLessThanOrEqual(SF_LIMITS.groupName);
    await expectMaxLength(c.tags, 100, 'Tags');
    await expectEditorCap(page, c.editor(0), 1000, 'Group description');
    await expectEditorCap(page, c.editor(1), 1000, 'Rules');
    await snap(page, 'Group length limits');
  });

  test('Spaces-only group name is rejected', async ({ page }) => {
    await c.name.pressSequentially(INPUTS.spaces);
    await c.next.click();
    await expect(page.getByText('Group name is required.')).toBeVisible();
    await c.expectStep(1);
  });

  test('Script tags in name, tags and description are shown as plain text', async ({ page }) => {
    const dialogs = watchDialogs(page);
    await c.fillSetup({ name: INPUTS.script.slice(0, 50), type: 'Public', tags: INPUTS.imgOnError, description: INPUTS.script });
    await c.next.click();
    await c.expectStep(2);
    await c.addSavedAudience('all audience');
    await c.next.click();
    await c.expectStep(3);
    // Summary must display the raw text, not execute or swallow it. Submit is NOT clicked.
    // The same text is used for name and description, so it appears twice on the summary.
    await expect(c.main.getByText(INPUTS.script, { exact: true }).first()).toBeVisible();
    expect(await c.main.getByText(INPUTS.script, { exact: true }).count(), 'name + description shown literally').toBeGreaterThanOrEqual(2);
    await expect(c.main.getByText(INPUTS.imgOnError).first(), 'tags shown literally').toBeVisible();
    await snap(page, 'Script text shown literally in summary');
    expect(dialogs, 'no injected script ran').toEqual([]);
  });

  test('Cover photo: over 5 MB and non-image files are rejected with a message', async ({ page }) => {
    knownBug('Cover over 5 MB and .txt files are silently ignored - nothing tells the user why the photo was not added.');
    await expectUploadRejected(page, c.main.locator('input[type=file]').first(), FILES.png6mb, 'Cover 6 MB');
    await expectUploadRejected(page, c.main.locator('input[type=file]').first(), FILES.notAnImage, 'Cover .txt');
    await snap(page, 'Group cover validation');
  });
});
