import { randomBytes } from 'node:crypto';
import {
  expect,
  type APIRequestContext,
  type BrowserContext,
  type Locator,
  type Page,
} from '@playwright/test';
import { test } from './fixtures';
import { login, makeOwner, register, verify } from './helpers';

/**
 * Acceptance coverage for the administration panel wrapper that replaced the admin dialogs.
 *
 * `AdminPanelHost` docks one panel beside the page as a `role="region"` from `lg` (1024px) upward
 * and only falls back to a `role="dialog"` sheet below it. Panels stay mounted while drilling down,
 * so a nested panel (set password, a destructive confirmation) must return to the inspector with
 * its unsaved edits intact, and a navigation must dismiss the whole stack.
 *
 * Every test registers its own unique fixture accounts and never resets shared tables. Mutations
 * that are only used to prove a guard are intercepted so nothing is written.
 */

const DOCK_WIDTH = 384;
const DOCK_WIDTH_WIDE = 448;
const DESKTOP_PANEL_WIDTH = 1024;
/** `UsersPanel` localization (`@better-auth-ui/core/plugins/admin`), not invented copy. */
const L = {
  back: 'Back',
  cancel: 'Cancel',
  closePanel: 'Close panel',
  createUser: 'Create user',
  deleteUser: 'Delete user',
  moreActions: 'More actions',
  name: 'Name',
  saveChanges: 'Save changes',
  searchByEmail: 'Search by email',
  setPassword: 'Set password',
} as const;

/** The visible panel, narrowed by its heading so the dock and other regions are never matched. */
function adminPanel(page: Page, heading: string | RegExp): Locator {
  return page
    .locator('[data-slot="admin-panel"]:visible')
    .filter({ has: page.getByRole('heading', { name: heading }) });
}

async function ownerSession(request: APIRequestContext, context: BrowserContext, baseURL: string) {
  const owner = await register(request, baseURL);
  await verify(request, owner.email, baseURL);
  await makeOwner(owner.id);
  await login(request, owner.email, baseURL);
  await context.addCookies((await request.storageState()).cookies);
  return owner;
}

async function verifiedTarget(request: APIRequestContext, baseURL: string) {
  const target = await register(request, baseURL);
  await verify(request, target.email, baseURL);
  return target;
}

/** A fresh synthetic IP per navigation keeps long loops below the per-IP auth rate limit. */
async function rotateClientIp(page: Page, baseURL: string) {
  const bytes = randomBytes(3);
  await page.setExtraHTTPHeaders({
    Origin: new URL(baseURL).origin,
    'X-Real-IP': `10.${bytes[0]}.${bytes[1]}.${bytes[2]}`,
  });
}

/** Narrow the Accounts table to one account and return its row. */
async function findAccountRow(page: Page, email: string) {
  await page.getByRole('textbox', { name: L.searchByEmail }).fill(email);
  const row = page.getByRole('row').filter({ hasText: email });
  await expect(row).toHaveCount(1);
  return row;
}

/**
 * Open the inspector from the row. The name is rendered as a link-styled button next to the
 * avatar (`UsersPanel`), and the row itself is clickable; the explicit trigger is used so the
 * assertion fails loudly if that affordance disappears.
 */
async function openInspector(page: Page, email: string, name: string) {
  const row = await findAccountRow(page, email);
  await row.getByRole('button', { name }).click();
  const inspector = adminPanel(page, name);
  await expect(inspector).toBeVisible();
  return { inspector, row };
}

/**
 * Reach one of the inspector's secondary actions. The inspector offers them through its
 * "More actions" menu; the same labels also exist as inline buttons in the Security and Danger
 * zone sections, so either placement satisfies the test.
 */
async function openInspectorAction(page: Page, inspector: Locator, label: string) {
  const menu = inspector.getByRole('button', { name: L.moreActions });
  if (await menu.count()) {
    await menu.click();
    const item = page.getByRole('menu').getByRole('menuitem', { name: label });
    await expect(page.getByRole('menu')).toBeVisible();
    if ((await item.count()) && (await item.isEnabled())) {
      await item.click();
      return;
    }
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);
  }
  await inspector.getByRole('button', { name: label }).click();
}

