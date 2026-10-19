import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpError } from '@/lib/errors';
const m = vi.hoisted(() => ({ identify: vi.fn(), grants: vi.fn(), rateLimit: vi.fn() }));
vi.mock('@/lib/rbac', () => ({ identify: m.identify, grants: m.grants }));
vi.mock('@/lib/redis', () => ({ rateLimit: m.rateLimit }));
const { GET } = await import('@/app/api/admin/grants/route');
beforeEach(() => {
  vi.resetAllMocks();
  m.identify.mockResolvedValue({ userId: 'u1' });
  m.grants.mockResolvedValue({ permissions: new Set(['audit:read']) });
});
const request = () => new Request('http://localhost/api/admin/grants');
describe('session grants endpoint', () => {
  it('returns live permissions with no-store and an identity rate limit', async () => {
    const response = await GET(request());
    expect(await response.json()).toEqual({ permissions: ['audit:read'] });
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(m.rateLimit).toHaveBeenCalledWith('admin-grants:u1', 120);
    expect(m.grants).toHaveBeenCalledWith('u1');
  });
  it('rejects bearer requests', async () => {
    const response = await GET(
      new Request(request(), { headers: { authorization: 'Bearer invalid' } }),
    );
    expect(response.status).toBe(401);
    expect(m.identify).not.toHaveBeenCalled();
  });
  it.each([401, 429, 503])('fails closed with status %s', async (status) => {
    if (status === 401)
      m.identify.mockRejectedValueOnce(
        new HttpError(status, 'UNAUTHENTICATED', 'Sign in required'),
      );
    else m.rateLimit.mockRejectedValueOnce(new HttpError(status, 'UNAVAILABLE', 'Unavailable'));
    expect((await GET(request())).status).toBe(status);
    expect(m.grants).not.toHaveBeenCalled();
  });
});
