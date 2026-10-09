import { randomBytes } from 'node:crypto';
import {
  expect,
  type APIRequestContext,
  type BrowserContext,
  type Locator,
  type Page,
} from '@playwright/test';
import { test } from './fixtures';
import { login, makeOwner, register, testDatabase, verify } from './helpers';

/**
 * Acceptance coverage for Users & access: the simplified access directory, the "Change role"
 * panel, the real `/api/auth/admin/set-role` round trip and the responsive/theme behaviour of the
 * access screens.
 *
 * Administration surfaces are no longer modal dialogs: `AdminPanelHost` docks them beside the page
 * as a `role="region"` from `lg` (1024px) upward and only falls back to a `role="dialog"` sheet
 * below it, so the panel is addressed by its data slot instead of by the dialog role.
 *
 * Every test registers its own unique fixture users and never resets or truncates shared tables.
 */

const GENERIC_SAVE_FAILURE = 'The role was not changed. Try again.';
/** The dock is 24rem from `lg` and 28rem from `xl`; the sheet below `lg` is full width. */
const DOCK_WIDTH = 384;
const DOCK_WIDTH_WIDE = 448;
const DESKTOP_PANEL_WIDTH = 1024;

/**
 * The active administration panel. Every panel stays mounted while drilling down, and inactive
 * ones are `hidden`, so only the visible one is addressed; the heading disambiguates it from the
 * other regions on the page (the dock itself, model previews, …).
 */
function adminPanel(page: Page, heading?: string): Locator {
  const panels = page.locator('[data-slot="admin-panel"]:visible');
  return heading
    ? panels.filter({ has: page.getByRole('heading', { name: heading, exact: true }) })
    : panels;
}

/** Fixture-only SQL: the API deliberately refuses these states, so the test data is written here. */
async function setAccountFlags(
  id: string,
  flags: { banned?: boolean; emailVerified?: boolean; role?: string | null },
) {
  const pool = testDatabase();
  try {
    const result = await pool.query(
      `UPDATE app_user
          SET banned = COALESCE($2, banned),
              email_verified = COALESCE($3, email_verified),
              role = CASE WHEN $5::boolean THEN $4 ELSE role END,
              updated_at = now()
        WHERE id = $1
        RETURNING id`,
      [id, flags.banned ?? null, flags.emailVerified ?? null, flags.role ?? null, 'role' in flags],
    );
    expect(result.rowCount, 'Fixture user must exist').toBe(1);
  } finally {
    await pool.end();
  }
}

async function readRole(id: string) {
  const pool = testDatabase();
  try {
    const result = await pool.query<{ role: string | null }>(
      'SELECT role FROM app_user WHERE id = $1',
      [id],
    );
    expect(result.rowCount, 'Fixture user must exist').toBe(1);
    return result.rows[0].role;
  } finally {
    await pool.end();
  }
}

/** Sign in through the API fixture and hand the resulting cookies to the browser context. */
async function signIn(
  context: BrowserContext,
  request: APIRequestContext,
  baseURL: string,
  email: string,
) {
  await login(request, email, baseURL);
  await context.addCookies((await request.storageState()).cookies);
}

/** Create a verified fixture account, optionally with an exact stored role value. */
async function createTarget(
  request: APIRequestContext,
  baseURL: string,
  options: { verify?: boolean; roles?: string[] } = {},
) {
  const { email, id } = await register(request, baseURL);
  if (options.verify !== false) await verify(request, email, baseURL);
  if (options.roles?.length) await setAccountFlags(id, { role: options.roles.join(',') });
  return { email, id };
}

/**
 * The visible entry for one email. The directory renders a table from `lg` upward and stacked
 * cards below it, and both markups exist in the DOM, so only the visible one is addressed.
 */
function accessEntry(page: Page, email: string): Locator {
  return page.locator('tr:visible, li:visible').filter({ hasText: email });
}

