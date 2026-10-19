import ApiKeysPage from '@/app/admin/api-keys/page';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement, ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import AuditLoading from '@/app/admin/audit/loading';
import AuditPage from '@/app/admin/audit/page';
import AdminError from '@/app/admin/error';
import AdminLayout from '@/app/admin/layout';
import AdminLoading from '@/app/admin/loading';
import AdminDashboardPage from '@/app/admin/page';
import ProvidersLoading from '@/app/admin/providers/loading';
import ProvidersPage from '@/app/admin/providers/page';
import RolesLoading from '@/app/admin/roles/loading';
import RolesPage from '@/app/admin/roles/page';
import UsersLoading from '@/app/admin/users/loading';
import UsersPage from '@/app/admin/users/page';
import { AdminPanelHost } from '@/components/ui/admin-panel';
import { HttpError } from '@/lib/errors';
import { flattenStatements, roles } from '@/lib/permissions';

const mocks = vi.hoisted(() => ({
  requirePage: vi.fn(),
  pageGrants: vi.fn(),
  userCount: vi.fn(),
  findSession: vi.fn(),
  findRoles: vi.fn(),
  findPermissions: vi.fn(),
  roleCounts: vi.fn(),
  findUsers: vi.fn(),
  listAudit: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
  usePathname: () => '/admin',
}));

vi.mock('@/lib/rbac', () => ({ requirePage: mocks.requirePage, pageGrants: mocks.pageGrants }));

vi.mock('@/db', () => ({
  db: {
    user: { count: mocks.userCount, findMany: mocks.findUsers },
    session: { findFirst: mocks.findSession },
    role: { findMany: mocks.findRoles },
    permission: { findMany: mocks.findPermissions },
    $queryRaw: mocks.roleCounts,
  },
}));

vi.mock('@/lib/audit-service', () => ({ listAudit: mocks.listAudit }));

vi.mock('@/components/admin/admin-shell', () => ({
  AdminShell: ({ permissions, children }: { permissions: string[]; children: ReactNode }) => (
    <div data-permissions={permissions.join(',')}>{children}</div>
  ),
}));

vi.mock('@/components/admin/users/users-panel', () => ({
  UsersPanel: ({
    currentUserId,
    canManageAccess,
  }: {
    currentUserId: string;
    canManageAccess: boolean;
  }) => (
    <p>
      Workspace {currentUserId} {String(canManageAccess)}
    </p>
  ),
}));

vi.mock('@/components/admin/provider/providers-panel', () => ({
  ProvidersPanel: ({ canManage }: { canManage: boolean }) => <p>Providers {String(canManage)}</p>,
}));

vi.mock('@/components/admin/api-keys/api-keys-panel', () => ({
  ApiKeysPanel: ({ canManage }: { canManage: boolean }) => <p>API Keys {String(canManage)}</p>,
}));

const ownerPermissions = new Set(flattenStatements(roles.owner));

function access(permissions: Iterable<string>, assigned: string[] = ['owner']) {
  return { userId: 'u1', sessionId: 's1', permissions: new Set(permissions), roles: assigned };
}

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.findRoles.mockResolvedValue([]);
  mocks.findPermissions.mockResolvedValue([]);
  mocks.roleCounts.mockResolvedValue([]);
  mocks.findUsers.mockResolvedValue([]);
});

type El = ReactElement<{ children?: ReactNode; fallback?: ReactNode }>;

