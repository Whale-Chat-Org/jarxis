import { describe, expect, it } from 'vitest';

import { isNavItemActive, NAV_ITEMS, visibleNavGroups } from '@/components/admin/nav-items';
import { flattenStatements, roles } from '@/lib/permissions';

describe('ML provider navigation', () => {
  it('shows the provider screen to owners and hides it from administrators', () => {
    const links = (permissions: string[]) =>
      visibleNavGroups(permissions).flatMap((group) => group.items.map((item) => item.href));
    expect(links(flattenStatements(roles.owner))).toContain('/admin/ml-providers');
    expect(links(flattenStatements(roles.administrator))).not.toContain('/admin/ml-providers');
  });

  it('requires the provider read grant', () => {
    const item = NAV_ITEMS.find((entry) => entry.href === '/admin/ml-providers');
    expect(item?.permission).toBe('providers:read');
    expect(visibleNavGroups(['providers:manage']).flatMap((group) => group.items)).not.toContain(
      item,
    );
    expect(visibleNavGroups(['providers:read']).flatMap((group) => group.items)).toContain(item);
  });

  it('drops the empty provider group', () => {
    expect(visibleNavGroups([]).some((group) => group.id === 'ml')).toBe(false);
  });

  it('activates the provider page without activating the overview', () => {
    expect(isNavItemActive('/admin/ml-providers', '/admin/ml-providers')).toBe(true);
    expect(isNavItemActive('/admin/ml-providers', '/admin')).toBe(false);
  });
});
