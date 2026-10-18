import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET, POST } from '@/app/api/admin/providers/keys/route';
import { GET as detail, PATCH, DELETE } from '@/app/api/admin/providers/keys/[keyId]/route';
import { HttpError } from '@/lib/errors';
const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  list: vi.fn(),
  detail: vi.fn(),
  rename: vi.fn(),
  create: vi.fn(),
  revoke: vi.fn(),
}));
vi.mock('@/lib/providers/admin-auth', () => ({ requireProviderOwner: mocks.auth }));
vi.mock('@/lib/providers/service', () => ({
  queryGatewayKeys: mocks.list,
  getGatewayKey: mocks.detail,
  renameGatewayKey: mocks.rename,
  issueGatewayKey: mocks.create,
  revokeGatewayKey: mocks.revoke,
}));
vi.mock('@/lib/env', () => ({ env: () => ({ BETTER_AUTH_URL: 'https://app.test' }) }));
const ctx = { params: Promise.resolve({ keyId: 'k1' }) };
const request = (method = 'GET', data?: unknown) =>
  new Request('https://app.test/api/admin/providers/keys/k1', {
    method,
    headers: { Origin: 'https://app.test', 'Content-Type': 'application/json' },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  });
beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockResolvedValue('owner');
  mocks.list.mockResolvedValue({ keys: [], total: 0 });
  mocks.detail.mockResolvedValue({ id: 'k1' });
  mocks.rename.mockResolvedValue({ id: 'k1', name: 'New' });
});
describe('API Keys routes', () => {
  it('requires read access for list and details with no-store responses', async () => {
    const res = await GET(request());
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(mocks.auth).toHaveBeenLastCalledWith(expect.any(Request), 'providers:read');
    await detail(request(), ctx);
    expect(mocks.detail).toHaveBeenCalledWith('k1');
  });
  it('validates query bounds and rejects extra fields', async () => {
    for (const query of ['page=0', 'pageSize=101', 'searchField=hash', 'secret=true']) {
      expect((await GET(new Request('https://app.test?' + query))).status).toBe(400);
    }
    expect(mocks.list).not.toHaveBeenCalled();
  });
  it('requires manage permission and permits only a name patch', async () => {
    expect((await PATCH(request('PATCH', { name: ' New ' }), ctx)).status).toBe(200);
    expect(mocks.auth).toHaveBeenLastCalledWith(expect.any(Request), 'providers:manage');
    expect(mocks.rename).toHaveBeenCalledWith('owner', 'k1', 'New');
    for (const data of [
      { name: '' },
      { name: 'x'.repeat(101) },
      { name: 'New', hash: 'replacement' },
    ])
      expect((await PATCH(request('PATCH', data), ctx)).status).toBe(400);
    expect(mocks.rename).toHaveBeenCalledTimes(1);
  });
  it('keeps creation and revocation endpoints', async () => {
    mocks.create.mockResolvedValue({ key: 'fake-test-key' });
    expect((await POST(request('POST', { name: 'Deploy' }))).status).toBe(201);
    expect((await DELETE(request('DELETE'), ctx)).status).toBe(200);
    expect(mocks.revoke).toHaveBeenCalledWith('owner', 'k1');
  });
  it('rejects unauthorized reads and cross-origin writes', async () => {
    mocks.auth.mockRejectedValue(new HttpError(403, 'FORBIDDEN', 'Denied'));
    expect((await GET(request())).status).toBe(403);
    expect((await detail(request(), ctx)).status).toBe(403);
    expect(
      (
        await PATCH(
          new Request('https://app.test', {
            method: 'PATCH',
            headers: { Origin: 'https://evil.test' },
          }),
          ctx,
        )
      ).status,
    ).toBe(403);
    expect(mocks.rename).not.toHaveBeenCalled();
  });
});
