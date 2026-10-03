import { expect, type APIRequestContext } from '@playwright/test';
import { test } from './fixtures';
import { password, register, testDatabase, uniqueEmail, verify } from './helpers';

/**
 * Emailed first-owner setup (`/setup`).
 *
 * Unlike the rest of this suite, these tests need a *fresh* deployment: `/setup` closes
 * permanently once an owner exists. They therefore truncate the account tables, the verification
 * table and the setup marker before the first test, and are `serial` so nothing else registers in
 * between. Truncating `app_user` cascades the pending owner setup requests.
 *
 * `testDatabase()` refuses any URL whose path is not `jarxis_test[_suffix]`, so this reset can
 * never run against a generic development database. Mail is captured by the local Brevo stub, so
 * no real message is delivered; codes are read from the stub and never printed.
 *
 * They also cover the onboarding redirect: while setup is available, `/` and `/auth/sign-in`
 * redirect to `/setup` on the server, and once the marker exists (even for an inactive owner)
 * both render normally again.
 */
const CODE_SUBJECT = 'Verify your Jarxis Owner email';
const stubURL = () => process.env.BREVO_STUB_URL ?? 'http://127.0.0.1:4010';

async function resetDeployment() {
  const pool = testDatabase();
  try {
    await pool.query('TRUNCATE app_user, verification, audit_logs, installation_setup CASCADE');
  } finally {
    await pool.end();
  }
}

/** Latest six-digit setup code captured for this recipient. Returned, never logged. */
async function setupCode(request: APIRequestContext, email: string) {
  let code: string | undefined;
  await expect
    .poll(
      async () => {
        const result = await request.get(`${stubURL()}/messages`, {
          params: { to: email },
          timeout: 5_000,
        });
        expect(result.ok(), 'Brevo stub lookup failed').toBeTruthy();
        const messages = (await result.json()).messages as {
          to: string[];
          subject: string;
          text: string;
        }[];
        const mail = messages.findLast(
          (m) => m.subject === CODE_SUBJECT && m.to.includes(email.toLowerCase()),
        );
        code = mail ? /\b\d{6}\b/.exec(mail.text ?? '')?.[0] : undefined;
        return Boolean(code);
      },
      { timeout: 20_000, intervals: [250, 500, 1_000], message: `Setup code for ${email}` },
    )
    .toBe(true);
  return code!;
}

async function post(
  request: APIRequestContext,
  baseURL: string,
  path: string,
  body: Record<string, unknown>,
) {
  return request.post(path, { headers: { Origin: new URL(baseURL).origin }, data: body });
}

async function userRow(email: string) {
  const pool = testDatabase();
  try {
    const { rows } = await pool.query<{ id: string; role: string | null; email_verified: boolean }>(
      'SELECT id, role, email_verified FROM app_user WHERE email = $1',
      [email],
    );
    return rows;
  } finally {
    await pool.end();
  }
}

/** Move the resend cooldown into the past so the next resend is allowed immediately. */
async function expireCooldown(requestId: string) {
  const pool = testDatabase();
  try {
    const result = await pool.query(
      "UPDATE owner_setup_requests SET last_sent_at = now() - interval '5 minutes' WHERE id = $1",
      [requestId],
    );
    expect(result.rowCount, 'The pending setup request must exist').toBe(1);
  } finally {
    await pool.end();
  }
}

/**
 * Sign in through the API rather than the sign-in page.
 *
 * While setup is still available `/auth/sign-in` redirects to `/setup`, so a pending candidate
 * can only be probed directly. Better Auth requires a same-origin `Origin` header.
 */
async function signInRequest(request: APIRequestContext, baseURL: string, email: string) {
  return post(request, baseURL, '/api/auth/sign-in/email', { email, password });
}

/** `/` and `/auth/sign-in` both open setup while the installation has no owner. */
async function expectSetupRedirect(page: import('@playwright/test').Page, from: string) {
  await page.goto(from);
  await expect(page).toHaveURL(/\/setup$/);
}

