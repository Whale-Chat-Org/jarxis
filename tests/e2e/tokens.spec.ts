import { test } from './fixtures';
import { expect } from '@playwright/test';
import { mailLink, makeOwner, newPassword, password, register, verify } from './helpers';

test('direct login tokens rotate, reset revokes them, and logout rejects further access', async ({
  request,
  baseURL,
}) => {
  const account = await register(request, baseURL!);
  await verify(request, account.email, baseURL!);
  await makeOwner(account.id);
  const login = await request.post('/api/v1/auth/login', {
    data: { email: account.email, password },
  });
  expect(login.status(), await login.text()).toBe(200);
  const first = await login.json();
  expect(first).toMatchObject({ tokenType: 'Bearer', expiresIn: 600 });
  expect(login.headers()['set-cookie']).toBeUndefined();
  expect(
    (
      await request.get('/api/v1/me', {
        headers: { Authorization: `Bearer ${first.accessToken}` },
      })
    ).status(),
  ).toBe(200);
  const rotated = await request.post('/api/v1/auth/refresh', {
    data: { refreshToken: first.refreshToken },
  });
  expect(rotated.status(), await rotated.text()).toBe(200);
  const second = await rotated.json();
  expect(second.refreshToken).not.toBe(first.refreshToken);
  const reset = await request.post('/api/auth/request-password-reset', {
    data: { email: account.email, redirectTo: `${baseURL}/auth/reset-password` },
  });
  expect(reset.ok()).toBeTruthy();
  const link = await mailLink(request, account.email, 'Reset your Jarxis password', baseURL!);
  const redirect = await request.get(link, { maxRedirects: 0 });
  const token = new URL(redirect.headers().location, baseURL).searchParams.get('token');
  expect(
    (await request.post('/api/auth/reset-password', { data: { token, newPassword } })).ok(),
  ).toBeTruthy();
  expect(
    (
      await request.get('/api/v1/me', {
        headers: { Authorization: `Bearer ${second.accessToken}` },
      })
    ).status(),
  ).toBe(401);
  expect(
    (
      await request.post('/api/v1/auth/refresh', { data: { refreshToken: second.refreshToken } })
    ).status(),
  ).toBe(401);
  const relogin = await request.post('/api/v1/auth/login', {
    data: { email: account.email, password: newPassword },
  });
  expect(relogin.status()).toBe(200);
  const third = await relogin.json();
  expect(
    (
      await request.post('/api/v1/auth/logout', {
        headers: { Authorization: `Bearer ${third.accessToken}` },
      })
    ).ok(),
  ).toBeTruthy();
  expect(
    (
      await request.get('/api/v1/me', {
        headers: { Authorization: `Bearer ${third.accessToken}` },
      })
    ).status(),
  ).toBe(401);
  expect(
    (
      await request.post('/api/v1/auth/refresh', { data: { refreshToken: third.refreshToken } })
    ).status(),
  ).toBe(401);
});
