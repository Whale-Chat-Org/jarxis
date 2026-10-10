import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ auth: vi.fn(), rateLimit: vi.fn() }));
vi.mock('@/lib/auth', () => ({ getAuth: () => ({ handler: mocks.auth }) }));
vi.mock('@/lib/redis', () => ({ rateLimit: mocks.rateLimit, requestIP: () => 'test' }));
vi.mock('@/lib/env', () => ({ env: () => ({ BETTER_AUTH_URL: 'https://app.test' }) }));
import { GET, POST } from '@/app/api/auth/[...all]/route';
beforeEach(() => vi.resetAllMocks());
it.each([
  '/sign-in/social',
  '/link-social',
  '/unlink-account',
  '/get-access-token',
  '/refresh-token',
  '/account-info',
  '/callback/google',
  '/callback/google/',
])('blocks removed OAuth endpoint %s without invoking authentication', async (path) => {
  for (const method of ['GET', 'POST']) {
    const response = await (method === 'GET' ? GET : POST)(
      new Request(`https://app.test/api/auth${path}`, { method }),
    );
    expect(response.status).toBe(404);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ error: { code: 'NOT_FOUND', message: 'Not found' } });
  }
  expect(mocks.auth).not.toHaveBeenCalled();
});
it.each(['/sign-in/email', '/sign-up/email', '/request-password-reset', '/get-session'])(
  'retains password/session endpoint %s',
  async (path) => {
    mocks.auth.mockResolvedValue(Response.json({ ok: true }));
    const response = await POST(
      new Request(`https://app.test/api/auth${path}`, { method: 'POST' }),
    );
    expect(response.status).toBe(200);
    expect(mocks.auth).toHaveBeenCalledTimes(1);
  },
);