describe('admin layout', () => {
  it('suspends behind the shell skeleton and renders the shell with grants', async () => {
    mocks.pageGrants.mockResolvedValue({ permissions: new Set(['dashboard:read', 'users:read']) });
    const layout = AdminLayout({ children: <p>content</p> }) as El;
    const { unmount } = render(<>{layout.props.fallback}</>);
    expect(screen.getByRole('status')).toBeTruthy();
    unmount();

    const frame = layout.props.children as ReactElement<{ children: ReactNode }>;
    const shell = await (frame.type as (props: unknown) => Promise<ReactElement>)(frame.props);
    const { container } = render(shell);
    expect(screen.getByText('content')).toBeTruthy();
    expect(container.querySelector('[data-permissions]')?.getAttribute('data-permissions')).toBe(
      'dashboard:read,users:read',
    );
  });

  it('redirects signed-out visitors and rethrows other errors', async () => {
    const layout = AdminLayout({ children: null }) as El;
    const frame = layout.props.children as ReactElement<{ children: ReactNode }>;
    const run = () => (frame.type as (props: unknown) => Promise<ReactElement>)(frame.props);
    mocks.pageGrants.mockRejectedValue(new HttpError(401, 'X', 'no'));
    await expect(run()).rejects.toThrow('REDIRECT:/auth/sign-in');
    mocks.pageGrants.mockRejectedValue(new HttpError(403, 'X', 'forbidden'));
    await expect(run()).rejects.toThrow('forbidden');
  });
});

describe('admin error boundary', () => {
  it('retries on demand', async () => {
    const retry = vi.fn();
    render(<AdminError retry={retry} />);
    expect(screen.getByRole('alert').textContent).toContain('This page couldn’t be loaded');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalled();
  });
});

describe('admin loading skeletons', () => {
  it.each([
    [AdminLoading, 'Loading overview…'],
    [AuditLoading, 'Loading audit log…'],
    [ProvidersLoading, 'Loading providers…'],
    [RolesLoading, 'Loading roles…'],
    [UsersLoading, 'Loading users and access…'],
  ])('renders %#', (Loading, label) => {
    render(<Loading />);
    expect(screen.getAllByRole('status')[0].textContent).toContain(label);
  });
});

describe('admin overview', () => {
  it('shows every card and recent activity for an owner', async () => {
    mocks.requirePage.mockResolvedValue(access(ownerPermissions));
    mocks.userCount.mockImplementation(async (args?: unknown) => (args ? 2 : 10));
    mocks.listAudit.mockResolvedValue({
      total: 7,
      data: [{ id: 'a1', action: 'user.set-role', createdAt: new Date() }],
    });
    render(await AdminDashboardPage());
    expect(mocks.requirePage).toHaveBeenCalledWith('dashboard:read');
    expect(mocks.userCount).toHaveBeenCalledWith({ where: { banned: true } });
    expect(mocks.listAudit).toHaveBeenCalledWith(1, 5);
    expect(screen.getByText('8 active, 2 banned')).toBeTruthy();
    expect(screen.getByText('4')).toBeTruthy();
    expect(screen.getByText('7')).toBeTruthy();
    expect(screen.getAllByRole('link').map((link) => link.getAttribute('href'))).toEqual([
      '/admin/users',
      '/admin/roles',
      '/admin/audit',
    ]);
    expect(screen.getByText('Recent activity')).toBeTruthy();
    expect(screen.getByText('user.set-role')).toBeTruthy();
    expect(screen.getByText(/ago$/)).toBeTruthy();
  });

  it('shows an empty state when no metric is granted', async () => {
    mocks.requirePage.mockResolvedValue(access(['dashboard:read']));
    render(await AdminDashboardPage());
    expect(screen.getByText('No data available')).toBeTruthy();
    expect(mocks.userCount).not.toHaveBeenCalled();
    expect(mocks.listAudit).not.toHaveBeenCalled();
  });

  it('omits recent activity when the log is empty', async () => {
    mocks.requirePage.mockResolvedValue(access(['dashboard:read', 'audit:read']));
    mocks.listAudit.mockResolvedValue({ total: 0, data: [] });
    render(await AdminDashboardPage());
    expect(screen.getByText('Audit events')).toBeTruthy();
    expect(screen.queryByText('Recent activity')).toBeNull();
  });
});

