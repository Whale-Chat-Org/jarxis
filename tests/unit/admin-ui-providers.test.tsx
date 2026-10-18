import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ProvidersPanel } from '@/components/admin/provider/providers-panel';
import { AdminPanelHost } from '@/components/ui/admin-panel';

const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));

vi.mock('sonner', () => ({ toast }));

vi.mock('next/navigation', () => ({ usePathname: () => '/admin/providers' }));

type Call = { path: string; method: string; body?: unknown };
type Handler = (call: Call) => Response | Promise<Response>;

const root = '/api/admin/providers';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
function failure(status: number, code?: string) {
  return json(code ? { error: { code } } : {}, status);
}

const connections = [
  {
    id: 'c1',
    name: 'Primary',
    provider: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    enabled: true,
    priority: 1,
    status: 'needs_attention',
    discoveryStatus: 'failed',
    discoveryError: 'upstream broke',
    lastDiscoveredAt: '2026-01-01T00:00:00.000Z',
    modelStateVersion: 'a'.repeat(64),
    models: [
      {
        id: 'm1',
        publicId: 'openai/gpt',
        upstreamId: 'gpt',
        displayName: 'GPT',
        enabled: true,
        discovered: true,
      },
      {
        id: 'm2',
        publicId: 'openai/manual',
        upstreamId: 'manual',
        displayName: 'Manual one',
        enabled: false,
        discovered: false,
      },
    ],
  },
  {
    id: 'c2',
    name: 'Custom',
    provider: 'custom',
    baseUrl: 'https://llm.example.com/v1',
    enabled: false,
    priority: 0,
    status: 'ok',
    discoveryStatus: 'unsupported',
    discoveryError: null,
    lastDiscoveredAt: null,
    modelStateVersion: 'b'.repeat(64),
    models: [],
  },
];
const keys = [
  {
    id: 'k1',
    name: 'CI key',
    prefix: 'jx_ab',
    revokedAt: null,
    lastUsedAt: '2026-01-02T00:00:00Z',
  },
  {
    id: 'k2',
    name: 'Old key',
    prefix: 'jx_cd',
    revokedAt: '2026-01-03T00:00:00Z',
    lastUsedAt: null,
  },
];
const fullData = { connections, keys };

let calls: Call[];
let handler: Handler;

function setup(next: Handler) {
  handler = next;
}
function defaultHandler(data: unknown = fullData): Handler {
  return ({ path, method }) => {
    if (path === '' && method === 'GET') return json(data);
    if (path === '/c1/models' && method === 'PATCH') return json({ connection: connections[0] });
    return new Response(null, { status: 204 });
  };
}

beforeEach(() => {
  calls = [];
  handler = defaultHandler();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const call: Call = {
        path: String(url).slice(root.length),
        method: init?.method ?? 'GET',
        body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
      };
      calls.push(call);
      return handler(call);
    }),
  );
  toast.error.mockReset();
  toast.success.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function renderPanel(canManage = true) {
  const user = userEvent.setup();
  render(
    <AdminPanelHost>
      <ProvidersPanel canManage={canManage} />
    </AdminPanelHost>,
  );
  return user;
}

const nonGet = () => calls.filter((call) => call.method !== 'GET');