test('a nested panel returns to the inspector with its unsaved edits and writes nothing', async ({
  page,
  context,
  request,
  baseURL,
}) => {
  const target = await verifiedTarget(request, baseURL!);
  await ownerSession(request, context, baseURL!);

  // No destructive write may reach the server from this test, and the counters prove it.
  const removeCalls: string[] = [];
  const passwordCalls: string[] = [];
  await page.route('**/api/auth/admin/remove-user', (route) => {
    removeCalls.push(route.request().method());
    return route.abort();
  });
  await page.route('**/api/auth/admin/set-user-password', (route) => {
    passwordCalls.push(route.request().method());
    return route.abort();
  });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/admin/users');
  const { inspector } = await openInspector(page, target.email, 'Acceptance User');
  await expect(inspector).toHaveAttribute('data-mode', 'docked');

  // An unsaved profile edit that must survive the round trip through the nested panels.
  const unsavedName = 'Unsaved Draft Name';
  const nameField = inspector.getByLabel(L.name, { exact: true });
  await nameField.fill(unsavedName);

  // Drilling down replaces the dock contents and offers a Back affordance instead of a second
  // stacked surface.
  await openInspectorAction(page, inspector, L.setPassword);
  const passwordPanel = adminPanel(page, L.setPassword);
  await expect(passwordPanel).toBeVisible();
  await expect(inspector).toBeHidden();
  await expect(page.locator('[data-slot="admin-panel"]:visible')).toHaveCount(1);
  await passwordPanel.getByRole('button', { name: L.back }).click();
  await expect(inspector).toBeVisible();
  await expect(nameField).toHaveValue(unsavedName);

  // The destructive confirmation is the same dock, and cancelling it sends no request.
  await openInspectorAction(page, inspector, L.deleteUser);
  const confirmation = adminPanel(page, L.deleteUser);
  await expect(confirmation).toBeVisible();
  await expect(confirmation.getByText(target.email)).toBeVisible();
  await confirmation.getByRole('button', { name: L.cancel }).click();
  await expect(confirmation).toBeHidden();
  await expect(inspector).toBeVisible();
  await expect(nameField).toHaveValue(unsavedName);
  expect(removeCalls, 'Cancelling a confirmation must not call the admin API').toEqual([]);
  expect(passwordCalls, 'Backing out of the password panel must not write').toEqual([]);

  // Navigating away dismisses the whole stack rather than leaving a stale panel docked.
  await page.locator('[data-slot="sidebar"]').getByRole('link', { name: 'Roles' }).click();
  await expect(page).toHaveURL(/\/admin\/roles(?:\?|$)/);
  await expect(page.locator('[data-slot="admin-panel"]:visible')).toHaveCount(0);
  await expect(page.locator('[data-slot="admin-panel-dock"]')).toBeHidden();
});

test('pending confirmations and saves are not dismissed by Escape', async ({
  page,
  context,
  request,
  baseURL,
}) => {
  const target = await verifiedTarget(request, baseURL!);
  await ownerSession(request, context, baseURL!);

  // Both writes are held open, then failed, so the guard is observed without mutating the
  // fixture account.
  const held: (() => Promise<void>)[] = [];
  const hold = (pattern: string) =>
    page.route(pattern, (route) => {
      held.push(() => route.abort());
      return new Promise<void>(() => {});
    });
  await hold('**/api/auth/admin/remove-user');
  await hold('**/api/auth/admin/update-user');
  await hold('**/api/auth/admin/set-role');
  const release = async () => {
    for (const abort of held.splice(0)) await abort().catch(() => undefined);
  };

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/admin/users');
  const { inspector } = await openInspector(page, target.email, 'Acceptance User');

  // A confirmed destructive action in flight survives an accidental dismissal.
  await openInspectorAction(page, inspector, L.deleteUser);
  const confirmation = adminPanel(page, L.deleteUser);
  await confirmation.getByRole('button', { name: L.deleteUser }).click();
  await expect.poll(() => held.length).toBeGreaterThan(0);
  await page.keyboard.press('Escape');
  await expect(confirmation).toBeVisible();
  await expect(confirmation.getByRole('button', { name: L.cancel })).toBeDisabled();
  await release();
  await expect(confirmation.getByRole('button', { name: L.cancel })).toBeEnabled();
  await confirmation.getByRole('button', { name: L.cancel }).click();
  await expect(inspector).toBeVisible();

  // A profile save in flight is likewise not interruptible.
  await inspector.getByLabel(L.name, { exact: true }).fill('Guarded Save Name');
  await inspector.getByRole('button', { name: L.saveChanges }).click();
  await expect.poll(() => held.length).toBeGreaterThan(0);
  await page.keyboard.press('Escape');
  await expect(inspector).toBeVisible();
  await release();
  // The failure renders next to the form; the panel stays open with the attempted value.
  await expect(inspector).toBeVisible();
  await expect(inspector.getByLabel(L.name, { exact: true })).toHaveValue('Guarded Save Name');

  await page.unrouteAll({ behavior: 'ignoreErrors' });
});

const viewports = [
  { label: 'mobile-375x667', width: 375, height: 667 },
  { label: 'mobile-440x956', width: 440, height: 956 },
  { label: 'tablet-768x1024', width: 768, height: 1024 },
  { label: 'tablet-960x1440', width: 960, height: 1440 },
  { label: 'desktop-1280x800', width: 1280, height: 800 },
  { label: 'desktop-1440x900', width: 1440, height: 900 },
] as const;

