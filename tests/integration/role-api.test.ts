import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createHmac, randomUUID } from 'node:crypto';
import { db } from '@/db';
import { resetRoles } from './reset-roles';
import { env } from '@/lib/env';
import { grants } from '@/lib/rbac';
import * as rolesRoute from '@/app/api/admin/roles/route';
import * as roleRoute from '@/app/api/admin/roles/[key]/route';
import * as authRoute from '@/app/api/auth/[...all]/route';

type Actor = { userId: string; cookie: string };

/** A real session row plus the signed Better Auth cookie a browser would send for it. */
async function makeUser(role: string | null, options: { impersonatedBy?: string } = {}) {
  const userId = randomUUID();
  const token = randomUUID();
  await db.user.create({
    data: {
      id: userId,
      name: 'Test User',
      email: `${userId}@example.test`,
      emailVerified: true,
      role,
    },
  });
  await db.session.create({
    data: {
      id: randomUUID(),
      userId,
      token,
      expiresAt: new Date(Date.now() + 86400000),
      impersonatedBy: options.impersonatedBy ?? null,
    },
  });
  const signature = createHmac('sha256', env().BETTER_AUTH_SECRET).update(token).digest('base64');
  return {
    userId,
    cookie: `better-auth.session_token=${encodeURIComponent(`${token}.${signature}`)}`,
  } satisfies Actor;
}

