import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ProvidersPanel } from '@/components/admin/provider/providers-panel';
import { AdminPanelHost } from '@/components/ui/admin-panel';

const root = '/api/admin/providers';
const version = 'a'.repeat(64);
const member = (id: string, upstreamId: string, alias: string | null, enabled: boolean) => ({
  id,
  publicId: alias ?? upstreamId,
  alias,
  poolId: alias ?? upstreamId,
  upstreamId,
  displayName: upstreamId,
  enabled,
  discovered: true,
});

function providerData(aliasForLegacy: string | null = null) {
  const connections = [
    {
      id: 'c1',
      name: 'Alpha',
      provider: 'openai' as const,
      baseUrl: 'https://api.openai.com/v1',
      enabled: true,
      priority: 1,
      status: 'ready',
      discoveryStatus: 'ok',
      modelStateVersion: version,
      models: [
        member('m1', 'alpha-model', 'shared-model', true),
        member('m2', 'vendor/gpt', aliasForLegacy, false),
      ],
    },
    {
      id: 'c2',
      name: 'Offline',
      provider: 'custom' as const,
      baseUrl: 'https://llm.example.com/v1',
      enabled: false,
      priority: 3,
      status: 'ready',
      discoveryStatus: 'unsupported',
      modelStateVersion: version,
      models: [member('m3', 'other-name', 'shared-model', true)],
    },
  ];
  return {
    connections,
    pools: [
      {
        id: 'shared-model',
        advertised: true,
        members: [
          {
            connectionId: 'c1',
            modelId: 'm1',
            connectionName: 'Alpha',
            provider: 'openai',
            upstreamId: 'alpha-model',
            priority: 1,
            availability: 'ready',
          },
          {
            connectionId: 'c2',
            modelId: 'm3',
            connectionName: 'Offline',
            provider: 'custom',
            upstreamId: 'other-name',
            priority: 3,
            availability: 'disabled',
          },
        ],
      },
      {
        id: 'vendor/gpt',
        advertised: false,
        members: [
          {
            connectionId: 'c1',
            modelId: 'm2',
            connectionName: 'Alpha',
            provider: 'openai',
            upstreamId: 'vendor/gpt',
            priority: 1,
            availability: 'model_disabled',
          },
        ],
      },
    ],
  };
}

type Call = { path: string; method: string; body?: unknown };
let calls: Call[];
let data: ReturnType<typeof providerData>;
let stale = false;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function failure(status: number, code: string) {
  return json({ error: { code } }, status);
}

function renderPanel(canManage = true) {
  render(
    <AdminPanelHost>
      <ProvidersPanel canManage={canManage} />
    </AdminPanelHost>,
  );
  return userEvent.setup();
}

beforeEach(() => {
  calls = [];
  data = providerData();
  stale = false;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const call: Call = {
        path: String(url).slice(root.length),
        method: init?.method ?? 'GET',
        body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
      };
      calls.push(call);
      if (call.method === 'GET') return json(data);
      if (call.path.endsWith('/alias') && stale) {
        stale = false;
        data = providerData('external-alias');
        return failure(409, 'MODEL_CATALOG_CHANGED');
      }
      if (call.path.endsWith('/alias')) {
        const body = call.body as { alias: string | null };
        data = providerData(body.alias);
        return json({ connection: data.connections[0] });
      }
      return new Response(null, { status: 204 });
    }),
  );
});

afterEach(() => vi.unstubAllGlobals());