async function signIn(page: import('@playwright/test').Page, email: string) {
  await page.goto('/auth/sign-in');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.locator('input[name="password"]').fill(password);
  const response = page.waitForResponse(
    (r) => r.url().includes('/api/auth/sign-in/email') && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Sign In', exact: true }).click();
  return (await response).status();
}

test.describe.serial('emailed first-owner setup', () => {
  test('the form emails a code; the candidate cannot sign in until it is verified', async ({
    page,
    request,
    baseURL,
  }) => {
    await resetDeployment();
    const email = uniqueEmail();

    // A fresh deployment funnels both entry points into setup, so an operator never has to know
    // the URL. Other auth views stay reachable.
    await expectSetupRedirect(page, '/');
    await expectSetupRedirect(page, '/auth/sign-in');
    await page.goto('/auth/sign-up');
    await expect(page).toHaveURL(/\/auth\/sign-up$/);
    await expect(page.getByLabel('Email', { exact: true })).toBeVisible();
    await page.goto('/auth/forgot-password');
    await expect(page).toHaveURL(/\/auth\/forgot-password$/);
    await expect(page.getByLabel('Email', { exact: true })).toBeVisible();

    await page.goto('/setup');
    await expect(page.getByRole('heading', { name: 'Create the first owner' })).toBeVisible();
    // No setup secret is involved in this flow any more.
    expect(await page.getByLabel('Setup secret', { exact: true }).count()).toBe(0);
    await page.getByLabel('Name', { exact: true }).fill('Olivia Owner');
    await page.getByLabel('Email', { exact: true }).fill(email);
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.screenshot({
      path: test.info().outputPath('setup-form.png'),
      fullPage: true,
      caret: 'initial',
    });

    const started = page.waitForResponse(
      (r) => r.url().endsWith('/api/setup') && r.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'Email me a code' }).click();
    const startResponse = await started;
    expect(startResponse.status()).toBe(202);
    const startBody = await startResponse.json();
    expect(startBody.email).toBe(email);
    expect(JSON.stringify(startBody)).not.toMatch(/\b\d{6}\b/);

    // The UI moves to the code step.
    const codeField = page.getByLabel('Owner code', { exact: true });
    await expect(codeField).toBeVisible();

    // Pending in the database: unverified, ordinary role, and sign-in is denied. The sign-in page
    // itself redirects to setup while the flow is open, so this is checked against the API.
    const [pending] = await userRow(email);
    expect(pending.email_verified).toBe(false);
    expect(pending.role ?? '').not.toContain('owner');
    const denied = await signInRequest(request, baseURL!, email);
    expect(denied.status(), await denied.text()).toBe(403);
    expect(await (await request.get('/api/auth/get-session')).json()).toBeNull();
    expect((await request.get('/api/auth/admin/list-users')).ok()).toBe(false);

    // A pending request still redirects both entry points, and the resumed page keeps the code
    // step rather than restarting the form.
    for (const from of ['/', '/auth/sign-in']) {
      await expectSetupRedirect(page, from);
      await expect(page.getByLabel('Owner code', { exact: true })).toBeVisible();
      expect(await page.getByLabel('Password', { exact: true }).count()).toBe(0);
    }

    const code = await setupCode(request, email);
    await page.goto('/setup');
    await expect(page.getByLabel('Owner code', { exact: true })).toBeVisible();
    await page.getByLabel('Owner code', { exact: true }).fill(code);
    const verified = page.waitForResponse(
      (r) => r.url().endsWith('/api/setup/verify') && r.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'Verify and create owner' }).click();
    const verifyResponse = await verified;
    expect(verifyResponse.status()).toBe(200);
    // The page navigates immediately after consuming the response; waiting on its body through
    // Playwright can race navigation. The API response shape is checked by the unit suite.
    await expect(page).toHaveURL(/\/auth\/sign-in/);

    const [owner] = await userRow(email);
    expect(owner.role).toContain('owner');
    expect(owner.email_verified).toBe(true);
    // Setup is closed, so the ordinary pages are served again.
    await page.goto('/');
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('heading', { name: 'Jarxis', exact: true })).toBeVisible();
    await page.goto('/auth/sign-in');
    await expect(page).toHaveURL(/\/auth\/sign-in$/);
    expect(await signIn(page, email)).toBe(200);
    expect((await page.request.get('/api/auth/admin/list-users')).status()).toBe(200);
    const member = await register(request, baseURL!);
    const assigned = await post(page.request, baseURL!, '/api/auth/admin/set-role', {
      userId: member.id,
      role: 'viewer',
    });
    expect(assigned.status()).toBe(200);
    expect((await userRow(member.email))[0].role).toBe('viewer');
  });

  test('a wrong code is rejected and an exhausted request stops accepting the real one', async ({
    request,
    baseURL,
  }) => {
    await resetDeployment();
    const email = uniqueEmail();
    const started = await post(request, baseURL!, '/api/setup', {
      name: 'Wrong Code',
      email,
      password,
    });
    expect(started.status(), await started.text()).toBe(202);
    const { requestId } = await started.json();
    const code = await setupCode(request, email);
    const wrong = code === '000000' ? '111111' : '000000';

    const rejected = await post(request, baseURL!, '/api/setup/verify', { requestId, code: wrong });
    expect(rejected.status()).toBe(400);
    expect((await userRow(email))[0].role ?? '').not.toContain('owner');

    // Attempts two to four are still ordinary rejections.
    for (let attempt = 2; attempt <= 4; attempt += 1) {
      const response = await post(request, baseURL!, '/api/setup/verify', {
        requestId,
        code: wrong,
      });
      expect(response.status(), `attempt ${attempt}`).toBe(400);
    }
    // The fifth wrong code reaches the attempt limit, so it is rate-limited rather than invalid.
    const burned = await post(request, baseURL!, '/api/setup/verify', { requestId, code: wrong });
    expect(burned.status()).toBe(429);
    // The real code is refused from then on.
    const exhausted = await post(request, baseURL!, '/api/setup/verify', { requestId, code });
    expect(exhausted.status()).toBe(429);
    const [stillPending] = await userRow(email);
    expect(stillPending.email_verified).toBe(false);
    expect(stillPending.role ?? '').not.toContain('owner');
  });

  test('an expired code is rejected', async ({ request, baseURL }) => {
    await resetDeployment();
    const email = uniqueEmail();
    const started = await post(request, baseURL!, '/api/setup', {
      name: 'Expired Code',
      email,
      password,
    });
    expect(started.status()).toBe(202);
    const { requestId } = await started.json();
    const code = await setupCode(request, email);

    const pool = testDatabase();
    try {
      await pool.query(
        "UPDATE owner_setup_requests SET expires_at = now() - interval '1 minute' WHERE id = $1",
        [requestId],
      );
    } finally {
      await pool.end();
    }
    const expired = await post(request, baseURL!, '/api/setup/verify', { requestId, code });
    expect(expired.status()).toBe(400);
    expect((await userRow(email))[0].email_verified).toBe(false);
  });

  test('resend is rate limited, then issues a new code that invalidates the previous one', async ({
    request,
    baseURL,
  }) => {
    await resetDeployment();
    const email = uniqueEmail();
    const started = await post(request, baseURL!, '/api/setup', {
      name: 'Resend Owner',
      email,
      password,
    });
    expect(started.status()).toBe(202);
    const { requestId } = await started.json();
    const first = await setupCode(request, email);

    const tooSoon = await post(request, baseURL!, '/api/setup/resend', { requestId });
    expect(tooSoon.status()).toBe(429);

    await expireCooldown(requestId);
    const resent = await post(request, baseURL!, '/api/setup/resend', { requestId });
    expect(resent.status(), await resent.text()).toBe(202);
    const resentBody = await resent.text();
    expect(resentBody).not.toMatch(/\b\d{6}\b/);

    let second = first;
    await expect
      .poll(
        async () => {
          second = await setupCode(request, email);
          return second !== first;
        },
        { timeout: 20_000, intervals: [250, 500, 1_000] },
      )
      .toBe(true);

    const stale = await post(request, baseURL!, '/api/setup/verify', { requestId, code: first });
    expect(stale.status()).toBe(400);
    const accepted = await post(request, baseURL!, '/api/setup/verify', {
      requestId,
      code: second,
    });
    expect(accepted.status(), await accepted.text()).toBe(200);
    const [owner] = await userRow(email);
    expect(owner.role).toContain('owner');
    expect(owner.email_verified).toBe(true);
  });

  test('setup is permanently closed once an owner exists', async ({ page, request, baseURL }) => {
    // The previous test left a verified owner in place.
    const pool = testDatabase();
    try {
      const { rows } = await pool.query(
        "SELECT id FROM app_user WHERE role LIKE '%owner%' AND email_verified = true",
      );
      expect(rows, 'The previous test must have created the owner').toHaveLength(1);
    } finally {
      await pool.end();
    }

    const closed = await post(request, baseURL!, '/api/setup', {
      name: 'Duplicate Owner',
      email: uniqueEmail(),
      password,
    });
    expect(closed.ok(), await closed.text()).toBeFalsy();
    expect(closed.status()).toBe(409);

    await page.goto('/setup');
    await expect(page.getByRole('heading', { name: 'Setup already completed' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Go to sign-in' })).toBeVisible();
  });

  test('setup stays closed after the owner is banned', async ({ page, request, baseURL }) => {
    const pool = testDatabase();
    try {
      await pool.query("UPDATE app_user SET banned = true WHERE role LIKE '%owner%'");
    } finally {
      await pool.end();
    }
    await page.goto('/setup');
    await expect(page.getByRole('heading', { name: 'Setup already completed' })).toBeVisible();
    // An inactive owner does not reopen onboarding: neither entry point redirects.
    await page.goto('/');
    await expect(page).toHaveURL(/\/$/);
    await page.goto('/auth/sign-in');
    await expect(page).toHaveURL(/\/auth\/sign-in$/);
    const response = await post(request, baseURL!, '/api/setup', {
      name: 'Another Owner',
      email: uniqueEmail(),
      password,
    });
    expect(response.status()).toBe(409);
  });

  test('ordinary sign-up still requires link verification after setup', async ({
    page,
    request,
    baseURL,
  }) => {
    const { email } = await register(request, baseURL!);

    expect(await signIn(page, email)).toBe(403);
    expect(await (await page.request.get('/api/auth/get-session')).json()).toBeNull();

    // The ordinary verification mail exists and the account is not an owner.
    await verify(request, email, baseURL!);
    const [user] = await userRow(email);
    expect(user.role ?? '').not.toContain('owner');
  });
});