/** Narrow the server-paginated directory to one account and return its visible entry. */
async function findAccessEntry(page: Page, email: string) {
  await page.getByRole('textbox', { name: 'Search by name or email' }).fill(email);
  const row = accessEntry(page, email);
  await expect(row).toHaveCount(1);
  return row;
}

/** Open the change-role panel for one email. */
async function openChangeRole(page: Page, email: string) {
  const row = await findAccessEntry(page, email);
  await row.getByRole('button', { name: 'Change role' }).click();
  const panel = adminPanel(page, 'Change role');
  await expect(panel.getByRole('heading', { name: 'Change role' })).toBeVisible();
  await expect(panel.getByText(email)).toBeVisible();
  return panel;
}

test('an owner changes a role through the admin API', async ({
  page,
  context,
  request,
  baseURL,
}) => {
  const target = await createTarget(request, baseURL!);
  const owner = await createTarget(request, baseURL!);
  await makeOwner(owner.id);
  await signIn(context, request, baseURL!, owner.email);

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/admin/users');
  await expect(page.getByRole('heading', { name: 'Users & access' })).toBeVisible();
  // The access tab is the default; the registry table lives behind "Accounts".
  await expect(page.getByRole('tab', { name: 'Accounts' })).toBeVisible();
  // The old multi-control filter bar is gone: one search box, no status select.
  await expect(page.getByRole('combobox', { name: 'Status' })).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: 'Search field' })).toHaveCount(0);

  const panel = await openChangeRole(page, target.email);
  await expect(panel.getByText('Current: User')).toBeVisible();
  // Nothing is selected away from the stored role yet, so there is nothing to save.
  await expect(panel.getByRole('button', { name: 'Save role' })).toBeDisabled();

  await panel.getByRole('radio', { name: /^Viewer/ }).check();

  const setRoleCall = page.waitForResponse(
    (response) =>
      response.url().includes('/api/auth/admin/set-role') && response.request().method() === 'POST',
  );
  await panel.getByRole('button', { name: 'Save role' }).click();
  expect((await setRoleCall).status()).toBe(200);
  await expect(panel).toBeHidden();

  // The stored value and the refreshed row both show the new role.
  expect(await readRole(target.id)).toBe('viewer');
  await expect(accessEntry(page, target.email)).toContainText('Viewer');

  // Cancelling a later edit writes nothing and keeps the stored selection.
  const reopened = await openChangeRole(page, target.email);
  await reopened.getByRole('radio', { name: /^Administrator/ }).check();
  await reopened.getByRole('button', { name: 'Cancel' }).click();
  expect(await readRole(target.id)).toBe('viewer');
  const cancelled = await openChangeRole(page, target.email);
  await expect(cancelled.getByRole('radio', { name: /^Viewer/ })).toBeChecked();
  await expect(cancelled.getByRole('button', { name: 'Save role' })).toBeDisabled();
});

test('selecting owner warns inline and saves with one Make owner button', async ({
  page,
  context,
  request,
  baseURL,
}) => {
  const target = await createTarget(request, baseURL!, { roles: ['viewer'] });
  const owner = await createTarget(request, baseURL!);
  await makeOwner(owner.id);
  await signIn(context, request, baseURL!, owner.email);

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/admin/users');

  const panel = await openChangeRole(page, target.email);
  await expect(panel.getByRole('button', { name: 'Save role' })).toBeDisabled();
  await panel.getByRole('radio', { name: /^Owner/ }).check();
  await expect(
    panel.getByText('Owners have full control, including assigning roles and deleting accounts.'),
  ).toBeVisible();

  // The second confirmation modal is gone: the primary button renames itself instead.
  const makeOwnerButton = panel.getByRole('button', { name: 'Make owner' });
  await expect(makeOwnerButton).toBeEnabled();
  await expect(page.getByRole('alertdialog')).toHaveCount(0);

  // Cancelling writes nothing.
  await panel.getByRole('button', { name: 'Cancel' }).click();
  await expect(panel).toBeHidden();
  expect(await readRole(target.id)).toBe('viewer');

  const reopened = await openChangeRole(page, target.email);
  await reopened.getByRole('radio', { name: /^Owner/ }).check();
  const setRoleCall = page.waitForResponse(
    (response) =>
      response.url().includes('/api/auth/admin/set-role') && response.request().method() === 'POST',
  );
  await reopened.getByRole('button', { name: 'Make owner' }).click();
  expect((await setRoleCall).status()).toBe(200);
  await expect(reopened).toBeHidden();
  expect(await readRole(target.id)).toBe('owner');
});