test('right panels animate opening and closing and respect reduced motion', async ({
  page,
  context,
  request,
  baseURL,
}) => {
  await ownerSession(request, context, baseURL!);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/admin/users');

  const createButton = page.getByRole('button', { name: L.createUser, exact: true });
  await createButton.click();
  const panel = page.locator('[data-slot="admin-panel"]:visible');
  await expect(panel).toHaveCSS('animation-name', 'admin-panel-enter');
  await expect(panel).toHaveCSS('animation-duration', '0.2s');
  await expect(panel).toHaveCSS('transform', /^(none|matrix\(1, 0, 0, 1, 0, 0\))$/);
  await panel.getByRole('button', { name: L.closePanel }).click();
  await expect(page.locator('[data-slot="admin-panel"][data-state="closed"]')).toHaveCSS(
    'animation-name',
    'admin-panel-exit',
  );
  await expect(panel).toBeHidden();

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await createButton.click();
  await expect(panel).toHaveCSS('animation-name', 'none');
  await expect(page.locator('[data-slot="admin-panel-dock"]')).toHaveCSS(
    'transition-property',
    'none',
  );
  await panel.getByRole('button', { name: L.closePanel }).click();
  await expect(panel).toBeHidden();
});

test('the user panels fit every supported viewport in both themes', async ({
  page,
  context,
  request,
  baseURL,
}) => {
  // Both themes at all six required viewports, each reloading every admin query.
  test.setTimeout(180_000);

  const target = await verifiedTarget(request, baseURL!);
  await ownerSession(request, context, baseURL!);

  const noOverflow = () =>
    expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
      .toBe(true);

  /** Shared geometry contract for whichever panel is docked or presented as a sheet. */
  const expectBounded = async (panel: Locator, width: number, height: number) => {
    const docked = width >= DESKTOP_PANEL_WIDTH;
    await expect(panel).toHaveAttribute('data-mode', docked ? 'docked' : 'sheet');
    await expect(panel).toHaveRole(docked ? 'region' : 'dialog');
    await expect(panel).toHaveCSS('transform', /^(none|matrix\(1, 0, 0, 1, 0, 0\))$/);
    const bounds = await panel.boundingBox();
    expect(bounds, 'The panel must be laid out').not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(-1);
    expect(bounds!.y).toBeGreaterThanOrEqual(-1);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width + 1);
    expect(bounds!.height).toBeLessThanOrEqual(height + 1);
    if (docked) {
      const dock = await page.locator('[data-slot="admin-panel-dock"]').boundingBox();
      expect(dock, 'The dock must be laid out beside the page').not.toBeNull();
      expect(dock!.x + dock!.width).toBeGreaterThanOrEqual(width - 1);
      expect(dock!.x + dock!.width).toBeLessThanOrEqual(width + 1);
      expect(dock!.width).toBeCloseTo(width < 1280 ? DOCK_WIDTH : DOCK_WIDTH_WIDE, 0);
      await expect(page.locator('[data-slot="sheet-overlay"]:visible')).toHaveCount(0);
    } else {
      await expect(page.locator('[data-slot="sheet-overlay"]')).toBeVisible();
    }
    await noOverflow();
  };

  for (const theme of ['light', 'dark'] as const) {
    for (const viewport of viewports) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await rotateClientIp(page, baseURL!);
      await page.goto('/admin/users');
      await page.evaluate((value) => window.localStorage.setItem('theme', value), theme);
      await page.reload();
      await expect(page.locator('html')).toHaveClass(new RegExp(`\\b${theme}\\b`));
      const shot = `test-results/admin-panels-${theme}-${viewport.label}`;

      // Creating an account: the form panel keeps both actions reachable.
      await page.getByRole('button', { name: L.createUser, exact: true }).click();
      const create = adminPanel(page, L.createUser);
      await expect(create).toBeVisible();
      await expectBounded(create, viewport.width, viewport.height);
      for (const name of [L.cancel, L.createUser]) {
        const action = create.getByRole('button', { name, exact: true });
        await action.scrollIntoViewIfNeeded();
        await expect(action).toBeVisible();
      }
      await page.screenshot({ path: `${shot}-create.png` });
      await page.keyboard.press('Escape');
      await expect(create).toBeHidden();

      // Inspecting an account: the same geometry, plus the save state the tabs depend on.
      const { inspector } = await openInspector(page, target.email, 'Acceptance User');
      await expectBounded(inspector, viewport.width, viewport.height);
      const save = inspector.getByRole('button', { name: L.saveChanges });
      await save.scrollIntoViewIfNeeded();
      await expect(save).toBeVisible();
      const nameField = inspector.getByLabel(L.name, { exact: true });
      await nameField.fill('');
      await expect(save, 'An empty name cannot be saved').toBeDisabled();
      await nameField.fill('Acceptance User');
      await expect(save).toBeEnabled();
      await expect(inspector.getByRole('tab', { name: 'Overview' })).toBeVisible();
      await page.screenshot({ path: `${shot}-inspector.png` });

      await inspector.getByRole('button', { name: L.closePanel }).click();
      await expect(inspector).toBeHidden();
      await noOverflow();
    }
  }
});
