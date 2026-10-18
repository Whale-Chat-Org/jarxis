import { APIError } from 'better-auth';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  betterAuth: vi.fn(),
  prismaAdapter: vi.fn(() => 'prisma-adapter'),
  admin: vi.fn(() => 'admin-plugin'),
  openAPI: vi.fn(() => 'openapi-plugin'),
  sendMail: vi.fn(),
  userFind: vi.fn(),
  tx: {
    $queryRaw: vi.fn(),
    tokenFamily: { updateMany: vi.fn() },
    session: { deleteMany: vi.fn() },
  },
  generateOpenAPISchema: vi.fn(),
  env: {
    NODE_ENV: 'production',
    BETTER_AUTH_URL: 'https://jarxis.example.com/app',
    BETTER_AUTH_SECRET: 'a'.repeat(64),
    TRUST_PROXY: true,
  } as Record<string, unknown>,
}));

vi.mock('better-auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('better-auth')>()),
  betterAuth: m.betterAuth,
}));
vi.mock('@better-auth/prisma-adapter', () => ({ prismaAdapter: m.prismaAdapter }));
vi.mock('better-auth/plugins/admin', () => ({ admin: m.admin }));
vi.mock('better-auth/plugins', () => ({ openAPI: m.openAPI }));
vi.mock('@/lib/mailer', () => ({ sendMail: m.sendMail }));
vi.mock('@/lib/env', () => ({ env: () => m.env }));
vi.mock('@/lib/auth/admin-guards', () => ({
  adminAuditHook: 'after-hook',
  adminMutationGuard: 'before-hook',
  userStatusHooks: 'user-hooks',
}));
vi.mock('@/db', () => ({
  db: {
    user: { findUnique: m.userFind },
    $transaction: async (fn: (tx: unknown) => unknown) => fn(m.tx),
  },
}));

m.betterAuth.mockImplementation((options: unknown) => ({
  options,
  api: { generateOpenAPISchema: m.generateOpenAPISchema },
}));

const { getAuth } = await import('@/lib/auth');
const { openapi } = await import('@/lib/openapi');
getAuth();
const pluginCalls = {
  betterAuth: m.betterAuth.mock.calls.length,
  admin: m.admin.mock.calls.map((c) => (c as unknown[])[0]),
  openAPI: m.openAPI.mock.calls.map((c) => (c as unknown[])[0]),
};

type Options = {
  disabledPaths: string[];
  trustedOrigins: string[];
  emailAndPassword: {
    minPasswordLength: number;
    requireEmailVerification: boolean;
    revokeSessionsOnPasswordReset: boolean;
    sendResetPassword: (a: { user: { email: string }; url: string }) => Promise<unknown>;
    onPasswordReset: (a: { user: { id: string } }) => Promise<void>;
  };
  emailVerification: {
    sendVerificationEmail: (a: { user: { email: string }; url: string }) => Promise<unknown>;
  };
  session: { cookieCache: { enabled: boolean } };
  hooks: { before: unknown; after: unknown };
  databaseHooks: {
    session: { create: { before: (s: { userId: string }) => Promise<unknown> } };
    user: unknown;
  };
  advanced: { useSecureCookies: boolean; ipAddress: { ipAddressHeaders: string[] } };
  rateLimit: { enabled: boolean };
};
const options = () => (getAuth() as unknown as { options: Options }).options;

beforeEach(() => {
  m.sendMail.mockReset();
  m.userFind.mockReset();
});