test('an owner cannot change their own role', async ({ page, context, request, baseURL }) => {
  const owner = await createTarget(request, baseURL!);
  await makeOwner(owner.id);
  await signIn(context, request, baseURL!, owner.email);

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/admin/users');

  const row = await findAccessEntry(page, owner.email);
  await expect(row.getByText('You')).toBeVisible();
  await expect(row.getByRole('button', { name: 'Change role' })).toHaveCount(0);
});

for (const role of ['viewer', 'administrator'] as const) {
  test(`a ${role} sees roles but gets no role action at all`, async ({
    page,
    context,
    request,
    baseURL,
  }) => {
    const target = await createTarget(request, baseURL!, { roles: ['viewer'] });
    const actor = await createTarget(request, baseURL!, { roles: [role] });
    await signIn(context, request, baseURL!, actor.email);

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/admin/users');

    const row = await findAccessEntry(page, target.email);
    // The role is already visible in the row, so there is nothing to open.
    await expect(row).toContainText('Viewer');
    await expect(row.getByRole('button', { name: 'Change role' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'View access' })).toHaveCount(0);
    await expect(page.getByRole('columnheader', { name: 'Role' })).toBeVisible();
  });
}

test('owner is refused for unverified and banned accounts with an explanation', async ({
  page,
  context,
  request,
  baseURL,
}) => {
  const unverified = await createTarget(request, baseURL!, { verify: false });
  const banned = await createTarget(request, baseURL!, { roles: ['viewer'] });
  await setAccountFlags(banned.id, { banned: true });
  const owner = await createTarget(request, baseURL!);
  await makeOwner(owner.id);
  await signIn(context, request, baseURL!, owner.email);

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/admin/users');

  const unverifiedPanel = await openChangeRole(page, unverified.email);
  await expect(unverifiedPanel.getByRole('radio', { name: /^Owner/ })).toBeDisabled();
  await expect(
    unverifiedPanel.getByText(
      'An owner must have a verified email address, so this user cannot be an owner yet.',
    ),
  ).toBeVisible();
  // A lesser role is still assignable, so the refusal is specific to owner.
  await expect(unverifiedPanel.getByRole('radio', { name: /^Viewer/ })).toBeEnabled();
  await unverifiedPanel.getByRole('button', { name: 'Cancel' }).click();
  await expect(unverifiedPanel).toBeHidden();

  const bannedPanel = await openChangeRole(page, banned.email);
  await expect(bannedPanel.getByRole('radio', { name: /^Owner/ })).toBeDisabled();
  await expect(
    bannedPanel.getByText(
      'An owner must be an active account, so a banned user cannot be an owner.',
    ),
  ).toBeVisible();
});

test('a multi-role account shows every stored role and warns that saving replaces them', async ({
  page,
  context,
  request,
  baseURL,
}) => {
  // `setRole` appends, so this account ends up holding two stored names at once.
  const target = await createTarget(request, baseURL!, { roles: ['viewer', 'administrator'] });
  expect(await readRole(target.id)).toBe('viewer,administrator');
  const owner = await createTarget(request, baseURL!);
  await makeOwner(owner.id);
  await signIn(context, request, baseURL!, owner.email);

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/admin/users');

  const panel = await openChangeRole(page, target.email);
  await expect(accessEntry(page, target.email)).toContainText('Viewer');
  await expect(accessEntry(page, target.email)).toContainText('Administrator');
  await expect(panel.getByText('Current: Viewer, Administrator')).toBeVisible();
  await expect(panel.getByText('Saving replaces all current roles.')).toBeVisible();
  // No single role is preselected while two are stored.
  for (const name of [/^Viewer/, /^Administrator/]) {
    await expect(panel.getByRole('radio', { name })).not.toBeChecked();
  }

  await panel.getByRole('radio', { name: /^User/ }).check();
  await panel.getByRole('button', { name: 'Save role' }).click();
  await expect(panel).toBeHidden();
  expect(await readRole(target.id)).toBe('user');
  await expect(accessEntry(page, target.email)).toContainText('User');
});

