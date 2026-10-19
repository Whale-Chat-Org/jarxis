import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiAction, apiRequest } from '@/lib/api-client';
import { safeActionErrorMessage } from '@/lib/action-errors';
import { z } from 'zod';

afterEach(() => vi.unstubAllGlobals());

describe('safe role-in-use errors', () => {
  it.each([1, 3])('preserves a validated count of %s through the API client', async (userCount) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json(
          {
            error: {
              code: 'ROLE_IN_USE',
              userCount,
              message: 'untrusted server message',
            },
          },
          { status: 409 },
        ),
      ),
    );
    for (const run of [() => apiAction('/roles'), () => apiRequest('/roles', z.unknown())]) {
      const error = await run().catch((cause: unknown) => cause);
      expect(error).toMatchObject({ code: 'ROLE_IN_USE', userCount });
      const message = safeActionErrorMessage(error, 'fallback');
      expect(message).toContain(`${userCount} user`);
      expect(message).toContain(userCount === 1 ? 'still has' : 'still have');
      expect(message).not.toContain('untrusted');
    }
  });
  it.each([-1, 0, 1.5, '2', null, Number.MAX_SAFE_INTEGER + 1])(
    'discards malformed count %s without discarding the safe code',
    async (userCount) => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () =>
          Response.json(
            {
              error: {
                code: 'ROLE_IN_USE',
                userCount,
                message: 'untrusted',
              },
            },
            { status: 409 },
          ),
        ),
      );
      const error = await apiAction('/roles').catch((cause: unknown) => cause);
      expect(safeActionErrorMessage(error, 'fallback')).toBe(
        'This role still has members assigned to it.',
      );
    },
  );
});