describe('Better Auth configuration', () => {
  it('builds a single instance', () => {
    expect(getAuth()).toBe(getAuth());
    expect(pluginCalls.betterAuth).toBe(1);
    expect(m.betterAuth).not.toHaveBeenCalled();
  });

  it('disables social and token endpoints and trusts only the app origin', () => {
    const o = options();
    expect(o.disabledPaths).toEqual(
      expect.arrayContaining([
        '/sign-in/social',
        '/link-social',
        '/get-access-token',
        '/refresh-token',
      ]),
    );
    expect(o.trustedOrigins).toEqual(['https://jarxis.example.com']);
  });

  it('enforces password and verification rules', () => {
    const o = options();
    expect(o.emailAndPassword.minPasswordLength).toBe(12);
    expect(o.emailAndPassword.requireEmailVerification).toBe(true);
    expect(o.emailAndPassword.revokeSessionsOnPasswordReset).toBe(true);
    expect(o.session.cookieCache.enabled).toBe(false);
    expect(o.rateLimit.enabled).toBe(false);
  });

  it('wires the admin guards and plugins', () => {
    const o = options();
    expect(o.hooks).toEqual({ before: 'before-hook', after: 'after-hook' });
    expect(o.databaseHooks.user).toBe('user-hooks');
    expect((o as unknown as { plugins: unknown[] }).plugins).toEqual([
      'openapi-plugin',
      'admin-plugin',
    ]);
    expect(pluginCalls.admin).toEqual([
      expect.objectContaining({
        defaultRole: 'user',
        adminRoles: ['owner', 'administrator'],
        impersonationSessionDuration: 3600,
      }),
    ]);
    expect(pluginCalls.openAPI).toEqual([{ disableDefaultReference: true }]);
  });

  it('uses secure cookies and the proxy IP header in production behind a trusted proxy', () => {
    expect(options().advanced).toEqual({
      useSecureCookies: true,
      ipAddress: { ipAddressHeaders: ['x-real-ip'] },
    });
  });

  it('uses plain cookies and ignores proxy headers in development without a proxy', async () => {
    m.env.NODE_ENV = 'development';
    m.env.TRUST_PROXY = false;
    vi.resetModules();
    const fresh = await import('@/lib/auth');
    expect((fresh.getAuth() as unknown as { options: Options }).options.advanced).toEqual({
      useSecureCookies: false,
      ipAddress: { ipAddressHeaders: [] },
    });
    m.env.NODE_ENV = 'production';
    m.env.TRUST_PROXY = true;
  });

  it('sends reset and verification links by mail', async () => {
    const o = options();
    await o.emailAndPassword.sendResetPassword({
      user: { email: 'u@example.com' },
      url: 'https://x/reset',
    });
    expect(m.sendMail).toHaveBeenCalledWith({
      to: 'u@example.com',
      subject: 'Reset your Jarxis password',
      text: expect.stringContaining('https://x/reset'),
    });
    await o.emailVerification.sendVerificationEmail({
      user: { email: 'u@example.com' },
      url: 'https://x/verify',
    });
    expect(m.sendMail).toHaveBeenLastCalledWith(
      expect.objectContaining({ subject: 'Verify your Jarxis email' }),
    );
  });

  it('revokes every token family and session after a password reset', async () => {
    await options().emailAndPassword.onPasswordReset({ user: { id: 'u1' } });
    expect(m.tx.$queryRaw).toHaveBeenCalled();
    expect(m.tx.tokenFamily.updateMany).toHaveBeenCalledWith({
      where: { userId: 'u1' },
      data: { revokedAt: expect.any(Date) },
    });
    expect(m.tx.session.deleteMany).toHaveBeenCalledWith({ where: { userId: 'u1' } });
  });

  it('refuses new sessions for missing, unverified or banned accounts', async () => {
    const before = options().databaseHooks.session.create.before;
    for (const user of [
      null,
      { emailVerified: false, banned: false },
      { emailVerified: true, banned: true, banExpires: null },
    ]) {
      m.userFind.mockResolvedValueOnce(user);
      const error = await before({ userId: 'u1' }).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(APIError);
      expect((error as APIError).statusCode).toBe(403);
    }
    m.userFind.mockResolvedValueOnce({ emailVerified: true, banned: false });
    await expect(before({ userId: 'u1' })).resolves.toEqual({ data: { userId: 'u1' } });
  });
});

describe('OpenAPI document', () => {
  it('merges native paths, hides disabled ones and documents the app routes', async () => {
    m.generateOpenAPISchema.mockResolvedValue({
      openapi: '3.0.0',
      paths: {
        '/sign-in/email': { post: {} },
        '/sign-in/social': { post: {} },
        '/callback': { get: {} },
        '/callback/{id}': { get: {} },
        '/account-info': { get: {} },
      },
      components: { securitySchemes: { native: { type: 'http' } } },
    });
    const doc = (await openapi()) as {
      openapi: string;
      servers: Array<{ url: string }>;
      paths: Record<
        string,
        Record<string, { security?: unknown[]; tags?: string[]; requestBody?: unknown }>
      >;
      components: { securitySchemes: Record<string, { name?: string }> };
    };
    expect(doc.openapi).toBe('3.1.1');
    expect(doc.servers).toEqual([{ url: 'https://jarxis.example.com' }]);
    expect(doc.paths['/api/auth/sign-in/email']).toBeDefined();
    for (const hidden of [
      '/api/auth/sign-in/social',
      '/api/auth/callback',
      '/api/auth/callback/{id}',
      '/api/auth/account-info',
    ])
      expect(doc.paths[hidden]).toBeUndefined();

    expect(doc.paths['/api/v1/auth/login'].post.security).toEqual([]);
    expect(doc.paths['/api/v1/auth/login'].post.requestBody).toBeDefined();
    expect(doc.paths['/api/v1/auth/logout'].post.security).toEqual([{ bearerAuth: [] }]);
    expect(doc.paths['/api/v1/me'].get.security).toEqual([{ bearerAuth: [] }, { cookieAuth: [] }]);
    expect(doc.paths['/api/llm/v1/chat/completions'].post.security).toEqual([{ gatewayKey: [] }]);
    expect(doc.paths['/api/admin/providers'].get.security).toEqual([{ cookieAuth: [] }]);
    expect(doc.paths['/api/admin/providers/{id}/refresh'].post).toBeDefined();
    expect(doc.paths['/api/admin/providers/{id}/models'].post).toBeDefined();
    expect(doc.paths['/api/admin/providers/keys/{keyId}'].delete).toBeDefined();
    expect(doc.components.securitySchemes.native).toBeDefined();
    expect(doc.components.securitySchemes.cookieAuth.name).toBe(
      '__Secure-better-auth.session_token',
    );
  });

  it('uses the development cookie name outside production and tolerates missing components', async () => {
    m.env.NODE_ENV = 'development';
    m.generateOpenAPISchema.mockResolvedValue({ paths: {} });
    const doc = (await openapi()) as {
      components: { securitySchemes: Record<string, { name?: string }> };
    };
    expect(doc.components.securitySchemes.cookieAuth.name).toBe('better-auth.session_token');
    expect(doc.components.securitySchemes.bearerAuth).toBeDefined();
    m.env.NODE_ENV = 'production';
  });
});