test('a refused role change keeps the panel open and the selection, then succeeds on retry', async ({
  page,
  context,
  request,
  baseURL,
}) => {
  const target = await createTarget(request, baseURL!);
  const owner = await createTarget(request, baseURL!);
  await makeOwner(owner.id);
  await signIn(context, request, baseURL!, owner.email);

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/admin/users');

  // The server's own refusal is simulated; the body carries no allowlisted code or status, so the
  // UI must fall back to its single generic sentence rather than leak anything.
  await page.route('**/api/auth/admin/set-role', (route) =>
    route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'role "viewer" rejected by <script>alert(1)</script>' }),
    }),
  );

  const storedBefore = await readRole(target.id);
  const panel = await openChangeRole(page, target.email);
  await panel.getByRole('radio', { name: /^Viewer/ }).check();
  await panel.getByRole('button', { name: 'Save role' }).click();

  await expect(panel.getByText('Role not changed')).toBeVisible();
  await expect(panel.getByText(GENERIC_SAVE_FAILURE)).toBeVisible();
  await expect(panel.getByText(/alert\(1\)/)).toHaveCount(0);
  await expect(panel).toBeVisible();
  await expect(panel.getByRole('radio', { name: /^Viewer/ })).toBeChecked();
  expect(await readRole(target.id)).toBe(storedBefore);

  await page.unroute('**/api/auth/admin/set-role');
  const setRoleCall = page.waitForResponse(
    (response) =>
      response.url().includes('/api/auth/admin/set-role') && response.request().method() === 'POST',
  );
  await panel.getByRole('button', { name: 'Save role' }).click();
  expect((await setRoleCall).status()).toBe(200);
  await expect(panel).toBeHidden();
  expect(await readRole(target.id)).toBe('viewer');
});

test('one search box and pagination drive the directory through the list endpoint', async ({
  page,
  context,
  request,
  baseURL,
}) => {
  const owner = await createTarget(request, baseURL!);
  await makeOwner(owner.id);
  await signIn(context, request, baseURL!, owner.email);

  // Page authorization stays real (owner session); only the list payload is synthesised so the
  // test does not have to write fifteen fixture accounts.
  const people = Array.from({ length: 15 }, (_, index) => ({
    id: `mock-user-${index}`,
    name: `Mock Person ${index}`,
    email: `mock-${index}@example.test`,
    emailVerified: true,
    image: null,
    role: index % 2 === 0 ? 'viewer' : 'user',
    banned: index === 0,
    banReason: null,
    banExpires: null,
    createdAt: new Date(Date.UTC(2026, 0, 1 + index)).toISOString(),
    updatedAt: new Date(Date.UTC(2026, 0, 1 + index)).toISOString(),
  }));

  const requested: URL[] = [];
  await page.route('**/api/auth/admin/list-users**', (route) => {
    const url = new URL(route.request().url());
    requested.push(url);
    const limit = Number(url.searchParams.get('limit') ?? '10');
    const offset = Number(url.searchParams.get('offset') ?? '0');
    const field = url.searchParams.get('searchField') ?? 'name';
    const value = (url.searchParams.get('searchValue') ?? '').toLowerCase();
    let matched = people;
    if (value) {
      matched = matched.filter((person) =>
        (field === 'name' ? person.name : person.email).toLowerCase().includes(value),
      );
    }
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ users: matched.slice(offset, offset + limit), total: matched.length }),
    });
  });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/admin/users');

  await expect(page.getByText(/1\u201310 of 15/)).toBeVisible();
  await expect(accessEntry(page, 'mock-0@example.test')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Previous page' })).toBeDisabled();

  await page.getByRole('button', { name: 'Next page' }).click();
  await expect(page.getByText(/11\u201315 of 15/)).toBeVisible();
  await expect(accessEntry(page, 'mock-14@example.test')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Next page' })).toBeDisabled();

  const box = page.getByRole('textbox', { name: 'Search by name or email' });

  // A plain word searches names and returns to the first page.
  await box.fill('Mock Person 12');
  await expect(page.getByText(/1\u20131 of 1/)).toBeVisible();
  await expect(accessEntry(page, 'mock-12@example.test')).toHaveCount(1);
  expect(
    requested.some(
      (url) =>
        url.searchParams.get('searchField') === 'name' &&
        url.searchParams.get('searchValue') === 'Mock Person 12',
    ),
  ).toBe(true);

  // An "@" switches the same box to the email field, with no separate control.
  await box.fill('mock-7@example.test');
  await expect(page.getByText(/1\u20131 of 1/)).toBeVisible();
  await expect(accessEntry(page, 'mock-7@example.test')).toHaveCount(1);
  expect(
    requested.some(
      (url) =>
        url.searchParams.get('searchField') === 'email' &&
        url.searchParams.get('searchValue') === 'mock-7@example.test',
    ),
  ).toBe(true);

  await box.fill('');
  await expect(page.getByText(/1\u201310 of 15/)).toBeVisible();
});

