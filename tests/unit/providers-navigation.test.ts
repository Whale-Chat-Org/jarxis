import { describe, expect, it } from 'vitest';

import { isNavItemActive, NAV_GROUPS, visibleNavGroups } from '@/components/admin/nav-items';
import { flattenStatements, roles } from '@/lib/permissions';

describe('Provider navigation', () => {
  it('shows the provider screen to owners and hides it from administrators', () => {
    const links = (permissions: string[]) =>
      visibleNavGroups(permissions).flatMap((group) => group.items.map((item) => item.href));
    expect(links(flattenStatements(roles.owner))).toContain('/admin/providers');
    expect(links(flattenStatements(roles.administrator))).not.toContain('/admin/providers');
  });

  it('requires the provider read grant', () => {
    const item = NAV_GROUPS.flatMap((group) => group.items).find(
      (entry) => entry.href === '/admin/providers',
    );
    expect(item?.permission).toBe('providers:read');
    expect(visibleNavGroups(['providers:manage']).flatMap((group) => group.items)).not.toContain(
      item,
    );
    expect(visibleNavGroups(['providers:read']).flatMap((group) => group.items)).toContain(item);
  });

  it('drops General when no navigation items are permitted', () => {
    expect(visibleNavGroups([])).toEqual([]);
  });

  it('activates the provider page without activating the overview', () => {
    expect(isNavItemActive('/admin/providers', '/admin/providers')).toBe(true);
    expect(isNavItemActive('/admin/providers', '/admin')).toBe(false);
  });
});