describe('ProvidersPanel listing', () => {
  it('opens view mode and preserves fields when switching to edit', async () => {
    const user = renderPanel();
    await screen.findByText('Primary');
    await user.click(screen.getAllByRole('button', { name: 'View' })[0]);
    const name = await screen.findByLabelText('Name', { exact: true });
    expect(name.matches(':disabled')).toBe(true);
    expect(name).toHaveProperty('value', 'Primary');
    await user.click(screen.getByRole('button', { name: 'Edit connection' }));
    expect(name.matches(':disabled')).toBe(false);
    expect(name).toHaveProperty('value', 'Primary');
  });

  it('blocks pending dismissal and duplicate saves, then retains a failed draft', async () => {
    let release!: (response: Response) => void;
    const pending = new Promise<Response>((resolve) => {
      release = resolve;
    });
    setup(({ path, method }) => (path === '' && method === 'GET' ? json(fullData) : pending));
    const user = renderPanel();
    await screen.findByText('Primary');
    await user.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
    const name = await screen.findByLabelText('Name', { exact: true });
    await user.clear(name);
    await user.type(name, 'Unsaved draft');
    const save = screen.getByRole('button', { name: 'Save connection' });
    await user.click(save);
    await user.click(save);
    await user.keyboard('{Escape}');
    expect(screen.getByLabelText('Name', { exact: true })).toHaveProperty('value', 'Unsaved draft');
    expect(nonGet()).toHaveLength(1);
    await act(async () => {
      release(failure(503, 'UNAVAILABLE'));
    });
    await screen.findByRole('alert');
    expect(screen.getByLabelText('Name', { exact: true })).toHaveProperty('value', 'Unsaved draft');
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('shows the loading skeleton, then connections, models and keys', async () => {
    renderPanel();
    expect(screen.getByText('Loading providers…')).toBeTruthy();
    expect(await screen.findByText('Primary')).toBeTruthy();

    expect(screen.getByText('openai · https://api.openai.com/v1')).toBeTruthy();
    expect(screen.getByText('needs attention')).toBeTruthy();
    expect(screen.getByText('Discovery: failed')).toBeTruthy();
    expect(screen.getByText('Priority 1')).toBeTruthy();
    expect(screen.getByText('Discovery failed: upstream broke')).toBeTruthy();
    expect(screen.getByText(/Last discovery:/)).toBeTruthy();
    expect(screen.getByText('Models (1/2)')).toBeTruthy();
    expect(screen.getByText('Discovered')).toBeTruthy();
    expect(screen.getByText('Manual')).toBeTruthy();

    expect(
      screen.getByText('This endpoint does not provide model discovery. Enter model IDs manually.'),
    ).toBeTruthy();
    expect(screen.getByText(/No catalog discovered yet\./)).toBeTruthy();
    expect(
      screen.getByText(
        'No models yet. Refresh the catalog, or add an upstream model ID from Edit.',
      ),
    ).toBeTruthy();

    expect(screen.queryByText('Gateway keys')).toBeNull();
    expect(screen.queryByText('CI key')).toBeNull();
    expect(screen.getByRole('button', { name: 'Add connection' })).toBeTruthy();
    expect(calls[0]).toEqual({ path: '', method: 'GET', body: undefined });
  });

  it('is read-only without the manage grant', async () => {
    renderPanel(false);
    await screen.findByText('Primary');
    expect(screen.queryByRole('button', { name: 'Add connection' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Revoke' })).toBeNull();
    expect(screen.queryByLabelText('Key name')).toBeNull();
    expect(screen.queryAllByLabelText('Manual upstream model ID')).toHaveLength(0);
    const toggle = screen.getByRole('switch', { name: 'Enable Primary' });
    expect(toggle.hasAttribute('disabled')).toBe(true);
  });

  it('shows empty states', async () => {
    setup(defaultHandler({ connections: [], keys: [] }));
    renderPanel();
    expect(await screen.findByText('No provider connections')).toBeTruthy();
    expect(screen.queryByText('Gateway keys')).toBeNull();
  });

  it('shows a load error and recovers on retry', async () => {
    let fail = true;
    setup(({ method }) => {
      if (method === 'GET' && fail) return failure(500);
      return json(fullData);
    });
    const user = renderPanel();
    expect(
      await screen.findByText(
        'Providers could not be loaded. Check your connection and try again.',
      ),
    ).toBeTruthy();
    expect(screen.getByText('Providers not up to date')).toBeTruthy();

    // A failed retry has no dialog, so it is reported as a toast.
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('Providers could not be loaded. Try again shortly.'),
    );

    fail = false;
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Primary')).toBeTruthy();
    expect(screen.queryByText('Providers not up to date')).toBeNull();
  });

  it('reloads on demand', async () => {
    const user = renderPanel();
    await screen.findByText('Primary');
    await user.click(screen.getByRole('button', { name: 'Reload' }));
    await waitFor(() => expect(calls.filter((call) => call.method === 'GET')).toHaveLength(2));
  });

  it('polls pending discovery and reports a failed refresh', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let gets = 0;
    setup(({ method }) => {
      if (method !== 'GET') return new Response(null, { status: 204 });
      gets += 1;
      if (gets === 1)
        return json({ connections: [{ ...connections[1], discoveryStatus: 'pending' }], keys: [] });
      return failure(503);
    });
    renderPanel();
    await screen.findByText('Discovery: pending');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15000);
    });
    expect(
      await screen.findByText(
        'Discovery status could not be refreshed. Showing the last loaded data.',
      ),
    ).toBeTruthy();
    expect(gets).toBe(2);
  });
});

