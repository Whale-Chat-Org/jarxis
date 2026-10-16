import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpError } from '@/lib/errors';

const m = vi.hoisted(() => ({
  listRoles: vi.fn(),
  requireRoleReader: vi.fn(),
  requireRoleOwner: vi.fn(),
  createCustomRole: vi.fn(),
  updateCustomRole: vi.fn(),
  deleteCustomRole: vi.fn(),
}));

vi.mock('@/lib/custom-roles', async () => ({
  roleInput: (await vi.importActual<typeof import('@/lib/custom-roles')>('@/lib/custom-roles'))
    .roleInput,
  listRoles: m.listRoles,
}));
vi.mock('@/lib/custom-role-service', () => ({
  requireRoleReader: m.requireRoleReader,
  requireRoleOwner: m.requireRoleOwner,
  createCustomRole: m.createCustomRole,
  updateCustomRole: m.updateCustomRole,
  deleteCustomRole: m.deleteCustomRole,
}));
vi.mock('@/db', () => ({ db: {} }));

const roles = await import('@/app/api/admin/roles/route');
const roleByKey = await import('@/app/api/admin/roles/[key]/route');

const send = (method: string, body?: unknown) =>
  new Request('http://localhost/api/admin/roles', {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const context = { params: Promise.resolve({ key: 'custom_a' }) };
const input = { name: 'Auditor', description: '', permissions: ['audit:read'] };

beforeEach(() => {
  vi.clearAllMocks();
  m.requireRoleOwner.mockResolvedValue('owner-1');
});

describe('/api/admin/roles', () => {
  it('lists roles for readers', async () => {
    m.listRoles.mockResolvedValue([{ key: 'owner' }]);
    const response = await roles.GET(send('GET'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ roles: [{ key: 'owner' }] });
    expect(m.requireRoleReader).toHaveBeenCalled();
  });

  it('creates a role as the owner', async () => {
    m.createCustomRole.mockResolvedValue({ key: 'custom_a' });
    const response = await roles.POST(send('POST', input));
    expect(response.status).toBe(201);
    expect(m.createCustomRole).toHaveBeenCalledWith('owner-1', input);
  });

  it('returns readable validation errors', async () => {
    const response = await roles.POST(send('POST', { ...input, name: 'A' }));
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error.issues[0].message).toBe('Role name must be at least 2 characters');
    expect(m.createCustomRole).not.toHaveBeenCalled();
  });

  it('passes guard failures through as errors', async () => {
    m.requireRoleOwner.mockRejectedValue(new HttpError(403, 'FORBIDDEN', 'Owner access required'));
    expect((await roles.POST(send('POST', input))).status).toBe(403);
    expect((await roleByKey.PATCH(send('PATCH', input), context)).status).toBe(403);
    expect((await roleByKey.DELETE(send('DELETE'), context)).status).toBe(403);
    expect(m.createCustomRole).not.toHaveBeenCalled();
    expect(m.deleteCustomRole).not.toHaveBeenCalled();
  });
});

describe('/api/admin/roles/[key]', () => {
  it('updates and deletes the keyed role', async () => {
    m.updateCustomRole.mockResolvedValue({ key: 'custom_a', name: 'Auditor' });
    const updated = await roleByKey.PATCH(send('PATCH', input), context);
    expect(updated.status).toBe(200);
    expect(m.updateCustomRole).toHaveBeenCalledWith('owner-1', 'custom_a', input);

    const deleted = await roleByKey.DELETE(send('DELETE'), context);
    expect(await deleted.json()).toEqual({ deleted: true });
    expect(m.deleteCustomRole).toHaveBeenCalledWith('owner-1', 'custom_a');
  });
});
