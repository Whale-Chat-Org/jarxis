import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiKeysPanel } from '@/components/admin/api-keys/api-keys-panel';
import { AdminPanelHost } from '@/components/ui/admin-panel';
vi.mock('next/navigation', () => ({ usePathname: () => '/admin/api-keys' }));
const record = {
  id: 'k1',
  name: 'Deploy',
  prefix: 'jx_test',
  createdAt: '2026-01-01T00:00:00.000Z',
  revokedAt: null as string | null,
  lastUsedAt: null,
};
let current = { ...record };
let fail = false;
let calls: { url: URL; method: string; body: unknown }[];
const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
beforeEach(() => {
  current = { ...record };
  calls = [];
  fail = false;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const target = new URL(url, 'https://app.test');
      const method = init?.method ?? 'GET';
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
      calls.push({ url: target, method, body });
      if (method !== 'GET' && fail)
        return response({ error: { code: 'UNAVAILABLE', message: 'secret upstream data' } }, 503);
      if (method === 'POST') return response({ key: 'jx_fake_once_only', record: current }, 201);
      if (method === 'PATCH') {
        current = { ...current, ...body };
        return response({ record: current });
      }
      if (method === 'DELETE') {
        current = { ...current, revokedAt: '2026-02-01T00:00:00.000Z' };
        return response({ success: true });
      }
      if (target.pathname.endsWith('/k1')) return response({ record: current });
      const page = Number(target.searchParams.get('page') ?? 1);
      return response({ keys: [current], total: 21, page, pageSize: 20 });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());
function setup(canManage = true) {
  const user = userEvent.setup();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <AdminPanelHost>
        <ApiKeysPanel canManage={canManage} />
      </AdminPanelHost>
    </QueryClientProvider>,
  );
  return { user, client };
}
describe('Independent API Keys management', () => {
  it('queries only keys, debounces search and resets pagination for filters', async () => {
    const { user } = setup();
    await screen.findByRole('button', { name: 'Deploy' });
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(calls.at(-1)?.url.searchParams.get('page')).toBe('2'));
    await user.type(screen.getByLabelText('Search by name'), 'Deploy');
    await waitFor(() => expect(calls.at(-1)?.url.searchParams.get('search')).toBe('Deploy'));
    expect(calls.at(-1)?.url.searchParams.get('page')).toBe('1');
    await user.click(screen.getByRole('combobox', { name: 'Status' }));
    await user.click(screen.getByRole('option', { name: 'Revoked' }));
    await waitFor(() => expect(calls.at(-1)?.url.searchParams.get('status')).toBe('revoked'));
    expect(calls.every((call) => call.url.pathname.startsWith('/api/admin/providers/keys'))).toBe(
      true,
    );
  });
  it('shows the secret once, copies it, clears on close and keeps it out of query cache', async () => {
    const { user, client } = setup();
    await screen.findByRole('button', { name: 'Deploy' });
    const copy = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: copy },
    });
    await user.click(screen.getByRole('button', { name: 'Create API key' }));
    const create = screen.getByRole('button', { name: 'Create API key' });
    expect(create.hasAttribute('disabled')).toBe(true);
    await user.type(screen.getByLabelText('Name', { exact: true }), ' CI ');
    await user.click(create);
    expect(
      ((await screen.findByLabelText('API key', { exact: true })) as HTMLTextAreaElement).value,
    ).toBe('jx_fake_once_only');
    await user.click(screen.getByRole('button', { name: 'Copy key' }));
    expect(copy).toHaveBeenCalledWith('jx_fake_once_only');
    copy.mockRejectedValueOnce(new Error('denied'));
    await user.click(await screen.findByRole('button', { name: 'Copied' }));
    expect((await screen.findByRole('alert')).textContent).toContain('could not be copied');
    expect(
      JSON.stringify(
        client
          .getQueryCache()
          .getAll()
          .map((query) => query.state.data),
      ),
    ).not.toContain('jx_fake_once_only');
    await user.click(screen.getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByLabelText('API key', { exact: true })).toBeNull());
    await user.click(screen.getByRole('button', { name: 'Deploy' }));
    await screen.findByText('API key details');
    expect(screen.queryByDisplayValue('jx_fake_once_only')).toBeNull();
    expect(calls.find((call) => call.method === 'POST')?.body).toEqual({ name: 'CI' });
  });
  it('edits a name, revokes and retains the record with no further edit action', async () => {
    const { user } = setup();
    await user.click(await screen.findByRole('button', { name: 'Deploy' }));
    await screen.findByText('API key details');
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const name = screen.getByLabelText('Name', { exact: true });
    await user.clear(name);
    await user.type(name, 'Production');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(screen.queryByText('Edit API key')).toBeNull());
    expect(calls.find((call) => call.method === 'PATCH')?.body).toEqual({ name: 'Production' });
    await user.click(screen.getByRole('button', { name: 'Revoke' }));
    await screen.findByText('Revoke API key?');
    const revoke = screen.getAllByRole('button', { name: 'Revoke' }).at(-1)!;
    await user.click(revoke);
    await waitFor(() => expect(screen.queryByText('Revoke API key?')).toBeNull());
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(await screen.findByRole('button', { name: 'Production' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
    expect(calls.filter((call) => call.method === 'DELETE')).toHaveLength(1);
  });
  it('keeps failed names and supports retry without reflecting server errors', async () => {
    const { user } = setup();
    await screen.findByRole('button', { name: 'Deploy' });
    await user.click(screen.getByRole('button', { name: 'Create API key' }));
    await user.type(screen.getByLabelText('Name', { exact: true }), 'CI');
    fail = true;
    await user.click(screen.getByRole('button', { name: 'Create API key' }));
    expect((await screen.findByRole('alert')).textContent).toContain('temporarily unavailable');
    expect(screen.queryByText('secret upstream data')).toBeNull();
    expect((screen.getByLabelText('Name', { exact: true }) as HTMLInputElement).value).toBe('CI');
    fail = false;
    await user.click(screen.getByRole('button', { name: 'Create API key' }));
    expect(await screen.findByLabelText('API key', { exact: true })).toBeTruthy();
  });
  it('locks closing and repeated create submissions synchronously', async () => {
    const { user } = setup();
    await screen.findByRole('button', { name: 'Deploy' });
    await user.click(screen.getByRole('button', { name: 'Create API key' }));
    await user.type(screen.getByLabelText('Name', { exact: true }), 'CI');
    let release!: (response: Response) => void;
    vi.mocked(fetch).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const before = vi.mocked(fetch).mock.calls.length;
    const form = screen.getByLabelText('Name', { exact: true }).closest('form')!;
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(vi.mocked(fetch).mock.calls.length - before).toBe(1);
    await user.keyboard('{Escape}');
    expect(screen.getByRole('heading', { name: 'Create API key' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cancel' }).hasAttribute('disabled')).toBe(true);
    release(response({ key: 'jx_fake_once_only', record }, 201));
    expect(await screen.findByLabelText('API key', { exact: true })).toBeTruthy();
  });
  it('hides mutation actions without the manage grant', async () => {
    const { user } = setup(false);
    expect(screen.queryByRole('button', { name: 'Create API key' })).toBeNull();
    await user.click(await screen.findByRole('button', { name: 'Deploy' }));
    await screen.findByText('API key details');
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Revoke' })).toBeNull();
  });
  it('retains the edit draft and revoke confirmation after failures, then retries', async () => {
    const { user } = setup();
    await user.click(await screen.findByRole('button', { name: 'Deploy' }));
    await screen.findByText('API key details');
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    await user.clear(screen.getByLabelText('Name', { exact: true }));
    await user.type(screen.getByLabelText('Name', { exact: true }), 'Retry draft');
    fail = true;
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect((await screen.findByRole('alert')).textContent).toContain('temporarily unavailable');
    expect((screen.getByLabelText('Name', { exact: true }) as HTMLInputElement).value).toBe(
      'Retry draft',
    );
    fail = false;
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Edit API key' })).toBeNull());
    await user.click(screen.getByRole('button', { name: 'Revoke' }));
    fail = true;
    await user.click(screen.getByRole('button', { name: 'Revoke' }));
    expect((await screen.findByRole('alert')).textContent).toContain('temporarily unavailable');
    expect(screen.getByRole('heading', { name: 'Revoke API key?' })).toBeTruthy();
    fail = false;
    await user.click(screen.getByRole('button', { name: 'Revoke' }));
    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: 'Revoke API key?' })).toBeNull(),
    );
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
  });
  it('shows initial loading, sanitized load errors, retry and empty states', async () => {
    let finish!: (response: Response) => void;
    vi.mocked(fetch).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const { user } = setup();
    expect(screen.getByRole('status').textContent).toContain('Loading API keys…');
    finish(response({ error: { code: 'UNAVAILABLE' } }, 503));
    expect(await screen.findByText('API keys could not be loaded')).toBeTruthy();
    vi.mocked(fetch).mockResolvedValueOnce(response({ keys: [], total: 0, page: 1, pageSize: 20 }));
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('No API keys found.')).toBeTruthy();
  });
});