describe('roles page', () => {
  it('shows locked system roles and an owner create action', async () => {
    mocks.requirePage.mockResolvedValue(access(ownerPermissions));
    render(<AdminPanelHost>{await RolesPage()}</AdminPanelHost>);
    expect(mocks.requirePage).toHaveBeenCalledWith('roles:read');
    expect(screen.getAllByText('Locked')).toHaveLength(2);
    expect(screen.getAllByText('System')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Create role' })).toBeTruthy();
  });

  it('shows roles read only to non-owners', async () => {
    mocks.requirePage.mockResolvedValue(access(['roles:read'], ['viewer']));
    render(<AdminPanelHost>{await RolesPage()}</AdminPanelHost>);
    expect(screen.queryByRole('button', { name: 'Create role' })).toBeNull();
  });
});

describe('audit page', () => {
  async function auditTable(page: string | string[] | undefined) {
    mocks.requirePage.mockResolvedValue(access(['audit:read']));
    const element = (await AuditPage({ searchParams: Promise.resolve({ page }) })) as El;
    const suspense = element.props.children as El & { key: string | null };
    const table = suspense.props.children as ReactElement<{ page: number }>;
    return { suspense, table };
  }

  it.each([
    [undefined, 1],
    ['abc', 1],
    ['-4', 1],
    ['3', 3],
    [['2', '9'], 2],
  ])('reads page %j as %i', async (raw, page) => {
    const { suspense, table } = await auditTable(raw);
    expect(table.props.page).toBe(page);
    expect(suspense.key).toBe(String(page));
  });

  it('shows the loading fallback', async () => {
    const { suspense } = await auditTable(undefined);
    render(<>{suspense.props.fallback}</>);
    expect(screen.getByText('Loading audit events…')).toBeTruthy();
  });

  async function renderTable(raw: string, result: { total: number; data: unknown[] }) {
    mocks.listAudit.mockResolvedValue(result);
    const { table } = await auditTable(raw);
    render(await (table.type as (props: unknown) => Promise<ReactElement>)(table.props));
  }

  it('renders an empty log on a single page', async () => {
    await renderTable('1', { total: 0, data: [] });
    expect(mocks.listAudit).toHaveBeenCalledWith(1, 20);
    expect(screen.getByText('No audit events recorded yet.')).toBeTruthy();
    expect(screen.getByText('0 recorded administrative actions.')).toBeTruthy();
    expect(screen.getByText('Page 1 of 1')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Previous' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: 'Next' }).hasAttribute('disabled')).toBe(true);
  });

  it('renders entries with details and pagination links', async () => {
    const user = userEvent.setup();
    await renderTable('2', {
      total: 45,
      data: [
        {
          id: 'e1',
          action: 'user.ban',
          actorId: 'actor-1',
          targetId: 'target-1',
          changes: { banned: true },
          createdAt: '2026-01-01T10:00:00Z',
        },
      ],
    });
    expect(screen.getByText('45 recorded administrative actions.')).toBeTruthy();
    expect(screen.getByText('user.ban')).toBeTruthy();
    expect(screen.getByText('actor-1')).toBeTruthy();
    expect(screen.getByText('Page 2 of 3')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Previous' }).getAttribute('href')).toBe('?page=1');
    expect(screen.getByRole('link', { name: 'Next' }).getAttribute('href')).toBe('?page=3');
    await user.click(screen.getByRole('button', { name: 'View' }));
    expect(screen.getByText(/"banned": true/)).toBeTruthy();
  });

  it('uses the singular for one event on the last page', async () => {
    await renderTable('1', {
      total: 1,
      data: [
        { id: 'e', action: 'a', actorId: 'b', targetId: 'c', changes: null, createdAt: new Date() },
      ],
    });
    expect(screen.getByText('1 recorded administrative action.')).toBeTruthy();
  });
});

describe('users page', () => {
  it('passes the operator and owner role rule to the workspace', async () => {
    mocks.requirePage.mockResolvedValue(access(ownerPermissions));
    render(await UsersPage());
    expect(mocks.requirePage).toHaveBeenCalledWith('users:read');
    expect(screen.getByText('Workspace u1 true')).toBeTruthy();
  });

  it.each([
    [[], false],
    [['users:read'], false],
    [['user:list'], false],
    [['users:read', 'user:list'], true],
  ] as const)('requires both Users permissions: %j', async (permissions, allowed) => {
    mocks.requirePage.mockImplementation(async (permission: string) => {
      if (!(permissions as readonly string[]).includes(permission))
        throw new Error('REDIRECT:/access-denied');
      return access([...permissions]);
    });
    if (allowed) await expect(UsersPage()).resolves.toBeTruthy();
    else await expect(UsersPage()).rejects.toThrow('REDIRECT:/access-denied');
  });

  it('denies role management to non-owners', async () => {
    mocks.requirePage.mockResolvedValue(access(ownerPermissions, ['administrator']));
    render(await UsersPage());
    expect(screen.getByText('Workspace u1 false')).toBeTruthy();
  });
});

describe('Providers page', () => {
  it('rejects non-owners', async () => {
    mocks.requirePage.mockResolvedValue(access(ownerPermissions, ['administrator']));
    await expect(ProvidersPage()).rejects.toThrow('REDIRECT:/access-denied');
    expect(mocks.findSession).not.toHaveBeenCalled();
  });

  it('rejects impersonated or missing sessions', async () => {
    mocks.requirePage.mockResolvedValue(access(ownerPermissions));
    mocks.findSession.mockResolvedValue(null);
    await expect(ProvidersPage()).rejects.toThrow('REDIRECT:/access-denied');
    expect(mocks.findSession).toHaveBeenCalledWith({
      where: { id: 's1', userId: 'u1', impersonatedBy: null },
      select: { id: true },
    });
  });

  it('renders the panel for a direct owner session', async () => {
    mocks.requirePage.mockResolvedValue(access(ownerPermissions));
    mocks.findSession.mockResolvedValue({ id: 's1' });
    render(await ProvidersPage());
    expect(mocks.requirePage).toHaveBeenCalledWith('providers:read');
    expect(screen.getByText('Providers true')).toBeTruthy();
  });

  it('renders read-only without the manage grant', async () => {
    mocks.requirePage.mockResolvedValue(access(['providers:read']));
    mocks.findSession.mockResolvedValue({ id: 's1' });
    render(await ProvidersPage());
    expect(screen.getByText('Providers false')).toBeTruthy();
  });
});
describe('API Keys page', () => {
  it('rejects non-owners', async () => {
    mocks.requirePage.mockResolvedValue(access(ownerPermissions, ['administrator']));
    await expect(ApiKeysPage()).rejects.toThrow('REDIRECT:/access-denied');
    expect(mocks.findSession).not.toHaveBeenCalled();
  });

  it('rejects impersonated or missing sessions', async () => {
    mocks.requirePage.mockResolvedValue(access(ownerPermissions));
    mocks.findSession.mockResolvedValue(null);
    await expect(ApiKeysPage()).rejects.toThrow('REDIRECT:/access-denied');
    expect(mocks.findSession).toHaveBeenCalledWith({
      where: { id: 's1', userId: 'u1', impersonatedBy: null },
      select: { id: true },
    });
  });

  it('renders the panel for a direct owner session', async () => {
    mocks.requirePage.mockResolvedValue(access(ownerPermissions));
    mocks.findSession.mockResolvedValue({ id: 's1' });
    render(await ApiKeysPage());
    expect(mocks.requirePage).toHaveBeenCalledWith('providers:read');
    expect(screen.getByText('API Keys true')).toBeTruthy();
  });

  it('renders read-only without the manage grant', async () => {
    mocks.requirePage.mockResolvedValue(access(['providers:read']));
    mocks.findSession.mockResolvedValue({ id: 's1' });
    render(await ApiKeysPage());
    expect(screen.getByText('API Keys false')).toBeTruthy();
  });
});