describe('ProvidersPanel page actions', () => {
  it('toggles a connection and reloads', async () => {
    const user = renderPanel();
    await screen.findByText('Primary');
    await user.click(screen.getByRole('switch', { name: 'Enable Primary' }));
    await waitFor(() =>
      expect(nonGet()).toEqual([{ path: '/c1', method: 'PATCH', body: { enabled: false } }]),
    );
    await waitFor(() => expect(calls.filter((call) => call.method === 'GET')).toHaveLength(2));
  });

  it('schedules a refresh and shows a notice', async () => {
    const user = renderPanel();
    await screen.findByText('Primary');
    await user.click(screen.getAllByRole('button', { name: 'Refresh models' })[0]);
    expect(await screen.findByText('Discovery scheduled.')).toBeTruthy();
    expect(nonGet()).toEqual([{ path: '/c1/refresh', method: 'POST', body: undefined }]);
  });

  it('toasts a mapped error when a page action fails', async () => {
    setup(({ method }) => (method === 'GET' ? json(fullData) : failure(404, 'NOT_FOUND')));
    const user = renderPanel();
    await screen.findByText('Primary');
    await user.click(screen.getAllByRole('button', { name: 'Refresh models' })[1]);
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        'This item no longer exists. Reload to see the latest providers.',
      ),
    );
  });

  it('adds a manual model from the edit panel and keeps unsaved toggles', async () => {
    const added = {
      ...connections[0],
      modelStateVersion: 'c'.repeat(64),
      models: [
        ...connections[0].models,
        {
          id: 'm3',
          publicId: 'openai/gpt-extra',
          upstreamId: 'gpt-extra',
          displayName: 'gpt-extra',
          enabled: true,
          discovered: false,
        },
      ],
    };
    setup(({ path, method }) => {
      if (path === '' && method === 'GET') return json(fullData);
      if (path === '/c1/models' && method === 'POST') return json({ connection: added }, 201);
      return json({ connection: added });
    });
    const user = renderPanel();
    await screen.findByText('Primary');
    expect(screen.queryAllByLabelText('Manual upstream model ID')).toHaveLength(0);
    await user.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
    await user.click(await screen.findByRole('switch', { name: 'Enable GPT (openai/gpt)' }));
    const input = screen.getByLabelText('Manual upstream model ID') as HTMLInputElement;
    expect(screen.getByRole('button', { name: 'Add model' })).toHaveProperty('disabled', true);
    await user.type(input, '  gpt-extra  {Enter}');
    await waitFor(() =>
      expect(nonGet()).toEqual([
        { path: '/c1/models', method: 'POST', body: { upstreamId: 'gpt-extra' } },
      ]),
    );
    await waitFor(() => expect(input.value).toBe(''));
    expect(await screen.findByText('Model gpt-extra added.')).toBeTruthy();
    expect(
      screen.getByRole('switch', { name: 'Enable GPT (openai/gpt)' }).getAttribute('aria-checked'),
    ).toBe('false');
    expect(
      screen.getByRole('switch', { name: 'Enable gpt-extra (openai/gpt-extra)' }),
    ).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Save connection' }));
    // Sorted m1, m2, m3 with only m3 enabled: 0b100.
    await waitFor(() =>
      expect(nonGet().at(-1)).toEqual({
        path: '/c1/models',
        method: 'PATCH',
        body: { version: 'c'.repeat(64), states: 'BA' },
      }),
    );
  });

  it('keeps the loaded version after adding a model when others changed concurrently', async () => {
    const changed = {
      ...connections[0],
      modelStateVersion: 'd'.repeat(64),
      models: connections[0].models.map((model) => ({ ...model, enabled: !model.enabled })),
    };
    setup(({ path, method }) => {
      if (path === '' && method === 'GET') return json(fullData);
      if (path === '/c1/models' && method === 'POST') return json({ connection: changed }, 201);
      return json({ connection: changed });
    });
    const user = renderPanel();
    await screen.findByText('Primary');
    await user.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
    await user.type(await screen.findByLabelText('Manual upstream model ID'), 'other');
    await user.click(screen.getByRole('button', { name: 'Add model' }));
    await screen.findByText('Model other added.');
    await user.click(screen.getByRole('button', { name: 'Save connection' }));
    await waitFor(() =>
      expect(nonGet().at(-1)).toEqual({
        path: '/c1/models',
        method: 'PATCH',
        body: { version: 'a'.repeat(64), states: 'AQ' },
      }),
    );
  });

  it('keeps credential autofill off the editor inputs', async () => {
    const user = renderPanel();
    await screen.findByText('Primary');
    await user.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
    const key = (await screen.findByLabelText('Replace API key (optional)')) as HTMLInputElement;
    expect(key.autocomplete).toBe('new-password');
    expect(key.placeholder).toBe('Saved key is kept unless you enter a new one');
    expect(key.getAttribute('data-1p-ignore')).toBe('true');
    const search = screen.getByLabelText('Search models') as HTMLInputElement;
    expect(search.autocomplete).toBe('off');
    expect(search.getAttribute('data-lpignore')).toBe('true');
  });
});