const viewports = [
  { label: 'mobile-375x667', width: 375, height: 667 },
  { label: 'mobile-440x956', width: 440, height: 956 },
  { label: 'tablet-768x1024', width: 768, height: 1024 },
  { label: 'tablet-960x1440', width: 960, height: 1440 },
  // The two sides of the dock breakpoint: the sheet at 1023 and the dock at 1024.
  { label: 'tablet-1023x800', width: 1023, height: 800 },
  { label: 'desktop-1024x800', width: 1024, height: 800 },
  { label: 'desktop-1280x800', width: 1280, height: 800 },
  { label: 'desktop-1440x900', width: 1440, height: 900 },
] as const;

const themes = ['light', 'dark'] as const;

test('the access screens fit every supported viewport in both themes', async ({
  page,
  context,
  request,
  baseURL,
}) => {
  // One login, many viewports and themes: the loop needs more than the default budget.
  test.setTimeout(120_000);

  const target = await createTarget(request, baseURL!, { roles: ['viewer'] });
  const owner = await createTarget(request, baseURL!);
  await makeOwner(owner.id);
  await signIn(context, request, baseURL!, owner.email);

  const noOverflow = () =>
    expect
      .poll(() =>
        page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
      )
      .toBe(true);

  for (const theme of themes) {
    for (const viewport of viewports) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      // Each iteration reloads every admin query; a fresh synthetic IP keeps the 12 iterations
      // from tripping the per-IP auth rate limit, as the fixture already does per test.
      const bytes = randomBytes(3);
      await page.setExtraHTTPHeaders({
        Origin: new URL(baseURL!).origin,
        'X-Real-IP': `10.${bytes[0]}.${bytes[1]}.${bytes[2]}`,
      });
      await page.goto('/admin/users');
      await page.evaluate((value) => window.localStorage.setItem('theme', value), theme);
      await page.reload();
      // next-themes writes the class on <html>; the screenshots below are only meaningful once it
      // has applied the requested theme.
      await expect(page.locator('html')).toHaveClass(new RegExp(`\\b${theme}\\b`));

      const shot = `test-results/access-${theme}-${viewport.label}`;
      await expect(page.getByRole('heading', { name: 'Users & access' })).toBeVisible();
      // The directory itself: a table from lg upward, stacked cards below it.
      const row = await findAccessEntry(page, target.email);
      await page.screenshot({ path: `${shot}-directory.png`, fullPage: true });
      await noOverflow();

      await row.getByRole('button', { name: 'Change role' }).click();
      const panel = adminPanel(page, 'Change role');
      await expect(panel.getByText(target.email)).toBeVisible();
      const docked = viewport.width >= DESKTOP_PANEL_WIDTH;
      await expect(panel).toHaveAttribute('data-mode', docked ? 'docked' : 'sheet');
      // The dock is a landmark region beside the page; only the narrow fallback is a modal sheet.
      await expect(panel).toHaveRole(docked ? 'region' : 'dialog');

      // The panel must stay inside the viewport and both actions must be reachable.
      const box = await panel.boundingBox();
      expect(box, 'The change-role panel must be laid out').not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(-1);
      expect(box!.y).toBeGreaterThanOrEqual(-1);
      expect(box!.width).toBeLessThanOrEqual(viewport.width + 1);
      expect(box!.height).toBeLessThanOrEqual(viewport.height + 1);
      for (const name of ['Cancel', 'Save role']) {
        const action = panel.getByRole('button', { name });
        await action.scrollIntoViewIfNeeded();
        await expect(action).toBeVisible();
      }

      if (docked) {
        // The dock sits flush against the right viewport edge at its fixed width, and nothing
        // dims the page behind it: the directory stays visible and interactive.
        const dock = page.locator('[data-slot="admin-panel-dock"]');
        const dockBox = await dock.boundingBox();
        expect(dockBox, 'The dock must be laid out beside the page').not.toBeNull();
        expect(dockBox!.x + dockBox!.width).toBeGreaterThanOrEqual(viewport.width - 1);
        expect(dockBox!.x + dockBox!.width).toBeLessThanOrEqual(viewport.width + 1);
        expect(dockBox!.width).toBeCloseTo(viewport.width < 1280 ? DOCK_WIDTH : DOCK_WIDTH_WIDE, 0);
        await expect(page.locator('[data-slot="sheet-overlay"]:visible')).toHaveCount(0);
        // A docked panel is not modal, so the page behind it keeps its accessibility tree.
        await expect(panel).not.toHaveAttribute('aria-modal', 'true');

        // The directory's own search box still works while the panel is open.
        const search = page.getByRole('textbox', { name: 'Search by name or email' });
        await search.fill(target.email.toUpperCase());
        await expect(search).toHaveValue(target.email.toUpperCase());
        await expect(search).toBeFocused();
        await expect(panel).toBeVisible();
        await search.fill(target.email);
        await expect(accessEntry(page, target.email)).toHaveCount(1);

        // Tabbing out of the panel reaches the page again instead of cycling inside it.
        await panel.getByRole('button', { name: 'Cancel' }).focus();
        let escaped = false;
        for (let press = 0; press < 25 && !escaped; press += 1) {
          await page.keyboard.press('Tab');
          escaped = await page.evaluate(() => {
            const active = document.activeElement;
            const panelNode = document.querySelector('[data-slot="admin-panel"]:not([hidden])');
            return Boolean(active) && !panelNode?.contains(active);
          });
        }
        expect(escaped, 'A docked panel must not trap keyboard focus').toBe(true);
        await expect(panel).toBeVisible();
      } else {
        await expect(page.locator('[data-slot="sheet-overlay"]')).toBeVisible();
      }
      await page.screenshot({ path: `${shot}-panel.png` });
      await noOverflow();

      // Escape closes the panel and returns focus to the row trigger that opened it.
      await page.keyboard.press('Escape');
      await expect(panel).toBeHidden();
      await expect(row.getByRole('button', { name: 'Change role' })).toBeFocused();

      for (const path of ['/admin/roles', '/admin/permissions']) {
        await page.goto(path);
        await expect(
          page.getByRole('heading', { name: path.includes('roles') ? 'Roles' : 'Permissions' }),
        ).toBeVisible();
        await page.screenshot({
          path: `${shot}-${path.replace('/admin/', '')}.png`,
          fullPage: true,
        });
        await noOverflow();
      }
    }
  }
});
