import { expect } from '@playwright/test';
import { test } from './fixtures';
import { login, makeOwner, register, verify } from './helpers';

const viewports = [
  { width: 375, height: 667 },
  { width: 440, height: 956 },
  { width: 768, height: 1024 },
  { width: 960, height: 1440 },
  { width: 1280, height: 800 },
  { width: 1440, height: 900 },
];

test('owner pool view and alias controls fit six viewports in both themes', async ({
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
  const model = {
    id: 'm1',
    publicId: 'openrouter/openai/gpt-4.1',
    upstreamId: 'openai/gpt-4.1',
    displayName: 'GPT 4.1',
    alias: null as string | null,
    poolId: 'openai/gpt-4.1',
    enabled: true,
    discovered: true,
  };
  const connection = {
    id: 'c1',
    name: 'OpenRouter integration connection',
    provider: 'openrouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    enabled: true,
    priority: 0,
    status: 'ready',
    discoveryStatus: 'ok',
    modelStateVersion: 'a'.repeat(64),
    models: [model],
  };
  const data = () => ({
    connections: [connection],
    keys: [],
    pools: [
      {
        id: model.poolId,
        advertised: model.alias !== null,
        members: [
          {
            connectionId: 'c1',
            modelId: 'm1',
            connectionName: connection.name,
            provider: 'openrouter',
            upstreamId: model.upstreamId,
            priority: 0,
            availability: 'ready',
          },
        ],
      },
    ],
  });
  await page.route('**/api/admin/providers', (route) => route.fulfill({ json: data() }));
  let changes = 0;
  await page.route('**/api/admin/providers/c1/models/m1/alias', async (route) => {
    const value = route.request().postDataJSON() as { alias: string | null; version: string };
    expect(value.version).toBe(connection.modelStateVersion);
    model.alias = value.alias;
    model.poolId = value.alias ?? model.upstreamId;
    connection.modelStateVersion = (++changes % 2 ? 'b' : 'a').repeat(64);
    await route.fulfill({ json: { connection } });
  });
  await page.goto('/admin/providers');
  await expect(page.getByText('Model pools', { exact: true })).toBeVisible();
  for (const theme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await page.evaluate((value) => {
      document.documentElement.classList.remove('light', 'dark');
      document.documentElement.classList.add(value);
    }, theme);
    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      const pools = page
        .locator('[data-slot=card]')
        .filter({ has: page.getByText('Model pools', { exact: true }) });
      await expect(pools).toBeVisible();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
      await expect(
        pools.getByText('Alias required before this pool can be advertised.', { exact: true }),
      ).toBeVisible();
      await pools.getByRole('button', { name: 'Edit alias', exact: true }).click();
      const aliasInput = pools.getByRole('textbox', { name: /Alias for/ });
      await aliasInput.fill('invalid/name');
      await expect(pools.getByRole('button', { name: 'Save alias' })).toBeDisabled();
      await aliasInput.focus();
      await expect(aliasInput).toBeFocused();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
      await pools.getByRole('button', { name: 'Cancel', exact: true }).click();
    }
  }
  // The exact alias controls are also covered by RTL; exercise the browser wiring here.
  const pools = page
    .locator('[data-slot=card]')
    .filter({ has: page.getByText('Model pools', { exact: true }) });
  await pools
    .getByRole('button', { name: /edit alias|set alias/i })
    .first()
    .click();
  const input = pools.getByRole('textbox', { name: /Alias for/ });
  await input.fill('gpt-4.1');
  await pools.getByRole('button', { name: /save/i }).first().click();
  await expect.poll(() => changes).toBe(1);
  await expect(
    pools.getByText('Alias required before this pool can be advertised.', { exact: true }),
  ).toHaveCount(0);
  await page.screenshot({ path: '/tmp/jar14-pools-desktop.png', fullPage: true });
  await page.setViewportSize(viewports[0]);
  await page.screenshot({ path: '/tmp/jar14-pools-mobile.png', fullPage: true });
});
