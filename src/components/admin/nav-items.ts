import {
  BotIcon,
  KeyRoundIcon,
  LayoutDashboardIcon,
  ScrollTextIcon,
  ShieldCheckIcon,
  UsersIcon,
  type LucideIcon,
} from 'lucide-react';

import type { Permission, adminPermissionCatalog } from '@/lib/permissions';

export type NavItem = {
  title: string;
  href: string;
  permission: Permission;
  additionalPermission?: keyof typeof adminPermissionCatalog;
  icon: LucideIcon;
};

export type NavGroup = {
  id: string;
  label: string;
  items: NavItem[];
};

export const NAV_GROUPS: NavGroup[] = [
  {
    id: 'general',
    label: 'General',
    items: [
      {
        title: 'Overview',
        href: '/admin',
        permission: 'dashboard:read',
        icon: LayoutDashboardIcon,
      },
      {
        title: 'Users',
        href: '/admin/users',
        permission: 'users:read',
        additionalPermission: 'user:list',
        icon: UsersIcon,
      },
      {
        title: 'Roles',
        href: '/admin/roles',
        permission: 'roles:read',
        icon: ShieldCheckIcon,
      },
      {
        title: 'Providers',
        href: '/admin/providers',
        permission: 'providers:read',
        icon: BotIcon,
      },
      {
        title: 'API Keys',
        href: '/admin/api-keys',
        permission: 'providers:read',
        icon: KeyRoundIcon,
      },
      {
        title: 'Audit Log',
        href: '/admin/audit',
        permission: 'audit:read',
        icon: ScrollTextIcon,
      },
    ],
  },
];

// Groups the user can see; empty groups are dropped so no heading renders alone.
export function visibleNavGroups(permissions: readonly string[]) {
  return NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter(
      (item) =>
        permissions.includes(item.permission) &&
        (!item.additionalPermission || permissions.includes(item.additionalPermission)),
    ),
  })).filter((group) => group.items.length > 0);
}

export function isNavItemActive(pathname: string, href: string) {
  return href === '/admin' ? pathname === href : pathname.startsWith(href);
}
