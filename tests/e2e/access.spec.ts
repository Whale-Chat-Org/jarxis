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
 * dialog, the real `/api/auth/admin/set-role` round trip and the responsive/theme behaviour of the
 * access screens.
 *
 * Every test registers its own unique fixture users and never resets or truncates shared tables.
 */

const GENERIC_SAVE_FAILURE = 'The role was not changed. Try again.';

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

/** Open the change-role dialog for one email. */
async function openChangeRole(page: Page, email: string) {
  const row = await findAccessEntry(page, email);
  await row.getByRole('button', { name: 'Change role' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Change role' })).toBeVisible();
  await expect(dialog.getByText(email)).toBeVisible();
  return dialog;
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

  const dialog = await openChangeRole(page, target.email);
  await expect(dialog.getByText('Current: User')).toBeVisible();
  // Nothing is selected away from the stored role yet, so there is nothing to save.
  await expect(dialog.getByRole('button', { name: 'Save role' })).toBeDisabled();

  await dialog.getByRole('radio', { name: /^Viewer/ }).check();

  const setRoleCall = page.waitForResponse(
    (response) =>
      response.url().includes('/api/auth/admin/set-role') && response.request().method() === 'POST',
  );
  await dialog.getByRole('button', { name: 'Save role' }).click();
  expect((await setRoleCall).status()).toBe(200);
  await expect(dialog).toBeHidden();

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

  const dialog = await openChangeRole(page, target.email);
  await expect(dialog.getByRole('button', { name: 'Save role' })).toBeDisabled();
  await dialog.getByRole('radio', { name: /^Owner/ }).check();
  await expect(
    dialog.getByText('Owners have full control, including assigning roles and deleting accounts.'),
  ).toBeVisible();

  // The second confirmation modal is gone: the primary button renames itself instead.
  const makeOwnerButton = dialog.getByRole('button', { name: 'Make owner' });
  await expect(makeOwnerButton).toBeEnabled();
  await expect(page.getByRole('alertdialog')).toHaveCount(0);

  // Cancelling writes nothing.
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
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

  const unverifiedDialog = await openChangeRole(page, unverified.email);
  await expect(unverifiedDialog.getByRole('radio', { name: /^Owner/ })).toBeDisabled();
  await expect(
    unverifiedDialog.getByText(
      'An owner must have a verified email address, so this user cannot be an owner yet.',
    ),
  ).toBeVisible();
  // A lesser role is still assignable, so the refusal is specific to owner.
  await expect(unverifiedDialog.getByRole('radio', { name: /^Viewer/ })).toBeEnabled();
  await unverifiedDialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(unverifiedDialog).toBeHidden();

  const bannedDialog = await openChangeRole(page, banned.email);
  await expect(bannedDialog.getByRole('radio', { name: /^Owner/ })).toBeDisabled();
  await expect(
    bannedDialog.getByText(
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

  const dialog = await openChangeRole(page, target.email);
  await expect(accessEntry(page, target.email)).toContainText('Viewer');
  await expect(accessEntry(page, target.email)).toContainText('Administrator');
  await expect(dialog.getByText('Current: Viewer, Administrator')).toBeVisible();
  await expect(dialog.getByText('Saving replaces all current roles.')).toBeVisible();
  // No single role is preselected while two are stored.
  for (const name of [/^Viewer/, /^Administrator/]) {
    await expect(dialog.getByRole('radio', { name })).not.toBeChecked();
  }

  await dialog.getByRole('radio', { name: /^User/ }).check();
  await dialog.getByRole('button', { name: 'Save role' }).click();
  await expect(dialog).toBeHidden();
  expect(await readRole(target.id)).toBe('user');
  await expect(accessEntry(page, target.email)).toContainText('User');
});

test('a refused role change keeps the dialog open and the selection, then succeeds on retry', async ({
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
  const dialog = await openChangeRole(page, target.email);
  await dialog.getByRole('radio', { name: /^Viewer/ }).check();
  await dialog.getByRole('button', { name: 'Save role' }).click();

  await expect(dialog.getByText('Role not changed')).toBeVisible();
  await expect(dialog.getByText(GENERIC_SAVE_FAILURE)).toBeVisible();
  await expect(dialog.getByText(/alert\(1\)/)).toHaveCount(0);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('radio', { name: /^Viewer/ })).toBeChecked();
  expect(await readRole(target.id)).toBe(storedBefore);

  await page.unroute('**/api/auth/admin/set-role');
  const setRoleCall = page.waitForResponse(
    (response) =>
      response.url().includes('/api/auth/admin/set-role') && response.request().method() === 'POST',
  );
  await dialog.getByRole('button', { name: 'Save role' }).click();
  expect((await setRoleCall).status()).toBe(200);
  await expect(dialog).toBeHidden();
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
      const dialog = page.getByRole('dialog');
      await expect(dialog.getByText(target.email)).toBeVisible();

      // The dialog must stay inside the viewport and both actions must be reachable.
      const box = await dialog.boundingBox();
      expect(box, 'The change-role dialog must be laid out').not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(-1);
      expect(box!.y).toBeGreaterThanOrEqual(-1);
      expect(box!.width).toBeLessThanOrEqual(viewport.width + 1);
      expect(box!.height).toBeLessThanOrEqual(viewport.height + 1);
      for (const name of ['Cancel', 'Save role']) {
        const action = dialog.getByRole('button', { name });
        await action.scrollIntoViewIfNeeded();
        await expect(action).toBeVisible();
      }
      await page.screenshot({ path: `${shot}-dialog.png` });
      await noOverflow();

      // Escape closes the dialog and returns focus to the row trigger that opened it.
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
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