function call(actor: Actor | null, method: string, path: string, body?: unknown, extra = {}) {
  const origin = new URL(env().BETTER_AUTH_URL).origin;
  return new Request(`${origin}${path}`, {
    method,
    headers: {
      origin,
      ...(actor ? { cookie: actor.cookie } : {}),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...extra,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const params = (key: string) => ({ params: Promise.resolve({ key }) });
const auditor = {
  name: 'Auditor',
  description: 'Reads audit',
  permissions: ['dashboard:read', 'audit:read'],
};

async function listed(actor: Actor) {
  const response = await rolesRoute.GET(call(actor, 'GET', '/api/admin/roles'));
  return ((await response.json()) as { roles: { key: string; name: string; userCount?: number }[] })
    .roles;
}

async function setRole(actor: Actor, userId: string, role: string) {
  return authRoute.POST(call(actor, 'POST', '/api/auth/admin/set-role', { userId, role: [role] }));
}

beforeEach(async () => {
  await resetRoles();
});
afterAll(async () => {
  await resetRoles();
  await db.$disconnect();
});

describe('role API', () => {
  it('lets an owner create, rename and delete a role, reflected in the role list', async () => {
    const owner = await makeUser('owner');
    const created = await rolesRoute.POST(call(owner, 'POST', '/api/admin/roles', auditor));
    expect(created.status).toBe(201);
    const { role } = (await created.json()) as { role: { key: string } };
    expect((await listed(owner)).map((item) => item.name)).toContain('Auditor');

    const renamed = await roleRoute.PATCH(
      call(owner, 'PATCH', `/api/admin/roles/${role.key}`, { ...auditor, name: 'Auditor Lite' }),
      params(role.key),
    );
    expect(renamed.status).toBe(200);
    const names = (await listed(owner)).map((item) => item.name);
    expect(names).toContain('Auditor Lite');
    expect(names).not.toContain('Auditor');

    const deleted = await roleRoute.DELETE(
      call(owner, 'DELETE', `/api/admin/roles/${role.key}`),
      params(role.key),
    );
    expect(deleted.status).toBe(200);
    expect((await listed(owner)).some((item) => item.key === role.key)).toBe(false);
  });

  it('refuses non-owners, bearer tokens and impersonated owner sessions', async () => {
    const owner = await makeUser('owner');
    const admin = await makeUser('administrator');
    const impersonated = await makeUser('owner', { impersonatedBy: owner.userId });
    expect((await rolesRoute.POST(call(admin, 'POST', '/api/admin/roles', auditor))).status).toBe(
      403,
    );
    expect(
      (await rolesRoute.POST(call(impersonated, 'POST', '/api/admin/roles', auditor))).status,
    ).toBe(403);
    expect(
      (
        await rolesRoute.POST(
          call(null, 'POST', '/api/admin/roles', auditor, { authorization: 'Bearer anything' }),
        )
      ).status,
    ).toBe(401);
    expect(
      (await rolesRoute.GET(call(await makeUser('user'), 'GET', '/api/admin/roles'))).status,
    ).toBe(403);
    expect((await rolesRoute.GET(call(admin, 'GET', '/api/admin/roles'))).status).toBe(200);
    expect(await db.role.count({ where: { system: false } })).toBe(0);
  });

  it('locks system roles and owner-only permissions, and validates names', async () => {
    const owner = await makeUser('owner');
    for (const key of ['owner', 'user']) {
      expect(
        (
          await roleRoute.PATCH(
            call(owner, 'PATCH', `/api/admin/roles/${key}`, auditor),
            params(key),
          )
        ).status,
      ).toBe(403);
      expect(
        (await roleRoute.DELETE(call(owner, 'DELETE', `/api/admin/roles/${key}`), params(key)))
          .status,
      ).toBe(403);
    }
    for (const permission of ['providers:manage', 'roles:assign', 'user:set-role']) {
      const response = await rolesRoute.POST(
        call(owner, 'POST', '/api/admin/roles', { ...auditor, permissions: [permission] }),
      );
      expect(response.status).toBe(400);
    }
    expect((await rolesRoute.POST(call(owner, 'POST', '/api/admin/roles', auditor))).status).toBe(
      201,
    );
    const duplicate = await rolesRoute.POST(
      call(owner, 'POST', '/api/admin/roles', { ...auditor, name: 'AUDITOR' }),
    );
    expect(duplicate.status).toBe(409);
    const reserved = await rolesRoute.POST(
      call(owner, 'POST', '/api/admin/roles', { ...auditor, name: 'Owner' }),
    );
    expect(reserved.status).toBe(409);
    const short = await rolesRoute.POST(
      call(owner, 'POST', '/api/admin/roles', { ...auditor, name: 'A' }),
    );
    expect(
      ((await short.json()) as { error: { issues: { message: string }[] } }).error.issues[0]
        .message,
    ).toBe('Role name must be at least 2 characters');
    expect(await db.role.count({ where: { system: false } })).toBe(1);
  });
});

describe('assigning custom roles', () => {
  it('lets an owner assign a custom role through set-role, audited and live on the next request', async () => {
    const owner = await makeUser('owner');
    const member = await makeUser('user');
    const created = await rolesRoute.POST(call(owner, 'POST', '/api/admin/roles', auditor));
    const { role } = (await created.json()) as { role: { key: string } };

    const response = await setRole(owner, member.userId, role.key);
    expect(response.status).toBe(200);
    expect((await db.user.findUniqueOrThrow({ where: { id: member.userId } })).role).toBe(role.key);
    expect((await grants(member.userId)).permissions.has('audit:read')).toBe(true);
    expect(
      await db.auditLog.count({ where: { action: 'user.roles.replace', targetId: member.userId } }),
    ).toBe(1);
    expect((await listed(owner)).find((item) => item.key === role.key)?.userCount).toBe(1);

    const inUse = await roleRoute.DELETE(
      call(owner, 'DELETE', `/api/admin/roles/${role.key}`),
      params(role.key),
    );
    expect(inUse.status).toBe(409);
    expect(((await inUse.json()) as { error: { message: string } }).error.message).toBe(
      '1 user must change role first',
    );
  });

  it('refuses role changes from administrators and viewers, and unknown roles', async () => {
    const owner = await makeUser('owner');
    const member = await makeUser('user');
    for (const role of ['administrator', 'viewer']) {
      const actor = await makeUser(role);
      expect((await setRole(actor, member.userId, 'viewer')).status).toBe(403);
    }
    expect((await setRole(owner, member.userId, 'custom_missing')).status).toBe(400);
    expect((await db.user.findUniqueOrThrow({ where: { id: member.userId } })).role).toBe('user');
    expect(await db.auditLog.count({ where: { action: 'user.roles.replace' } })).toBe(0);
  });
});
