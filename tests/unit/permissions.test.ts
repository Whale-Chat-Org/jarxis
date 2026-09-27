import { describe, it, expect } from 'vitest';
import {
  adminPermissionCatalog,
  declaredPermissionKeys,
  flattenStatements,
  isAllowed,
  ownerOnly,
  permissionKeys,
  roleCatalog,
  roleNames,
  roles,
  statement,
} from '@/lib/permissions';
import { loginInput, refreshInput } from '@/lib/validation';

const declared = new Set(
  Object.entries(statement).flatMap(([resource, actions]) =>
    (actions as readonly string[]).map((action) => `${resource}:${action}`),
  ),
);

describe('permission policy', () => {
  it('denies by default', () => expect(isAllowed(new Set(), [], 'users:read')).toBe(false));
  it('unions permissions independently of role labels', () => {
    const union = new Set(['users:read', 'audit:read']);
    expect(isAllowed(union, ['custom-a', 'custom-b'], 'audit:read')).toBe(true);
  });
  it('does not grant implicit owner privileges', () =>
    expect(isAllowed(new Set(), ['owner'], 'roles:update')).toBe(false));
  it('requires actual owner membership for assignment', () => {
    expect(isAllowed(new Set(permissionKeys), ['administrator'], 'roles:assign')).toBe(false);
    expect(isAllowed(new Set(permissionKeys), ['owner'], 'roles:assign')).toBe(true);
  });
});

describe('code-declared roles', () => {
  it('declares a catalogue entry for every role', () => {
    for (const name of roleNames) expect(roleCatalog[name]).toBeDefined();
  });

  it('grants nothing to the default role', () => {
    expect(flattenStatements(roles.user)).toEqual([]);
  });

  it('keeps role grants inside the declared statement map', () => {
    const undeclared = declaredPermissionKeys.filter((key) => !declared.has(key));
    expect(undeclared).toEqual([]);
  });

  it('leaves no project permission ungranted by some role', () => {
    const granted = new Set(declaredPermissionKeys);
    expect(permissionKeys.filter((key) => !granted.has(key))).toEqual([]);
  });

  it('restricts destructive administration actions to owners', () => {
    for (const key of ownerOnly) expect(flattenStatements(roles.owner)).toContain(key);
    for (const role of ['administrator', 'viewer'] as const) {
      const granted = flattenStatements(roles[role]);
      expect(granted).not.toContain('roles:update');
      expect(granted).not.toContain('roles:assign');
      expect(granted).not.toContain('user:set-role');
      expect(granted).not.toContain('user:delete');
    }
  });

  it('keeps viewers read-only and unable to touch sessions', () => {
    const granted = flattenStatements(roles.viewer);
    expect(granted).toContain('users:read');
    expect(granted).not.toContain('users:update');
    expect(granted).not.toContain('user:update');
    expect(granted.filter((key) => key.startsWith('session:'))).toEqual([]);
  });

  it('documents every declared permission', () => {
    const documented = new Set([...permissionKeys, ...Object.keys(adminPermissionCatalog)]);
    expect(declaredPermissionKeys.filter((key) => !documented.has(key))).toEqual([]);
  });
});

describe('input validation', () => {
  it('rejects malformed login payloads', () => {
    expect(loginInput.safeParse({ email: 'not-an-email', password: 'x' }).success).toBe(false);
    expect(loginInput.safeParse({ email: 'a@b.test', password: '' }).success).toBe(false);
    expect(
      loginInput.safeParse({ email: 'a@b.test', password: 'secret', role: 'owner' }).success,
    ).toBe(false);
  });
  it('rejects malformed refresh tokens', () => {
    expect(refreshInput.safeParse({ refreshToken: 'short' }).success).toBe(false);
    expect(refreshInput.safeParse({ refreshToken: 'a'.repeat(64) }).success).toBe(true);
  });
});
