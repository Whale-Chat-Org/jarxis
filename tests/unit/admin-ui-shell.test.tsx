import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const nav = vi.hoisted(() => ({ pathname: '/admin', cookie: undefined as string | undefined }));
vi.mock('next/navigation', () => ({ usePathname: () => nav.pathname }));
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === 'sidebar_state' && nav.cookie !== undefined ? { value: nav.cookie } : undefined,
  }),
}));
vi.mock('@/components/theme-toggle', () => ({ ThemeToggle: () => <button>Theme</button> }));
vi.mock('@/components/auth/user/user-button', () => ({
  UserButton: ({ size, side }: { size: string; side: string }) => (
    <span data-testid="user-button" data-size={size} data-side={side} />
  ),
}));
vi.mock('@/components/auth/admin/admin-users', () => ({
  AdminUsers: () => <p>Accounts table</p>,
}));

import { AccessFiltersSkeleton, AccessListSkeleton } from '@/components/admin/access-skeleton';
import { AdminShell } from '@/components/admin/admin-shell';
import { AppSidebar } from '@/components/admin/app-sidebar';
import { SiteHeader } from '@/components/admin/site-header';
import { UsersWorkspace } from '@/components/admin/users-workspace';
import { SidebarProvider } from '@/components/ui/sidebar';
import { flattenStatements, roles } from '@/lib/permissions';

const ownerPermissions = flattenStatements(roles.owner);

beforeEach(() => {
  nav.pathname = '/admin';
  nav.cookie = undefined;
});

describe('SiteHeader', () => {
  it.each([
    ['/admin', 'General', 'Overview'],
    ['/admin/users', 'General', 'Users'],
    ['/admin/roles/extra', 'Access control', 'Roles'],
    ['/admin/ml-providers', 'Proxy', 'Providers'],
    ['/admin/unknown', 'General', 'Overview'],
    ['/elsewhere', 'Admin', 'Admin'],
  ])('labels %s as %s / %s', (pathname, group, title) => {
    nav.pathname = pathname;
    render(
      <SidebarProvider>
        <SiteHeader />
      </SidebarProvider>,
    );
    const crumbs = screen.getByRole('navigation', { name: 'breadcrumb' });
    const items = within(crumbs)
      .getAllByRole('listitem')
      .map((item) => item.textContent);
    expect(items.filter(Boolean)).toEqual([group, title]);
    expect(screen.getByRole('button', { name: 'Theme' })).toBeTruthy();
  });
});

describe('AppSidebar', () => {
  it('renders only permitted groups and marks the active item', () => {
    nav.pathname = '/admin/users/123';
    render(
      <SidebarProvider>
        <AppSidebar permissions={['dashboard:read', 'users:read']} />
      </SidebarProvider>,
    );
    expect(screen.getByRole('link', { name: 'Jarxis Admin' }).getAttribute('href')).toBe('/admin');
    expect(screen.getByText('General')).toBeTruthy();
    expect(screen.getByText('General')).toBeTruthy();
    expect(screen.queryByText('Security')).toBeNull();
    expect(screen.queryByText('Roles')).toBeNull();
    const users = screen.getByRole('link', { name: 'Users' });
    expect(users.getAttribute('data-active')).toBe('true');
    expect(screen.getByRole('link', { name: 'Overview' }).getAttribute('data-active')).toBe(
      'false',
    );
    expect(screen.getByTestId('user-button').getAttribute('data-size')).toBe('default');
  });

  it('switches the account button to its icon size when collapsed', () => {
    render(
      <SidebarProvider defaultOpen={false}>
        <AppSidebar permissions={ownerPermissions} />
      </SidebarProvider>,
    );
    expect(screen.getByTestId('user-button').getAttribute('data-size')).toBe('icon');
    expect(screen.getByRole('link', { name: 'Audit Log' })).toBeTruthy();
  });
});

describe('AdminShell', () => {
  it.each([
    [undefined, 'expanded'],
    ['true', 'expanded'],
    ['false', 'collapsed'],
  ])('reads the sidebar cookie %s', async (cookie, state) => {
    nav.cookie = cookie;
    const { container } = render(
      await AdminShell({ permissions: ownerPermissions, children: <p>Page body</p> }),
    );
    expect(screen.getByText('Page body')).toBeTruthy();
    expect(container.querySelector(`[data-state="${state}"]`)).toBeTruthy();
    expect(container.querySelector('[data-slot="admin-panel-dock"]')).toBeTruthy();
  });
});

describe('UsersWorkspace', () => {
  it('shows the accounts table as its only content', () => {
    render(<UsersWorkspace currentUserId="me" canManageAccess roles={[]} />);
    expect(screen.getByText('Accounts table')).toBeTruthy();
    expect(screen.queryByRole('tab')).toBeNull();
  });
});

describe('access skeletons', () => {
  it('renders the filter and list placeholders', () => {
    const { container } = render(
      <>
        <AccessFiltersSkeleton />
        <AccessListSkeleton />
      </>,
    );
    expect(screen.getByRole('status').textContent).toContain('Loading people…');
    expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(3);
  });
});
