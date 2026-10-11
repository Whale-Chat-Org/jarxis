import { expect, test, type Page } from '@playwright/test';

const viewports = [
  { width: 375, height: 667 },
  { width: 440, height: 956 },
  { width: 768, height: 1024 },
  { width: 960, height: 1440 },
  { width: 1280, height: 800 },
  { width: 1440, height: 900 },
  { width: 767, height: 1024 },
  { width: 769, height: 1024 },
];
test.beforeEach(async ({ page }) => {
  // Isolate the inherited auth provider, too; these tests never contact backend endpoints.
  await page.route('**/api/**', async (route) => {
    expect(route.request().url()).toContain('/api/auth/get-session');
    await route.fulfill({ json: null });
  });
});
async function openHistory(page: Page) {
  if ((page.viewportSize()?.width ?? 1280) < 768)
    await page.getByRole('button', { name: 'Toggle Sidebar' }).click();
}
async function assertLayout(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  const box = await page.getByRole('textbox', { name: 'Message', exact: true }).boundingBox();
  expect(box).not.toBeNull();
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
  await expect(page.getByRole('button', { name: 'Select model' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Select model' })).not.toHaveText('');
}
for (const theme of ['light', 'dark']) {
  for (const viewport of viewports) {
    test(`${theme} ${viewport.width}×${viewport.height}: empty, conversation, model menu`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize(viewport);
      await page.addInitScript((theme) => localStorage.setItem('theme', theme), theme);
      await page.goto('/chat');
      await expect(page.getByRole('heading', { name: 'What’s on your mind?' })).toBeVisible();
      await expect(page.locator('html')).toHaveClass(theme === 'dark' ? /dark/ : /light/);
      await assertLayout(page);
      await page.screenshot({ path: testInfo.outputPath('empty.png') });
      await openHistory(page);
      await page.getByRole('button', { name: 'A more focused week', exact: true }).click();
      await expect(page.getByRole('region', { name: 'Conversation messages' })).toBeVisible();
      await assertLayout(page);
      await page.screenshot({ path: testInfo.outputPath('conversation.png') });
      const region = page.getByRole('region', { name: 'Conversation messages' });
      const overflows = await region.evaluate(
        (element) => element.scrollHeight > element.clientHeight + 64,
      );
      if (overflows) {
        await region.hover();
        await page.mouse.wheel(0, -10000);
        await expect(page.getByRole('button', { name: 'Scroll to end' })).toHaveAttribute(
          'data-active',
          'true',
        );
        await page.getByRole('button', { name: 'Scroll to end' }).click();
      }
      await page.getByRole('button', { name: 'Select model' }).click();
      await expect(page.getByRole('menuitem').filter({ hasText: 'Local model' })).toBeVisible();
      await page.getByRole('menuitem').filter({ hasText: 'Local model' }).click();
      await expect(page.getByRole('button', { name: 'Select model' })).toContainText('Local model');
    });
  }
}
test('composer, attachments, streaming, stop, edit, retry, feedback, copy and refresh', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/chat');
  await page.getByRole('button', { name: 'Make a plan' }).click();
  await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toHaveValue(
    'Help me plan a focused week for my next project.',
  );
  const input = page.getByRole('textbox', { name: 'Message', exact: true });
  await input.fill('A plan');
  await input.press('Shift+Enter');
  await input.press('x');
  await expect(input).toHaveValue('A plan\nx');
  await page.getByLabel('Attach files', { exact: true }).setInputFiles({
    name: 'notes.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('Local demo notes'),
  });
  await page.getByRole('button', { name: 'Remove notes.txt' }).click();
  await page.getByLabel('Attach files', { exact: true }).setInputFiles({
    name: 'notes.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('Local demo notes'),
  });
  await input.press('Enter');
  await expect(page.getByRole('button', { name: 'Stop response' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Conversation messages' })).toContainText(
    'notes.txt',
  );
  await page.getByRole('button', { name: 'Stop response' }).click();
  await expect(page.getByRole('button', { name: 'Send message' })).toBeDisabled();
  await page.getByRole('button', { name: 'Retry response' }).click();
  await expect(page.getByRole('button', { name: 'Stop response' })).toHaveCount(0, {
    timeout: 10_000,
  });
  await page.getByRole('button', { name: 'Good response' }).click();
  await expect(page.getByRole('button', { name: 'Good response' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('button', { name: 'Copy message' }).last().click();
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toContain('A practical starting point');
  await page.getByRole('button', { name: 'Edit message', exact: true }).click();
  await page.getByRole('textbox', { name: 'Edit message text' }).fill('Write a welcome');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'A warm welcome' })).toBeVisible({
    timeout: 10_000,
  });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'What’s on your mind?' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'A plan', exact: true })).toHaveCount(0);
});
test('search, rename, pin, confirmed deletion, and switching cancels streaming', async ({
  page,
}) => {
  await page.goto('/chat');
  await page.getByRole('textbox', { name: 'Search conversations' }).fill('focused');
  await expect(
    page.getByRole('button', { name: 'Ideas for a calmer workspace', exact: true }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Actions for A more focused week' }).click();
  await page.getByRole('menuitem', { name: 'Rename conversation' }).click();
  await page.getByRole('textbox', { name: 'Conversation name' }).fill('Focus time');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('textbox', { name: 'Search conversations' }).fill('');
  await page.getByRole('button', { name: 'Actions for Focus time' }).click();
  await page.getByRole('menuitem', { name: 'Unpin conversation' }).click();
  await page.getByRole('button', { name: 'Focus time', exact: true }).click();
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Please make a plan');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByRole('button', { name: 'Stop response' })).toBeVisible();
  await page.getByRole('button', { name: 'Ideas for a calmer workspace', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Stop response' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Actions for Focus time' }).click();
  await page.getByRole('menuitem', { name: 'Delete conversation' }).click();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('button', { name: 'Focus time', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Actions for Focus time' }).click();
  await page.getByRole('menuitem', { name: 'Delete conversation' }).click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Focus time', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'New chat', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'What’s on your mind?' })).toBeVisible();
});

test('short mobile height keeps content scrollable and keyboard focus visible', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 400 });
  await page.goto('/chat');
  await page.getByRole('textbox', { name: 'Message', exact: true }).focus();
  await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toBeFocused();
  expect(
    await page
      .getByRole('textbox', { name: 'Message', exact: true })
      .evaluate((element) => getComputedStyle(element.parentElement!).boxShadow),
  ).not.toBe('none');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Add attachments' })).toBeFocused();
  await page.getByRole('button', { name: 'Build something' }).scrollIntoViewIfNeeded();
  await expect(page.getByRole('button', { name: 'Build something' })).toBeInViewport();
  await page.getByRole('heading', { name: 'What’s on your mind?' }).scrollIntoViewIfNeeded();
  await expect(page.getByRole('heading', { name: 'What’s on your mind?' })).toBeInViewport();
});

test('mobile history menus and confirmation dialogs stay usable', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await page.goto('/chat');
  await openHistory(page);
  await page.getByRole('button', { name: 'Actions for A more focused week' }).click();
  await page.getByRole('menuitem', { name: 'Rename conversation' }).click();
  await page.getByRole('textbox', { name: 'Conversation name' }).fill('Mobile conversation');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('button', { name: 'Actions for Mobile conversation' }).click();
  await page.getByRole('menuitem', { name: 'Delete conversation' }).click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Mobile conversation', exact: true })).toHaveCount(
    0,
  );
});