describe('Providers model pools', () => {
  it('shows all pools and members, including disabled availability and alias warnings', async () => {
    renderPanel(false);
    expect(await screen.findByText('Model pools')).toBeTruthy();
    expect(screen.getByText('Alias required before this pool can be advertised.')).toBeTruthy();
    const shared = screen.getByRole('region', { name: 'shared-model' });
    expect(within(shared).getByText('Offline')).toBeTruthy();
    expect(within(shared).getByText('Availability: disabled')).toBeTruthy();
    const unresolved = screen.getByRole('region', { name: 'vendor/gpt' });
    expect(within(unresolved).getByText('Availability: model disabled')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Edit alias' })).toBeNull();
  });

  it('saves a validated alias with the current version and reloads provider data', async () => {
    const user = renderPanel();
    await screen.findByText('Model pools');
    const unresolved = screen.getByRole('region', { name: 'vendor/gpt' });
    await user.click(within(unresolved).getByRole('button', { name: 'Edit alias' }));
    const input = screen.getByRole('textbox', { name: 'Alias for vendor/gpt on Alpha' });
    await user.type(input, 'new.alias-2');
    expect(screen.getByRole('button', { name: 'Save alias' })).toHaveProperty('disabled', false);
    await user.click(screen.getByRole('button', { name: 'Save alias' }));
    await waitFor(() =>
      expect(calls.filter((call) => call.method === 'PATCH')).toEqual([
        {
          path: '/c1/models/m2/alias',
          method: 'PATCH',
          body: { alias: 'new.alias-2', version },
        },
      ]),
    );
    await waitFor(() => expect(calls.filter((call) => call.method === 'GET')).toHaveLength(2));
    expect(await screen.findAllByText('new.alias-2')).toHaveLength(2);
  });

  it('rejects slash aliases and cancels an unsaved edit without sending a request', async () => {
    const user = renderPanel();
    await screen.findByText('Model pools');
    const unresolved = screen.getByRole('region', { name: 'vendor/gpt' });
    await user.click(within(unresolved).getByRole('button', { name: 'Edit alias' }));
    const input = screen.getByRole('textbox', { name: 'Alias for vendor/gpt on Alpha' });
    await user.type(input, 'bad/name');
    expect(screen.getByRole('button', { name: 'Save alias' })).toHaveProperty('disabled', true);
    expect(screen.getAllByText(/Use 1–200 letters/)).toHaveLength(2);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('textbox', { name: 'Alias for vendor/gpt on Alpha' })).toBeNull();
    expect(calls.filter((call) => call.method !== 'GET')).toHaveLength(0);
  });

  it('removes an existing alias', async () => {
    data = providerData('legacy-alias');
    const user = renderPanel();
    await screen.findByText('Model pools');
    const unresolved = screen.getByRole('region', { name: 'vendor/gpt' });
    await user.click(within(unresolved).getByRole('button', { name: 'Edit alias' }));
    await user.click(screen.getByRole('button', { name: 'Remove alias' }));
    await waitFor(() =>
      expect(calls.find((call) => call.method === 'PATCH')).toMatchObject({
        path: '/c1/models/m2/alias',
        body: { alias: null, version },
      }),
    );
    await waitFor(() => expect(calls.filter((call) => call.method === 'GET')).toHaveLength(2));
    expect(await screen.findByText('None')).toBeTruthy();
  });

  it('reloads on a stale catalog and asks the owner to retry', async () => {
    stale = true;
    const user = renderPanel();
    await screen.findByText('Model pools');
    const unresolved = screen.getByRole('region', { name: 'vendor/gpt' });
    await user.click(within(unresolved).getByRole('button', { name: 'Edit alias' }));
    const input = screen.getByRole('textbox', { name: 'Alias for vendor/gpt on Alpha' });
    await user.type(input, 'my-draft');
    await user.click(screen.getByRole('button', { name: 'Save alias' }));
    expect(
      await screen.findByText(
        'Models changed. The latest data is loaded; review the alias and retry.',
      ),
    ).toBeTruthy();
    expect(input).toHaveProperty('value', 'my-draft');
    expect(calls.filter((call) => call.method === 'GET')).toHaveLength(2);
    expect(screen.getByText('Alias required before this pool can be advertised.')).toBeTruthy();
  });
});

it('bounds pool rendering and searches across all pages', async () => {
  data = providerData();
  const template = data.pools[0];
  data.pools = Array.from({ length: 26 }, (_, i) => ({
    ...template,
    id: `pool-${String(i).padStart(2, '0')}`,
  }));
  const user = renderPanel();
  await screen.findByText('Model pools');
  expect(screen.queryByRole('region', { name: 'pool-25' })).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Next pools' }));
  expect(screen.getByRole('region', { name: 'pool-25' })).toBeTruthy();
  expect(screen.queryByRole('region', { name: 'pool-00' })).toBeNull();
  await user.type(screen.getByRole('textbox', { name: 'Search model pools' }), 'pool-00');
  expect(screen.getByRole('region', { name: 'pool-00' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Next pools' })).toBeNull();
});
