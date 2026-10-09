import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GET } from '@/app/auth/post-login/route';
import { HttpError } from '@/lib/errors';
import { flattenStatements, roles } from '@/lib/permissions';
import { grants, identify } from '@/lib/rbac';

vi.mock('@/lib/rbac', () => ({ identify: vi.fn(), grants: vi.fn() }));

describe('post-login destination', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(identify).mockResolvedValue({ userId: 'user-id', sessionId: 'session-id' });
  });

  it.each(['user', 'viewer', 'administrator', 'owner'] as const)(
    'routes %s using its dashboard permission',
    async (role) => {
      vi.mocked(grants).mockResolvedValue({
        roles: [role],
        permissions: new Set(flattenStatements(roles[role])),
      });
      const request = new Request('http://localhost:3000/auth/post-login');
      const response = await GET(request);
      expect(identify).toHaveBeenCalledWith(request.headers);
      expect(grants).toHaveBeenCalledWith('user-id');
      expect(response.headers.get('location')).toBe(
        `http://localhost:3000${role === 'user' ? '/' : '/admin'}`,
      );
      expect(response.headers.get('cache-control')).toBe('no-store');
    },
  );

  it('sends missing or invalid sessions to sign-in without resolving grants', async () => {
    vi.mocked(identify).mockRejectedValue(
      new HttpError(401, 'UNAUTHENTICATED', 'Sign in required'),
    );
    const response = await GET(new Request('http://localhost:3000/auth/post-login'));
    expect(response.headers.get('location')).toBe('http://localhost:3000/auth/sign-in');
    expect(grants).not.toHaveBeenCalled();
  });

  it('does not hide unexpected database errors', async () => {
    const error = new Error('Database unavailable');
    vi.mocked(grants).mockRejectedValue(error);
    await expect(GET(new Request('http://localhost:3000/auth/post-login'))).rejects.toBe(error);
  });
});