describe('ProvidersPanel confirmations', () => {
  it('deletes a connection after confirmation', async () => {
    const user = renderPanel();
    await screen.findByText('Primary');
    await user.click(screen.getAllByRole('button', { name: 'Delete' })[0]);
    expect(await screen.findByText('Delete connection?')).toBeTruthy();
    expect(screen.getByText('Primary: This removes the account and all its models.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() =>
      expect(nonGet()).toEqual([{ path: '/c1', method: 'DELETE', body: undefined }]),
    );
    await waitFor(() => expect(screen.queryByText('Delete connection?')).toBeNull());
  });

  it('keeps a failed delete inline in the dialog and closes on cancel', async () => {
    setup(({ method }) => (method === 'GET' ? json(fullData) : failure(403, 'FORBIDDEN')));
    const user = renderPanel();
    await screen.findByText('Primary');
    await user.click(screen.getAllByRole('button', { name: 'Delete' })[1]);
    await user.click(await screen.findByRole('button', { name: 'Confirm' }));
    expect(await screen.findByText('Only owners can manage Providers.')).toBeTruthy();
    expect(toast.error).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByText('Delete connection?')).toBeNull());
  });
});

describe('ProvidersPanel connection editor', () => {
  async function openCreate() {
    const user = renderPanel();
    await screen.findByText('Primary');
    await user.click(screen.getByRole('button', { name: 'Add connection' }));
    await screen.findByText('Connect a provider using an API key.');
    return user;
  }

  it('previews discovered models and creates a connection', async () => {
    setup(({ path, method }) => {
      if (method === 'GET') return json(fullData);
      if (path === '/discover')
        return json({
          discovery: {
            status: 'ok',
            models: [{ id: 'gpt-4o', name: 'GPT 4o' }, { id: 'plain' }, { id: '' }, null],
          },
        });
      return json(
        {
          connection: {
            ...connections[0],
            discoveryStatus: 'ok',
            models: [connections[0].models[0]],
          },
        },
        201,
      );
    });
    const user = await openCreate();
    expect(screen.getByText('Enter an API key to preview available models.')).toBeTruthy();

    await user.type(screen.getByLabelText('Name'), ' New one ');
    await user.type(screen.getByLabelText('API key'), 'sk-test');
    await user.clear(screen.getByLabelText('Priority'));
    await user.type(screen.getByLabelText('Priority'), '5');
    await user.type(screen.getByLabelText(/Manual model IDs/), 'a{enter} {enter}b');

    expect(await screen.findByText('Available models (2)', {}, { timeout: 3000 })).toBeTruthy();
    const list = screen.getByRole('list', { name: 'Discovered models' });
    expect(within(list).getByText('GPT 4o')).toBeTruthy();
    expect(within(list).getByText('gpt-4o')).toBeTruthy();
    expect(within(list).getAllByText('plain')).toHaveLength(1);
    expect(calls.find((call) => call.path === '/discover')?.body).toEqual({
      provider: 'openai',
      apiKey: 'sk-test',
    });

    await user.click(screen.getByRole('button', { name: 'Save connection' }));
    expect(await screen.findByText('Connection saved. 1 model discovered.')).toBeTruthy();
    expect(calls.find((call) => call.path === '' && call.method === 'POST')?.body).toEqual({
      name: 'New one',
      provider: 'openai',
      priority: 5,
      apiKey: 'sk-test',
      manualModels: ['a', 'b'],
    });
    await waitFor(() =>
      expect(screen.queryByText('Connect a provider using an API key.')).toBeNull(),
    );
  });

  it.each([
    [{ discoveryStatus: 'ok', models: [] }, 'Connection saved. 0 models discovered.'],
    [
      { discoveryStatus: 'unsupported', models: [] },
      'Connection saved. This endpoint does not provide model discovery; manual models remain available.',
    ],
    [
      { discoveryStatus: 'failed', models: [] },
      'Connection saved, but model discovery failed. Use Refresh models to retry.',
    ],
    [
      { discoveryStatus: 'pending', models: [] },
      'Connection saved. Model discovery is scheduled automatically.',
    ],
  ])('reports the creation result %#', async (connection, notice) => {
    setup(({ path, method }) => {
      if (method === 'GET') return json(fullData);
      if (path === '/discover') return json({ discovery: { status: 'unsupported' } });
      return json(connection ? { connection: { ...connections[1], ...connection } } : {}, 201);
    });
    const user = await openCreate();
    await user.type(screen.getByLabelText('Name'), 'X');
    await user.type(screen.getByLabelText('API key'), 'k');
    await user.click(screen.getByRole('button', { name: 'Save connection' }));
    expect(await screen.findByText(notice)).toBeTruthy();
  });

  it.each([
    [
      { discovery: { status: 'unsupported' } },
      'This endpoint does not provide model discovery. Add model IDs manually below.',
    ],
    [
      { discovery: { status: 'ok', models: [] } },
      'No models were returned. Add model IDs manually below.',
    ],
    [
      {
        discovery: {
          status: 'failed',
          reason: 'rate_limited',
          httpStatus: 429,
          retryAfterSeconds: 30,
        },
      },
      'The provider is rate limiting this key (HTTP 429). Try again in 30 seconds.',
    ],
    [
      { discovery: { status: 'failed', reason: 'auth', httpStatus: 1.5 } },
      'The provider rejected this API key. Check that the key is valid and allowed to list models.',
    ],
    [
      { discovery: { status: 'failed', reason: 'mystery' } },
      'Models could not be loaded. Retry, or add model IDs manually.',
    ],
    [{ discovery: 'nope' }, 'Models could not be loaded. Retry, or add model IDs manually.'],
    [null, 'Models could not be loaded. Retry, or add model IDs manually.'],
  ])('renders preview outcome %#', async (response, text) => {
    setup(({ path, method }) => {
      if (method === 'GET') return json(fullData);
      if (path === '/discover') return json(response);
      return new Response(null, { status: 204 });
    });
    const user = await openCreate();
    await user.type(screen.getByLabelText('API key'), 'sk');
    expect(await screen.findByText(text, {}, { timeout: 3000 })).toBeTruthy();
  });

  it('maps a failed preview request and retries immediately', async () => {
    let attempts = 0;
    setup(({ path, method }) => {
      if (method === 'GET') return json(fullData);
      if (path === '/discover') {
        attempts += 1;
        return attempts === 1
          ? failure(429, 'RATE_LIMITED')
          : json({ discovery: { status: 'ok', models: [{ id: 'm', name: 'Model M' }] } });
      }
      return new Response(null, { status: 204 });
    });
    const user = await openCreate();
    await user.type(screen.getByLabelText('API key'), 'sk');
    expect(
      await screen.findByText(
        'Too many requests. Wait a minute and try again.',
        {},
        { timeout: 3000 },
      ),
    ).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Model M')).toBeTruthy();
    expect(attempts).toBe(2);
  });

  it('asks custom providers for an HTTPS base URL', async () => {
    const user = await openCreate();
    await user.click(screen.getByRole('combobox'));
    await user.click(await screen.findByRole('option', { name: 'custom' }));
    expect(
      await screen.findByText(
        'Enter an API key and an HTTPS base URL to preview available models.',
      ),
    ).toBeTruthy();
    const url = screen.getByLabelText(/Base URL/) as HTMLInputElement;
    expect(url.required).toBe(true);
    await user.type(screen.getByLabelText('API key'), 'sk');
    await user.type(url, 'http://insecure.example.com');
    // Not HTTPS, so no preview is requested.
    expect(
      screen.getByText('Enter an API key and an HTTPS base URL to preview available models.'),
    ).toBeTruthy();
    await user.clear(url);
    await user.type(url, 'https://llm.example.com/v1');
    await screen.findByText('Checking available models…');
    await waitFor(
      () =>
        expect(calls.find((call) => call.path === '/discover')?.body).toEqual({
          provider: 'custom',
          apiKey: 'sk',
          baseUrl: 'https://llm.example.com/v1',
        }),
      { timeout: 3000 },
    );
  });

  it('keeps a failed save inline and cancels cleanly', async () => {
    setup(({ path, method }) => {
      if (method === 'GET') return json(fullData);
      if (path === '/discover') return json({ discovery: { status: 'unsupported' } });
      return failure(400, 'VALIDATION_ERROR');
    });
    const user = await openCreate();
    await user.type(screen.getByLabelText('Name'), 'X');
    await user.type(screen.getByLabelText('API key'), 'k');
    await user.click(screen.getByRole('button', { name: 'Save connection' }));
    expect(
      await screen.findByText('Some details are invalid. Check the form and try again.'),
    ).toBeTruthy();
    expect(toast.error).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() =>
      expect(screen.queryByText('Connect a provider using an API key.')).toBeNull(),
    );
  });

  it('edits an existing connection without provider or manual models', async () => {
    const user = renderPanel();
    await screen.findByText('Primary');
    await user.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
    expect(await screen.findByText('Edit connection')).toBeTruthy();
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Primary');
    expect(screen.getByLabelText('Replace API key (optional)')).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Model preview' })).toBeNull();
    expect(screen.queryByLabelText(/Manual model IDs/)).toBeNull();

    await user.clear(screen.getByLabelText('Name'));
    await user.type(screen.getByLabelText('Name'), 'Renamed');
    await user.click(screen.getByRole('button', { name: 'Save connection' }));
    expect(await screen.findByText('Connection saved.')).toBeTruthy();
    expect(nonGet()).toEqual([
      {
        path: '/c1/models',
        method: 'PATCH',
        body: { version: 'a'.repeat(64), states: 'AQ', connection: { name: 'Renamed' } },
      },
    ]);
  });

  it('stages model switches and bulk changes only for search results until Save', async () => {
    const user = renderPanel();
    await screen.findByText('Primary');
    await user.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
    const models = screen.getByRole('region', { name: 'Connection models' });
    expect(within(models).getByText('Models (1/2)')).toBeTruthy();
    await user.type(within(models).getByRole('searchbox', { name: 'Search models' }), 'manual');
    expect(within(models).queryByRole('switch', { name: /GPT/ })).toBeNull();
    await user.click(within(models).getByRole('button', { name: 'Enable all' }));
    expect(within(models).getByText('Models (2/2)')).toBeTruthy();
    await user.click(within(models).getByRole('button', { name: 'Disable all' }));
    expect(within(models).getByText('Models (1/2)')).toBeTruthy();
    await user.click(within(models).getByRole('switch', { name: /Manual one/ }));
    expect(within(models).getByText('Models (2/2)')).toBeTruthy();
    expect(nonGet()).toEqual([]);
    await user.click(screen.getByRole('button', { name: 'Save connection' }));
    await screen.findByText('Connection saved.');
    expect(nonGet()).toEqual([
      { path: '/c1/models', method: 'PATCH', body: { version: 'a'.repeat(64), states: 'Aw' } },
    ]);
  });

  it('discards model changes on Cancel and hides the API key field', async () => {
    const user = renderPanel();
    await screen.findByText('Primary');
    await user.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
    const key = screen.getByLabelText('Replace API key (optional)') as HTMLInputElement;
    expect(key.type).toBe('password');
    await user.type(key, 'fake-key');
    await user.click(screen.getByRole('button', { name: 'Show API key' }));
    expect(key.type).toBe('text');
    await user.click(screen.getByRole('switch', { name: /Manual one/ }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(nonGet()).toEqual([]);
    await waitFor(() => expect(screen.queryByLabelText('Replace API key (optional)')).toBeNull());
  });

  it('toggles the add form API key by keyboard with accessible labels', async () => {
    const user = await openCreate();
    const key = screen.getByLabelText('API key') as HTMLInputElement;
    expect(key.type).toBe('password');
    const reveal = screen.getByRole('button', { name: 'Show API key' });
    reveal.focus();
    await user.keyboard('[Enter]');
    expect(key.type).toBe('text');
    expect(screen.getByRole('button', { name: 'Hide API key' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    await user.keyboard('[Enter]');
    expect(key.type).toBe('password');
  });

  it('offers a model reload after a stale catalog response', async () => {
    setup(({ method }) =>
      method === 'GET' ? json(fullData) : failure(409, 'MODEL_CATALOG_CHANGED'),
    );
    const user = renderPanel();
    await screen.findByText('Primary');
    await user.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
    await user.click(screen.getByRole('switch', { name: /Manual one/ }));
    await user.click(screen.getByRole('button', { name: 'Save connection' }));
    expect(await screen.findByText(/Models changed since you opened this panel/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Reload models' }));
    expect(screen.getByRole('region', { name: 'Connection models' }).textContent).toContain(
      'Models (1/2)',
    );
  });

  it('shows three models on a card until expanded', async () => {
    const extra = Array.from({ length: 3 }, (_, index) => ({
      id: `extra-${index}`,
      publicId: `openai/extra-${index}`,
      upstreamId: `extra-${index}`,
      displayName: `Extra ${index}`,
      enabled: true,
      discovered: true,
    }));
    setup(
      defaultHandler({
        connections: [{ ...connections[0], models: [...connections[0].models, ...extra] }],
        keys: [],
      }),
    );
    const user = renderPanel();
    await screen.findByText('Primary');
    expect(screen.getByText('Models (4/5)')).toBeTruthy();
    expect(screen.queryByText('Extra 2')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Show all (5)' }));
    expect(screen.getByText('Extra 2')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Show less' }));
    expect(screen.queryByText('Extra 2')).toBeNull();
  });
});
