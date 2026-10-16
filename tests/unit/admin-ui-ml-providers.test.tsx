import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock('sonner', () => ({ toast }));
vi.mock('next/navigation', () => ({ usePathname: () => '/admin/ml-providers' }));

import { MlProvidersPanel } from '@/components/admin/ml-providers-panel';
import { AdminPanelHost } from '@/components/ui/admin-panel';

type Call = { path: string; method: string; body?: unknown };
type Handler = (call: Call) => Response | Promise<Response>;

const root = '/api/admin/ml-providers';

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
      <MlProvidersPanel canManage={canManage} />
    </AdminPanelHost>,
  );
  return user;
}

const nonGet = () => calls.filter((call) => call.method !== 'GET');

describe('MlProvidersPanel listing', () => {
  it('shows the loading skeleton, then connections, models and keys', async () => {
    renderPanel();
    expect(screen.getByText('Loading ML providers…')).toBeTruthy();
    expect(await screen.findByText('Primary')).toBeTruthy();

    expect(screen.getByText('openai · https://api.openai.com/v1')).toBeTruthy();
    expect(screen.getByText('needs attention')).toBeTruthy();
    expect(screen.getByText('Discovery: failed')).toBeTruthy();
    expect(screen.getByText('Priority 1')).toBeTruthy();
    expect(screen.getByText('Discovery failed: upstream broke')).toBeTruthy();
    expect(screen.getByText(/Last discovery:/)).toBeTruthy();
    expect(screen.getByText('Models (2)')).toBeTruthy();
    expect(screen.getByText('Discovered')).toBeTruthy();
    expect(screen.getByText('Manual')).toBeTruthy();

    expect(
      screen.getByText('This endpoint does not provide model discovery. Enter model IDs manually.'),
    ).toBeTruthy();
    expect(screen.getByText(/No catalog discovered yet\./)).toBeTruthy();
    expect(
      screen.getByText('No models yet. Refresh the catalog or add an upstream model ID.'),
    ).toBeTruthy();

    expect(screen.getByText('CI key')).toBeTruthy();
    expect(screen.getByText(/Active · Last used/)).toBeTruthy();
    expect(screen.getByText('Revoked · Never used')).toBeTruthy();
    // Only the active key can be revoked.
    expect(screen.getAllByRole('button', { name: 'Revoke' })).toHaveLength(1);
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
    expect(screen.getByText('No gateway keys issued.')).toBeTruthy();
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
        'ML providers could not be loaded. Check your connection and try again.',
      ),
    ).toBeTruthy();
    expect(screen.getByText('Providers not up to date')).toBeTruthy();

    // A failed retry has no dialog, so it is reported as a toast.
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        'ML providers could not be loaded. Try again shortly.',
      ),
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

describe('MlProvidersPanel page actions', () => {
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

  it('adds a manual model and clears the field', async () => {
    const user = renderPanel();
    await screen.findByText('Primary');
    const input = document.getElementById('model-c1') as HTMLInputElement;
    await user.type(input, '  gpt-extra  ');
    await user.click(screen.getAllByRole('button', { name: 'Add model' })[0]);
    await waitFor(() =>
      expect(nonGet()).toEqual([
        { path: '/c1/models', method: 'POST', body: { upstreamId: 'gpt-extra' } },
      ]),
    );
    await waitFor(() => expect(input.value).toBe(''));
  });
});

describe('MlProvidersPanel confirmations', () => {
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
    expect(await screen.findByText('Only owners can manage ML providers.')).toBeTruthy();
    expect(toast.error).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByText('Delete connection?')).toBeNull());
  });

  it('revokes a gateway key', async () => {
    const user = renderPanel();
    await screen.findByText('Primary');
    await user.click(screen.getByRole('button', { name: 'Revoke' }));
    expect(await screen.findByText('Revoke gateway key?')).toBeTruthy();
    expect(
      screen.getByText('CI key: Clients using this key will lose access immediately.'),
    ).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() =>
      expect(nonGet()).toEqual([{ path: '/keys/k1', method: 'DELETE', body: undefined }]),
    );
  });
});

describe('MlProvidersPanel gateway keys', () => {
  it('issues a key, shows it once and copies it', async () => {
    setup(({ path, method }) => {
      if (method === 'GET') return json(fullData);
      if (path === '/keys') return json({ key: 'jx_secret_value' }, 201);
      return new Response(null, { status: 204 });
    });
    const writeText = vi.fn().mockResolvedValue(undefined);
    const user = renderPanel();
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    await screen.findByText('Primary');
    await user.type(screen.getByLabelText('Key name'), ' deploy ');
    await user.click(screen.getByRole('button', { name: 'Issue key' }));

    expect(await screen.findByText('Save your gateway key')).toBeTruthy();
    expect(nonGet()).toEqual([{ path: '/keys', method: 'POST', body: { name: 'deploy' } }]);
    expect((screen.getByLabelText('Gateway key') as HTMLTextAreaElement).value).toBe(
      'jx_secret_value',
    );
    expect((screen.getByLabelText('Key name') as HTMLInputElement).value).toBe('');

    await user.click(screen.getByRole('button', { name: 'Copy key' }));
    expect(writeText).toHaveBeenCalledWith('jx_secret_value');
    expect(await screen.findByText('Key copied.')).toBeTruthy();

    writeText.mockRejectedValueOnce(new Error('denied'));
    await user.click(screen.getByRole('button', { name: 'Copy key' }));
    expect(
      await screen.findByText('The key could not be copied. Select it and copy it manually.'),
    ).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByText('Save your gateway key')).toBeNull());
  });
});

describe('MlProvidersPanel connection editor', () => {
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
    [undefined, 'Connection saved. Model discovery is scheduled automatically.'],
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
    expect(
      await screen.findByText('Connection saved. Model discovery is scheduled automatically.'),
    ).toBeTruthy();
    expect(nonGet()).toEqual([
      {
        path: '/c1',
        method: 'PATCH',
        body: { name: 'Renamed', priority: 1, baseUrl: 'https://api.openai.com/v1' },
      },
    ]);
  });
});
