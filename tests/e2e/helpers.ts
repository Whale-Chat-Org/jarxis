import { expect, type APIRequestContext, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { assertTestDatabaseUrl } from '../../scripts/lib/test-database.mjs';

export const password = 'Acceptance-Only!58392';
export const newPassword = 'Acceptance-Reset!69403';
export const uniqueEmail = () => `e2e-${randomUUID()}@example.test`;
export const originHeaders = (baseURL: string) => ({ Origin: new URL(baseURL).origin });

export function testDatabase() {
  const connectionString = process.env.DATABASE_URL;
  assertTestDatabaseUrl(connectionString);
  return new Pool({
    connectionString,
    max: 1,
    connectionTimeoutMillis: 5_000,
    statement_timeout: 5_000,
  });
}

export async function register(request: APIRequestContext, baseURL: string) {
  const email = uniqueEmail();
  const response = await request.post('/api/auth/sign-up/email', {
    headers: originHeaders(baseURL),
    data: { name: 'Acceptance User', email, password, callbackURL: `${baseURL}/auth/sign-in` },
  });
  expect(response.status(), await response.text()).toBe(200);
  const data = await response.json();
  expect(data.user.email).toBe(email);
  expect(data.user.emailVerified).toBe(false);
  // Also catches a reused development server connected to a different database.
  const pool = testDatabase();
  try {
    const result = await pool.query('SELECT id FROM app_user WHERE email = $1', [email]);
    expect(result.rows, 'Server must use the same jarxis_test database as Playwright').toEqual([
      { id: data.user.id },
    ]);
  } finally {
    await pool.end();
  }
  return { email, id: data.user.id as string };
}

type Mail = { id: string; to: string[]; subject: string; text: string; html: string };
/** Read mail captured by the local Brevo stub for this unique recipient only. */
export async function mailLink(
  request: APIRequestContext,
  email: string,
  subject: string,
  baseURL: string,
) {
  const stub = process.env.BREVO_STUB_URL ?? 'http://127.0.0.1:4010';
  let message: Mail | undefined;
  await expect
    .poll(
      async () => {
        const result = await request.get(`${stub}/messages`, {
          params: { to: email },
          timeout: 5_000,
        });
        expect(result.ok(), 'Brevo stub lookup failed').toBeTruthy();
        const body = await result.json();
        message = (body.messages as Mail[]).findLast(
          (m) => m.subject === subject && m.to.includes(email.toLowerCase()),
        );
        return Boolean(message);
      },
      { timeout: 20_000, intervals: [250, 500, 1_000], message: `Mail for ${email}: ${subject}` },
    )
    .toBe(true);
  const links =
    (message!.text || message!.html).replaceAll('&amp;', '&').match(/https?:\/\/[^\s<>"']+/g) ?? [];
  const link = links.find((value) => {
    const url = new URL(value);
    return (
      url.origin === new URL(baseURL).origin && /verify-email|reset-password/.test(url.pathname)
    );
  });
  expect(link, 'Mail must contain a real application verification/reset link').toBeTruthy();
  return link!;
}

export async function verify(request: APIRequestContext, email: string, baseURL: string) {
  const link = await mailLink(request, email, 'Verify your Jarxis email', baseURL);
  const response = await request.get(link, { maxRedirects: 0 });
  expect([200, 302, 303]).toContain(response.status());
  expect(response.headers().location ?? '').not.toContain('error=');
}

export async function login(
  request: APIRequestContext,
  email: string,
  baseURL: string,
  secret = password,
) {
  const response = await request.post('/api/auth/sign-in/email', {
    headers: originHeaders(baseURL),
    data: { email, password: secret },
  });
  expect(response.status(), await response.text()).toBe(200);
  return response;
}

/**
 * Assign a code-declared role by writing `app_user.role` directly.
 *
 * Roles live in `src/lib/permissions.ts`, so acceptance tests only ever set the stored name. The
 * previous implementation inserted a `user_roles` row; that table is gone.
 */
export async function setRole(id: string, role: string) {
  const pool = testDatabase();
  try {
    const result = await pool.query(
      `UPDATE app_user
         SET role = CASE
               WHEN role IS NULL OR role = '' THEN $2
               WHEN role LIKE '%' || $2 || '%' THEN role
               ELSE role || ',' || $2
             END,
             updated_at = now()
       WHERE id = $1 AND email_verified = true
       RETURNING id`,
      [id, role],
    );
    expect(result.rowCount, 'Verified account required for acceptance tests').toBe(1);
  } finally {
    await pool.end();
  }
}

export async function makeOwner(id: string) {
  await setRole(id, 'owner');
}

/**
 * On a cold dev server the admin shell streams in after `load`, and React batches the reveal, so
 * for a moment the AdminShellSkeleton sidebar and the still-hidden real one are both in the DOM.
 * The skeleton is removed in the same step that reveals the shell, so wait for it to go before
 * using strict `[data-slot="sidebar"]` locators.
 */
export async function waitForAdminShell(page: Page) {
  await expect(page.getByRole('status').filter({ hasText: 'Loading administration' })).toHaveCount(
    0,
  );
}
