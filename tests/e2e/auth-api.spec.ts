import { test } from './fixtures';
import { expect } from '@playwright/test';
import { login, mailLink, newPassword, originHeaders, password, register, verify } from './helpers';

test('HTTP auth lifecycle: verification, reset, session revocation and logout', async ({
  request,
  baseURL,
}) => {
  const origin = baseURL!;
  const { email } = await register(request, origin);
  const unverified = await request.post('/api/auth/sign-in/email', { data: { email, password } });
  expect(unverified.status()).toBe(403);
  await verify(request, email, origin);
  await login(request, email, origin);
  expect((await (await request.get('/api/auth/get-session')).json()).user.email).toBe(email);
  // Deny by default: a freshly registered account holds no role, so the admin plugin refuses
  // every administrative permission.
  const denied = await request.post('/api/auth/admin/has-permission', {
    headers: originHeaders(origin),
    data: { permissions: { user: ['list'] } },
  });
  expect(denied.ok(), await denied.text()).toBeTruthy();
  expect((await denied.json()).success).toBe(false);
  const reset = await request.post('/api/auth/request-password-reset', {
    headers: originHeaders(origin),
    data: { email, redirectTo: `${origin}/auth/reset-password` },
  });
  expect(reset.ok(), await reset.text()).toBeTruthy();
  const link = await mailLink(request, email, 'Reset your Jarxis password', origin);
  // Follow the actual emailed token URL to obtain the actual UI callback URL.
  const redirect = await request.get(link, { maxRedirects: 0 });
  expect([302, 303]).toContain(redirect.status());
  const callback = new URL(redirect.headers().location, origin);
  expect(callback.origin).toBe(new URL(origin).origin);
  const token = callback.searchParams.get('token');
  expect(token).toBeTruthy();
  const changed = await request.post('/api/auth/reset-password', {
    headers: originHeaders(origin),
    data: { token, newPassword },
  });
  expect(changed.ok(), await changed.text()).toBeTruthy();
  expect(await (await request.get('/api/auth/get-session')).json()).toBeNull();
  expect(
    (await request.post('/api/auth/sign-in/email', { data: { email, password } })).status(),
  ).toBe(401);
  expect(
    (await request.post('/api/auth/reset-password', { data: { token, newPassword } })).ok(),
  ).toBe(false);
  await login(request, email, origin, newPassword);
  const out = await request.post('/api/auth/sign-out', {
    headers: originHeaders(origin),
    data: {},
  });
  expect(out.ok()).toBeTruthy();
  expect(await (await request.get('/api/auth/get-session')).json()).toBeNull();
  expect(
    (
      await request.post('/api/auth/admin/has-permission', {
        headers: originHeaders(origin),
        data: { permissions: { user: ['list'] } },
      })
    ).status(),
  ).toBe(401);
});

test('administration is cookie-session only and rejects anonymous callers', async ({
  request,
  baseURL,
}) => {
  const origin = baseURL!;
  // The former /api/v1 administration surface is gone; only token auth remains there.
  for (const path of ['users', 'roles', 'permissions', 'audit-logs']) {
    expect((await request.get(`/api/v1/${path}`)).status()).toBe(404);
  }
  // Administrative endpoints require a session cookie, so a bearer token cannot reach them
  // either. list-users is a GET endpoint (see the installed Better Auth admin plugin routes).
  const anonymous = await request.get('/api/auth/admin/list-users', {
    headers: originHeaders(origin),
  });
  expect(anonymous.status()).toBe(401);
  const bearer = await request.get('/api/auth/admin/list-users', {
    headers: { ...originHeaders(origin), Authorization: 'Bearer invalid' },
  });
  expect(bearer.status()).toBe(401);
});
