import { beforeAll, describe, it, expect } from 'vitest';
import { assertOrigin, body, handler } from '@/lib/http';
import { loginInput } from '@/lib/validation';
import { HttpError } from '@/lib/errors';
beforeAll(() => {
  Object.assign(process.env, {
    DATABASE_URL: 'postgresql://test:test@localhost:5432/jarxis_test',
    REDIS_URL: 'redis://localhost:6379',
    BETTER_AUTH_URL: 'http://localhost:3000',
    BETTER_AUTH_SECRET: 'a'.repeat(64),
    JWT_SECRET: 'b'.repeat(64),
    BREVO_API_KEY: 'xkeysib-test',
    MAIL_FROM: 'Jarxis <noreply@example.com>',
  });
});
describe('HTTP security boundary', () => {
  it('rejects foreign origins and missing origin for cookie mutations', () => {
    expect(() =>
      assertOrigin(
        new Request('http://localhost:3000/api/v1/users', {
          method: 'PATCH',
          headers: { Origin: 'https://evil.test' },
        }),
      ),
    ).toThrow(HttpError);
    expect(() =>
      assertOrigin(
        new Request('http://localhost:3000/api/v1/users', {
          method: 'PATCH',
          headers: { Cookie: 'session=x' },
        }),
      ),
    ).toThrow(HttpError);
  });
  it('allows same-origin cookie requests and non-browser bearer requests', () => {
    expect(() =>
      assertOrigin(
        new Request('http://localhost:3000/api/v1/users', {
          method: 'PATCH',
          headers: { Origin: 'http://localhost:3000', Cookie: 'session=x' },
        }),
      ),
    ).not.toThrow();
    expect(() =>
      assertOrigin(
        new Request('http://localhost:3000/api/v1/users', {
          method: 'PATCH',
          headers: { Authorization: 'Bearer x' },
        }),
      ),
    ).not.toThrow();
  });
  it('rejects unexpected content types and oversized JSON', async () => {
    await expect(
      body(new Request('http://localhost/', { method: 'POST', body: 'x' }), loginInput),
    ).rejects.toMatchObject({ status: 415 });
    await expect(
      body(
        new Request('http://localhost/', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ data: 'x'.repeat(17000) }),
        }),
        loginInput,
      ),
    ).rejects.toMatchObject({ status: 413 });
  });
  it('returns consistent 401/403 envelopes', async () => {
    for (const status of [401, 403]) {
      const response = await handler(async () => {
        throw new HttpError(status, 'DENIED', 'Denied');
      })(new Request('http://localhost'));
      expect(response.status).toBe(status);
      expect(await response.json()).toEqual({ error: { code: 'DENIED', message: 'Denied' } });
      expect(response.headers.get('Cache-Control')).toBe('no-store');
    }
  });
});

describe('handler error sanitisation', () => {
  it('maps Better Auth errors to generic messages and clamps non-client statuses', async () => {
    const { APIError } = await import('better-auth');
    const run = (error: unknown) =>
      handler(async () => {
        throw error;
      })(new Request('http://localhost'));
    const limited = await run(new APIError('TOO_MANY_REQUESTS', { message: 'internal detail' }));
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({
      error: { code: 'AUTH_ERROR', message: 'Too many requests' },
    });
    const failed = await run(new APIError('INTERNAL_SERVER_ERROR', { message: 'db detail' }));
    expect(failed.status).toBe(500);
    expect(await failed.json()).toEqual({
      error: { code: 'AUTH_ERROR', message: 'Authentication failed' },
    });
  });

  it('returns validation issues without echoing input and hides unknown errors', async () => {
    const { z } = await import('zod');
    const invalid = await handler(async () => {
      z.object({ a: z.string() }).parse({ a: 1 });
      return new Response();
    })(new Request('http://localhost'));
    expect(invalid.status).toBe(400);
    expect((await invalid.json()).error).toMatchObject({
      code: 'VALIDATION_ERROR',
      issues: [{ path: ['a'] }],
    });

    const log = (await import('vitest')).vi.spyOn(console, 'error').mockImplementation(() => {});
    for (const thrown of [new TypeError('password=fake'), 'string failure']) {
      const response = await handler(async () => {
        throw thrown;
      })(new Request('http://localhost'));
      expect(response.status).toBe(503);
      expect(await response.text()).not.toContain('password');
    }
    expect(log).toHaveBeenCalledWith('Request failed', { kind: 'TypeError' });
    expect(log).toHaveBeenCalledWith('Request failed', { kind: 'UnknownError' });
    log.mockRestore();
  });

  it('rejects a JSON request without a body and malformed JSON', async () => {
    await expect(
      body(
        new Request('http://localhost/', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        }),
        loginInput,
      ),
    ).rejects.toMatchObject({ status: 400, code: 'INVALID_JSON' });
    await expect(
      body(
        new Request('http://localhost/', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{nope',
        }),
        loginInput,
      ),
    ).rejects.toMatchObject({ status: 400, message: 'Invalid JSON body' });
  });

  it('skips origin checks for safe methods', () => {
    for (const method of ['GET', 'HEAD', 'OPTIONS'])
      expect(() =>
        assertOrigin(
          new Request('http://localhost:3000/', {
            method,
            headers: { Origin: 'https://evil.test' },
          }),
        ),
      ).not.toThrow();
  });
});
