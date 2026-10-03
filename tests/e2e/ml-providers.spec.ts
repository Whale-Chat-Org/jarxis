import { randomUUID } from 'node:crypto';
import {
  expect,
  type APIRequestContext,
  type BrowserContext,
  type Locator,
  type Page,
  type Route,
} from '@playwright/test';
import { test } from './fixtures';
import { login, makeOwner, originHeaders, register, setRole, verify } from './helpers';

const discoverPath = '**/api/admin/ml-providers/discover';
type DiscoveryBody = { provider: string; apiKey: string; baseUrl?: string };
type Discovery = {
  status: 'ok' | 'unsupported' | 'failed';
  models: { id: string; name: string }[];
  error: string | null;
  reason?: string;
  httpStatus?: number;
  retryAfterSeconds?: number;
};

const ok = (...ids: string[]): Discovery => ({
  status: 'ok',
  models: ids.map((id) => ({ id, name: `${id} name` })),
  error: null,
});

async function fulfill(route: Route, discovery: Discovery, status = 200) {
  // The page may already have aborted this request; that is the behaviour under test.
  await route.fulfill({ status, json: { discovery } }).catch(() => undefined);
}

async function ownerSession(request: APIRequestContext, context: BrowserContext, baseURL: string) {
  const account = await register(request, baseURL);
  await verify(request, account.email, baseURL);
  await makeOwner(account.id);
  await login(request, account.email, baseURL);
  await context.addCookies((await request.storageState()).cookies);
}

// Records every discovery request body and answers through `respond`.
async function interceptDiscovery(
  page: Page,
  respond: (body: DiscoveryBody, route: Route, index: number) => Promise<void>,
) {
  const calls: DiscoveryBody[] = [];
  await page.route(discoverPath, async (route) => {
    expect(route.request().method()).toBe('POST');
    const body = route.request().postDataJSON() as DiscoveryBody;
    calls.push(body);
    await respond(body, route, calls.length - 1);
  });
  return calls;
}

// Makes fetch ignore abort signals for discovery so stale responses still reach
// the component and must be discarded by its own guard.
async function ignoreDiscoveryAbort(page: Page) {
  await page.addInitScript(() => {
    const original = window.fetch.bind(window);
    window.fetch = (input, init) =>
      String(input instanceof Request ? input.url : input).endsWith('/ml-providers/discover')
        ? original(input, { ...init, signal: undefined })
        : original(input, init);
  });
}

