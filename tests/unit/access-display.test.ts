import { describe, expect, it } from 'vitest';

import {
  describeRoles,
  grantsForRoles,
  guideCategories,
  ownerBlockedReason,
  roleOptions,
  splitRoleValue,
} from '@/lib/access-display';

const categories = new Map(guideCategories.map((category) => [category.id, category]));

describe('access management descriptions', () => {
  it('keeps every stored role visible while unknown roles grant nothing', () => {
    const stored = splitRoleValue(' user, viewer, legacy-manager ');
    expect(stored).toEqual(['user', 'viewer', 'legacy-manager']);
    expect(describeRoles(stored).map(({ label, known }) => ({ label, known }))).toEqual([
      { label: 'User', known: true },
      { label: 'Viewer', known: true },
      { label: 'legacy-manager', known: false },
    ]);
    expect(grantsForRoles(['legacy-manager']).size).toBe(0);
    expect(grantsForRoles(stored)).toEqual(grantsForRoles(['viewer']));
    expect(splitRoleValue(null)).toEqual([]);
  });

  it('offers exactly the declared roles, least access first, each with a description', () => {
    expect(roleOptions.map((role) => role.id)).toEqual([
      'user',
      'viewer',
      'administrator',
      'owner',
    ]);
    expect(roleOptions.every((role) => role.known && role.description.length > 0)).toBe(true);
  });

  it('does not describe an unprivileged user as having read-only administration', () => {
    expect(categories.get('viewing')!.summarise(grantsForRoles(['user']))).toBe('No');
    expect(categories.get('accounts')!.summarise(grantsForRoles(['user']))).toBe('No');
    expect(categories.get('impersonation')!.summarise(grantsForRoles(['administrator']))).toBe(
      'No',
    );
  });

  it('separates administration from ownership in the role guide answers', () => {
    const administrator = grantsForRoles(['administrator']);
    const owner = grantsForRoles(['owner']);
    expect(categories.get('accounts')!.summarise(administrator)).toMatch(/^Yes/);
    expect(categories.get('assign')!.summarise(administrator)).toBe('No');
    expect(categories.get('delete')!.summarise(administrator)).toBe('No');
    expect(categories.get('assign')!.summarise(owner)).toBe('Yes');
    expect(categories.get('impersonation')!.summarise(owner)).toMatch(/administrators/i);
  });

  it('answers the ML providers question for the owner role only', () => {
    const mlProviders = categories.get('ml-providers')!;
    expect(mlProviders.title).toBe('Managing ML providers');
    expect(mlProviders.summarise(grantsForRoles(['owner']))).toBe('Yes');
    for (const role of ['administrator', 'viewer', 'user'] as const) {
      expect(mlProviders.summarise(grantsForRoles([role]))).toBe('No');
    }
  });

  it('blocks Owner eligibility for unverified or actively banned accounts', () => {
    expect(ownerBlockedReason({ emailVerified: false })).toMatch(/verified email/i);
    expect(ownerBlockedReason({ emailVerified: true, banned: true })).toMatch(/banned/i);
    expect(ownerBlockedReason({ emailVerified: true, banned: false })).toBeUndefined();
    expect(
      ownerBlockedReason({
        emailVerified: true,
        banned: true,
        banExpires: new Date('2000-01-01'),
      }),
    ).toBeUndefined();
    expect(
      ownerBlockedReason({
        emailVerified: true,
        banned: true,
        banExpires: '2100-01-01T00:00:00.000Z',
      }),
    ).toMatch(/banned/i);
  });
});
