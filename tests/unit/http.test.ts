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
    SMTP_HOST: 'localhost',
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