async function openCreateDialog(page: Page) {
  await page.goto('/admin/ml-providers');
  await page.getByRole('button', { name: 'Add connection', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Add connection' });
  await expect(dialog).toBeVisible();
  return { dialog, preview: dialog.getByRole('region', { name: 'Model preview' }) };
}

const settle = (page: Page) => page.waitForTimeout(1200);

for (const role of ['user', 'viewer', 'administrator']) {
  test(`${role} cannot view or manage the model pool`, async ({
    request,
    page,
    context,
    baseURL,
  }) => {
    const account = await register(request, baseURL!);
    await verify(request, account.email, baseURL!);
    await setRole(account.id, role);
    await login(request, account.email, baseURL!);
    await context.addCookies((await request.storageState()).cookies);
    expect((await request.get('/api/admin/ml-providers')).status()).toBe(403);
    expect(
      (
        await request.post('/api/admin/ml-providers/keys', {
          headers: originHeaders(baseURL!),
          data: { name: 'Forbidden key' },
        })
      ).status(),
    ).toBe(403);
    await page.goto('/admin/ml-providers');
    await expect(page).toHaveURL(/\/access-denied(?:\?|$)/);
    await expect(page.getByRole('link', { name: 'ML providers', exact: true })).toHaveCount(0);
  });
}

test('owner manages redacted connections and revocable application keys', async ({
  request,
  baseURL,
}) => {
  const account = await register(request, baseURL!);
  await verify(request, account.email, baseURL!);
  await makeOwner(account.id);
  await login(request, account.email, baseURL!);
  const headers = originHeaders(baseURL!);
  const secret = `acceptance-only-${randomUUID()}`;
  const created = await request.post('/api/admin/ml-providers', {
    headers,
    data: {
      name: 'Acceptance provider',
      provider: 'openai',
      apiKey: secret,
      manualModels: ['acceptance-model'],
    },
  });
  expect(created.status(), await created.text()).toBeLessThan(300);
  const { connection } = await created.json();
  expect(connection.id).toBeTruthy();
  expect(await created.text()).not.toContain(secret);
  const listing = await request.get('/api/admin/ml-providers');
  expect(listing.status()).toBe(200);
  expect(await listing.text()).not.toContain(secret);
  expect(await listing.text()).not.toMatch(/encryptedCredential|encryptedState|encryptedInput/);
  const keyResponse = await request.post('/api/admin/ml-providers/keys', {
    headers,
    data: { name: 'Acceptance application' },
  });
  expect(keyResponse.status(), await keyResponse.text()).toBeLessThan(300);
  const { key, record } = await keyResponse.json();
  expect(typeof key).toBe('string');
  expect(
    (
      await request.get('/api/llm/v1/models', { headers: { Authorization: `Bearer ${key}` } })
    ).status(),
  ).toBe(200);
  const relisted = await request.get('/api/admin/ml-providers');
  expect(await relisted.text()).not.toContain(key);
  expect(
    (await request.delete(`/api/admin/ml-providers/keys/${record.id}`, { headers })).status(),
  ).toBeLessThan(300);
  expect(
    (
      await request.get('/api/llm/v1/models', { headers: { Authorization: `Bearer ${key}` } })
    ).status(),
  ).toBe(401);
  expect(
    (await request.delete(`/api/admin/ml-providers/${connection.id}`, { headers })).status(),
  ).toBeLessThan(300);
});

test('subscription login is bound to its initiating owner and cancellation rejects replay', async ({
  request,
  baseURL,
}) => {
  const initiator = await register(request, baseURL!);
  await verify(request, initiator.email, baseURL!);
  await makeOwner(initiator.id);
  await login(request, initiator.email, baseURL!);
  const headers = originHeaders(baseURL!);
  const created = await request.post('/api/admin/ml-providers', {
    headers,
    data: { name: 'Isolated login fixture', provider: 'codex' },
  });
  expect(created.status(), await created.text()).toBe(201);
  const { connection } = await created.json();
  const started = await request.post(`/api/admin/ml-providers/${connection.id}/login`, { headers });
  expect(started.status(), await started.text()).toBeLessThan(300);
  const { job } = await started.json();
  const other = await register(request, baseURL!);
  await verify(request, other.email, baseURL!);
  await makeOwner(other.id);
  await login(request, other.email, baseURL!);
  expect((await request.get(`/api/admin/ml-providers/login/${job.id}`)).status()).toBe(404);
  expect(
    (
      await request.post(`/api/admin/ml-providers/login/${job.id}`, {
        headers,
        data: { input: 'fake-code' },
      })
    ).status(),
  ).toBe(404);
  expect(
    (await request.delete(`/api/admin/ml-providers/login/${job.id}`, { headers })).status(),
  ).toBe(404);
  await login(request, initiator.email, baseURL!);
  expect(
    (await request.delete(`/api/admin/ml-providers/login/${job.id}`, { headers })).status(),
  ).toBeLessThan(300);
  expect(
    (
      await request.post(`/api/admin/ml-providers/login/${job.id}`, {
        headers,
        data: { input: 'fake-code' },
      })
    ).status(),
  ).toBe(409);
  await request.delete(`/api/admin/ml-providers/${connection.id}`, { headers });
});

test('owner provider screen reflows in both themes at all required viewports', async ({
  page,
  request,
  context,
  baseURL,
}) => {
  const account = await register(request, baseURL!);
  await verify(request, account.email, baseURL!);
  await makeOwner(account.id);
  await login(request, account.email, baseURL!);
  await context.addCookies((await request.storageState()).cookies);
  const populated = await request.post('/api/admin/ml-providers', {
    headers: originHeaders(baseURL!),
    data: {
      name: 'Long connection name '.repeat(4).trim(),
      provider: 'openai',
      apiKey: 'acceptance-only-not-a-vendor-key',
      manualModels: ['model-with-a-long-identifier-'.repeat(5)],
    },
  });
  expect(populated.status(), await populated.text()).toBeLessThan(300);
  const { connection } = await populated.json();
  // Long catalog stub: the preview must stay bounded and never reach a real provider.
  const longCatalog = ok(
    ...Array.from(
      { length: 40 },
      (_, index) => `vendor/responsive-model-with-a-long-identifier-${index}-${'x'.repeat(40)}`,
    ),
  );
  const discoveryCalls = await interceptDiscovery(page, (_, route) => fulfill(route, longCatalog));
  const viewports = [
    [375, 667],
    [440, 956],
    [768, 1024],
    [960, 1440],
    [1280, 800],
    [1440, 900],
  ];
  for (const theme of ['light', 'dark']) {
    await page.addInitScript((value) => localStorage.setItem('theme', value), theme);
    for (const [width, height] of viewports) {
      await page.setViewportSize({ width, height });
      await page.goto('/admin/ml-providers');
      await expect(page.getByRole('heading', { name: /ML providers/i }).first()).toBeVisible();
      await expect(
        page.getByText('Long connection name '.repeat(4).trim(), { exact: true }),
      ).toBeVisible();
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
        .toBe(true);
      await page.getByRole('button', { name: 'Add connection', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Add connection' });
      await expect(dialog).toBeVisible();
      await dialog.getByLabel('Name', { exact: true }).fill('Responsive connection');
      await dialog.getByLabel('API key', { exact: true }).fill('acceptance-only-key');
      const preview = dialog.getByRole('region', { name: 'Model preview' });
      await expect(preview.getByText('Available models (40)')).toBeVisible();
      await expect(
        preview.getByRole('list', { name: 'Discovered models' }).getByRole('listitem'),
      ).toHaveCount(40);
      const save = dialog.getByRole('button', { name: /save/i });
      await save.scrollIntoViewIfNeeded();
      await expect(save).toBeVisible();
      const bounds = await dialog.boundingBox();
      expect(bounds).not.toBeNull();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width + 1);
      expect(bounds!.y).toBeGreaterThanOrEqual(0);
      expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(height + 1);
      const saveBounds = await save.boundingBox();
      expect(saveBounds).not.toBeNull();
      expect(saveBounds!.y).toBeGreaterThanOrEqual(0);
      expect(saveBounds!.y + saveBounds!.height).toBeLessThanOrEqual(height + 1);
      await page.screenshot({ path: `/tmp/jarxis-discover-dialog-${theme}-${width}.png` });
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
      await page.screenshot({ path: `/tmp/jarxis-ml-${theme}-${width}.png`, fullPage: true });
    }
  }
  expect(discoveryCalls.length).toBeGreaterThan(0);
  await request.delete(`/api/admin/ml-providers/${connection.id}`, {
    headers: originHeaders(baseURL!),
  });
});

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test('model preview debounces credential input and ignores name and priority edits', async ({
  page,
  request,
  context,
  baseURL,
}) => {
  await ownerSession(request, context, baseURL!);
  const calls = await interceptDiscovery(page, (_, route) =>
    fulfill(route, ok('preview-a', 'preview-b')),
  );
  const { dialog, preview } = await openCreateDialog(page);
  await expect(preview).toContainText('Enter an API key to preview available models.');
  const apiKey = dialog.getByLabel('API key', { exact: true });
  await apiKey.fill('abc');
  await page.waitForTimeout(300);
  expect(calls).toHaveLength(0);
  await apiKey.pressSequentially('-acceptance-only-key', { delay: 60 });
  const models = preview.getByRole('list', { name: 'Discovered models' }).getByRole('listitem');
  await expect(models).toHaveCount(2);
  expect(calls).toEqual([{ provider: 'openai', apiKey: 'abc-acceptance-only-key' }]);

  await dialog.getByLabel('Name', { exact: true }).fill('Renamed preview connection');
  await dialog.getByLabel('Priority', { exact: true }).fill('7');
  await dialog.getByLabel(/Manual model IDs/).fill('manual-one');
  await settle(page);
  expect(calls).toHaveLength(1);
  await expect(preview).toContainText('Available models (2)');

  await dialog.getByLabel(/Base URL/).fill('https://gateway.example.test/v1');
  await expect.poll(() => calls.length).toBe(2);
  expect(calls[1]).toEqual({
    provider: 'openai',
    apiKey: 'abc-acceptance-only-key',
    baseUrl: 'https://gateway.example.test/v1',
  });

  await dialog.getByRole('combobox', { name: 'Provider' }).click();
  await page.getByRole('option', { name: 'custom', exact: true }).click();
  await expect(preview).toContainText('Enter an API key and an HTTPS base URL');
  await apiKey.fill('custom-acceptance-key');
  await dialog.getByLabel(/Base URL/).fill('http://insecure.example.test/v1');
  await settle(page);
  expect(calls).toHaveLength(2);
  await dialog.getByLabel(/Base URL/).fill('https://custom.example.test/v1');
  await expect.poll(() => calls.length).toBe(3);
  expect(calls[2]).toEqual({
    provider: 'custom',
    apiKey: 'custom-acceptance-key',
    baseUrl: 'https://custom.example.test/v1',
  });

  await dialog.getByRole('combobox', { name: 'Provider' }).click();
  await page.getByRole('option', { name: 'codex', exact: true }).click();
  await expect(preview).toHaveCount(0);
  await settle(page);
  expect(calls).toHaveLength(3);
});

test('model preview discards stale successes and failures', async ({
  page,
  request,
  context,
  baseURL,
}) => {
  await ownerSession(request, context, baseURL!);
  await ignoreDiscoveryAbort(page);
  const calls = await interceptDiscovery(page, async (body, route) => {
    if (body.apiKey === 'stale-success-key') {
      await delay(1500);
      return fulfill(route, ok('stale-model'));
    }
    if (body.apiKey === 'stale-failure-key') {
      await delay(1500);
      return fulfill(route, { status: 'failed', models: [], error: 'stale' }, 502);
    }
    return fulfill(route, ok('fresh-model'));
  });
  const { dialog, preview } = await openCreateDialog(page);
  const apiKey = dialog.getByLabel('API key', { exact: true });

  await apiKey.fill('stale-success-key');
  await expect.poll(() => calls.length).toBe(1);
  await apiKey.fill('fresh-key');
  await expect(preview.getByText('fresh-model name')).toBeVisible();
  await delay(1500);
  await expect(preview.getByText('fresh-model name')).toBeVisible();
  await expect(preview.getByText('stale-model name')).toHaveCount(0);

  await apiKey.fill('stale-failure-key');
  await expect.poll(() => calls.length).toBe(3);
  await apiKey.fill('fresh-key');
  await expect.poll(() => calls.length).toBe(4);
  await expect(preview.getByText('fresh-model name')).toBeVisible();
  await delay(1500);
  await expect(preview.getByText('fresh-model name')).toBeVisible();
  await expect(preview.getByText('Models could not be loaded', { exact: false })).toHaveCount(0);
});

test('closing the dialog cancels the preview and retry requests the current input', async ({
  page,
  request,
  context,
  baseURL,
}) => {
  await ownerSession(request, context, baseURL!);
  await ignoreDiscoveryAbort(page);
  const calls = await interceptDiscovery(page, async (_, route, index) => {
    if (index === 0) {
      await delay(1500);
      return fulfill(route, ok('closed-model'));
    }
    if (index === 1)
      return fulfill(route, {
        status: 'failed',
        models: [],
        error: 'upstream rejected Bearer upstream-secret-detail',
      });
    return fulfill(route, ok('retried-model'));
  });
  let { dialog, preview } = await openCreateDialog(page);
  await dialog.getByLabel('API key', { exact: true }).fill('close-key');
  await expect.poll(() => calls.length).toBe(1);
  await expect(preview.getByRole('status', { name: 'Checking available models' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();

  await page.getByRole('button', { name: 'Add connection', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Add connection' });
  preview = dialog.getByRole('region', { name: 'Model preview' });
  await expect(preview).toContainText('Enter an API key to preview available models.');
  await delay(1500);
  await expect(preview.getByText('closed-model name')).toHaveCount(0);
  expect(calls).toHaveLength(1);

  await dialog.getByLabel('API key', { exact: true }).fill('retry-key');
  await expect(preview).toContainText('Models could not be loaded');
  await expect(preview).not.toContainText('upstream-secret-detail');
  await preview.getByRole('button', { name: 'Retry' }).click();
  await expect(preview.getByText('retried-model name')).toBeVisible();
  expect(calls).toHaveLength(3);
  expect(calls[2]).toEqual(calls[1]);
  expect(calls[2]).toEqual({ provider: 'openai', apiKey: 'retry-key' });
});

test('model preview shows empty, unsupported and failed catalogs safely', async ({
  page,
  request,
  context,
  baseURL,
}) => {
  await ownerSession(request, context, baseURL!);
  await interceptDiscovery(page, async (body, route) => {
    if (body.apiKey === 'empty-key') return fulfill(route, ok());
    if (body.apiKey === 'unsupported-key')
      return fulfill(route, { status: 'unsupported', models: [], error: null });
    if (body.apiKey === 'limited-key')
      return fulfill(route, {
        status: 'failed',
        models: [],
        error: 'sk-leaked-upstream-detail',
        reason: 'rate_limited',
        httpStatus: 429,
        retryAfterSeconds: 90,
      });
    if (body.apiKey === 'rejected-key')
      return fulfill(route, {
        status: 'failed',
        models: [],
        error: null,
        reason: 'auth',
        httpStatus: 401,
      });
    if (body.apiKey === 'failed-key')
      return fulfill(route, { status: 'failed', models: [], error: 'sk-leaked-upstream-detail' });
    return fulfill(route, { status: 'failed', models: [], error: 'server-side detail' }, 500);
  });
  const { dialog, preview } = await openCreateDialog(page);
  const apiKey = dialog.getByLabel('API key', { exact: true });
  await apiKey.fill('empty-key');
  await expect(preview).toContainText('No models were returned. Add model IDs manually below.');
  await expect(preview).toContainText('Available models (0)');
  await apiKey.fill('unsupported-key');
  await expect(preview).toContainText('This endpoint does not provide model discovery.');
  // A rate limit says so, with the wait, instead of blaming the key or URL.
  await apiKey.fill('limited-key');
  await expect(preview).toContainText(
    'The provider is rate limiting this key (HTTP 429). Try again in 2 minutes.',
  );
  await expect(preview).not.toContainText('sk-leaked-upstream-detail');
  await apiKey.fill('rejected-key');
  await expect(preview).toContainText('The provider rejected this API key (HTTP 401).');
  await apiKey.fill('failed-key');
  await expect(preview).toContainText('Models could not be loaded');
  await expect(preview).not.toContainText('sk-leaked-upstream-detail');
  await apiKey.fill('http-error-key');
  await expect(preview).toContainText('Models could not be loaded');
  await expect(preview).not.toContainText('server-side detail');
  await expect(dialog.getByLabel(/Manual model IDs/)).toBeEditable();
});

test('saving is not blocked by the preview and sends only manual models', async ({
  page,
  request,
  context,
  baseURL,
}) => {
  await ownerSession(request, context, baseURL!);
  const calls = await interceptDiscovery(page, async (body, route) => {
    if (body.apiKey === 'loading-key') {
      await delay(3000);
      return fulfill(route, ok('late-model'));
    }
    if (body.apiKey === 'failed-key')
      return fulfill(route, { status: 'failed', models: [], error: null });
    return fulfill(route, ok('preview-only-a', 'preview-only-b'));
  });
  const created: unknown[] = [];
  const outcomes = [
    { discoveryStatus: 'unsupported', models: [] },
    {
      discoveryStatus: 'ok',
      models: [
        {
          id: 'm1',
          publicId: 'p/a',
          upstreamId: 'a',
          displayName: 'a',
          enabled: true,
          discovered: true,
        },
        {
          id: 'm2',
          publicId: 'p/b',
          upstreamId: 'b',
          displayName: 'b',
          enabled: true,
          discovered: true,
        },
      ],
    },
    { discoveryStatus: 'failed', models: [] },
  ];
  await page.route('**/api/admin/ml-providers', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    created.push(route.request().postDataJSON());
    await route.fulfill({
      status: 201,
      json: {
        connection: {
          id: `preview-fixture-${created.length}`,
          name: 'Preview save',
          provider: 'openai',
          baseUrl: 'https://api.openai.com/v1',
          enabled: true,
          priority: 0,
          status: 'ready',
          ...outcomes[created.length - 1],
        },
      },
    });
  });
  const scenarios = [
    {
      apiKey: 'loading-key',
      ready: (preview: Locator) =>
        expect(preview.getByRole('status', { name: 'Checking available models' })).toBeVisible(),
      notice: 'This endpoint does not provide model discovery',
    },
    {
      apiKey: 'populated-key',
      ready: (preview: Locator) => expect(preview.getByText('preview-only-a name')).toBeVisible(),
      notice: 'Connection saved. 2 models discovered.',
    },
    {
      apiKey: 'failed-key',
      ready: (preview: Locator) => expect(preview).toContainText('Models could not be loaded'),
      notice: 'Connection saved, but model discovery failed.',
    },
  ];
  await page.goto('/admin/ml-providers');
  for (const [index, scenario] of scenarios.entries()) {
    await page.getByRole('button', { name: 'Add connection', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Add connection' });
    const preview = dialog.getByRole('region', { name: 'Model preview' });
    await dialog.getByLabel('Name', { exact: true }).fill('Preview save');
    await dialog.getByLabel('API key', { exact: true }).fill(scenario.apiKey);
    await dialog.getByLabel(/Manual model IDs/).fill('manual-only');
    await scenario.ready(preview);
    await expect.poll(() => calls.length).toBe(index + 1);
    await dialog.getByRole('button', { name: /save/i }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('status').filter({ hasText: scenario.notice })).toBeVisible();
    expect(created[index]).toEqual({
      name: 'Preview save',
      provider: 'openai',
      priority: 0,
      apiKey: scenario.apiKey,
      manualModels: ['manual-only'],
    });
  }
  expect(calls).toHaveLength(3);
  await delay(3000);
  await expect(page.getByText('late-model name')).toHaveCount(0);
});

test('provider failures show safe guidance once: toasts for page actions, inline in dialogs', async ({
  page,
  request,
  context,
  baseURL,
}) => {
  await ownerSession(request, context, baseURL!);
  const secret = `upstream-secret-${randomUUID()}`;
  const fixtureName = `Error fixture ${randomUUID().slice(0, 8)}`;
  const created = await request.post('/api/admin/ml-providers', {
    headers: originHeaders(baseURL!),
    data: { name: fixtureName, provider: 'openai', apiKey: 'acceptance-only-key' },
  });
  expect(created.status(), await created.text()).toBe(201);
  const { connection } = await created.json();
  const toasts = page.locator('[data-sonner-toast]');

  // A failed first load offers a retry instead of a blank page.
  let failList = true;
  await page.route('**/api/admin/ml-providers', (route) =>
    route.request().method() === 'GET' && failList
      ? route.fulfill({ status: 500, json: { error: { code: 'BROKEN', message: secret } } })
      : route.fallback(),
  );
  await page.goto('/admin/ml-providers');
  const loadAlert = page.getByRole('alert').filter({ hasText: 'Providers not up to date' });
  await expect(loadAlert).toBeVisible();
  failList = false;
  await loadAlert.getByRole('button', { name: 'Try again' }).click();
  await expect(loadAlert).toBeHidden();
  await expect(page.getByText(fixtureName, { exact: true })).toBeVisible();

  // A page-level action failure becomes exactly one safe toast.
  await page.route(`**/api/admin/ml-providers/${connection.id}`, (route) =>
    route.request().method() === 'PATCH'
      ? route.fulfill({ status: 503, json: { error: { code: 'UNAVAILABLE', message: secret } } })
      : route.fallback(),
  );
  await page.getByRole('switch', { name: `Enable ${fixtureName}` }).click();
  await expect(toasts).toHaveCount(1);
  await expect(toasts.first()).toContainText('temporarily unavailable');

  // A dialog failure stays inline in that dialog and does not also toast.
  await page.route('**/api/admin/ml-providers/discover', (route) =>
    route.fulfill({ json: { discovery: { status: 'ok', models: [], error: null } } }),
  );
  await page.route('**/api/admin/ml-providers', (route) =>
    route.request().method() === 'POST'
      ? route.fulfill({
          status: 400,
          json: { error: { code: 'INVALID_ENDPOINT', message: secret } },
        })
      : route.fallback(),
  );
  await page.getByRole('button', { name: 'Add connection', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Add connection' });
  await dialog.getByLabel('Name', { exact: true }).fill('Blocked endpoint');
  await dialog.getByLabel('API key', { exact: true }).fill('acceptance-only-key');
  await dialog.getByRole('button', { name: /save/i }).click();
  await expect(dialog.getByRole('alert')).toContainText('public HTTPS base URL');
  await expect(dialog).toBeVisible();
  await expect(toasts).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();

  // Reopening a dialog never carries the previous failure.
  await page.getByRole('button', { name: 'Add connection', exact: true }).click();
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  expect(await page.content()).not.toContain(secret);

  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await request.delete(`/api/admin/ml-providers/${connection.id}`, {
    headers: originHeaders(baseURL!),
  });
});
