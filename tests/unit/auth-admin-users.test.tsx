import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Unit coverage for the admin users directory and inspector. The Better Auth UI hooks are replaced
 * with an in-memory fake and the auth client's admin methods are `vi.fn()` stubs, so no database,
 * session or network request is involved.
 */

type Perm = boolean | 'pending';
type QueryState = {
  data?: unknown;
  isError?: boolean;
  isFetching?: boolean;
  isPending?: boolean;
  isSuccess?: boolean;
  refetch?: () => void;
};

const h = vi.hoisted(() => {
  const admin = {
    banUser: vi.fn(),
    createUser: vi.fn(),
    impersonateUser: vi.fn(),
    removeUser: vi.fn(),
    revokeUserSession: vi.fn(),
    revokeUserSessions: vi.fn(),
    setRole: vi.fn(),
    setUserPassword: vi.fn(),
    unbanUser: vi.fn(),
    updateUser: vi.fn(),
  };
  return {
    admin,
    authClient: { admin },
    additionalFields: [] as unknown[],
    config: {} as Record<string, unknown>,
    copy: { copied: false, copy: vi.fn(), reset: vi.fn() },
    copyOptions: undefined as undefined | { onError: () => void },
    detail: undefined as undefined | QueryState,
    listParams: [] as unknown[],
    navigate: vi.fn(),
    permissions: {} as Record<string, Perm>,
    plugins: [] as unknown[],
    session: { user: { id: 'actor' }, session: {} } as unknown,
    sessions: {} as QueryState,
    toastError: vi.fn(),
    users: {} as QueryState,
  };
});

vi.mock('next/navigation', () => ({
  usePathname: () => '/admin/users',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

vi.mock('sonner', () => ({ toast: { error: h.toastError, success: vi.fn() } }));

vi.mock('@tanstack/react-pacer', () => ({
  useDebouncedValue: (value: unknown) => [value],
}));

vi.mock('@better-auth-ui/react', () => ({
  useAuth: () => ({
    additionalFields: h.additionalFields,
    authClient: h.authClient,
    localization: {
      auth: { fieldRequired: 'Required' },
      errors: { copyFailed: 'Copy failed' },
      settings: { copiedToClipboard: 'Copied', copyToClipboard: 'Copy' },
    },
    navigate: h.navigate,
    plugins: h.plugins,
  }),
  useAuthPlugin: () => h.config,
  useCopyToClipboard: (options: { onError: () => void }) => {
    h.copyOptions = options;
    return h.copy;
  },
  useSession: () => ({ data: h.session, isPending: false }),
}));

const permissionKey = (permissions: Record<string, string[]>) =>
  Object.entries(permissions)
    .map(([resource, actions]) => `${resource}:${actions.join(',')}`)
    .join('|');

const disabledQuery = { data: undefined, isPending: true, isSuccess: false, isError: false };

vi.mock('@better-auth-ui/react/plugins/admin', () => ({
  useAdminPermission: (
    _client: unknown,
    permissions: Record<string, string[]>,
    options?: { enabled?: boolean },
  ) => {
    if (options?.enabled === false) return disabledQuery;
    const value = h.permissions[permissionKey(permissions)] ?? true;
    if (value === 'pending') return disabledQuery;
    return { data: { success: value, error: null }, isPending: false, isSuccess: true };
  },
  useAdminUsers: (_client: unknown, options: { enabled: boolean; params: unknown }) => {
    if (!options.enabled) return { ...disabledQuery, isFetching: false, refetch: vi.fn() };
    h.listParams.push(options.params);
    return h.users;
  },
  useAdminUser: (_client: unknown, userId: string | undefined, options: { enabled: boolean }) => {
    if (!options.enabled || !userId) return disabledQuery;
    if (h.detail) return h.detail;
    const list = (h.users.data as { users: { id: string }[] } | undefined)?.users ?? [];
    return { data: list.find((user) => user.id === userId), isPending: false };
  },
  useAdminUserSessions: (_client: unknown, _userId: string, options: { enabled: boolean }) =>
    options.enabled ? h.sessions : disabledQuery,
  useStopImpersonating: () => ({ isPending: false, mutate: vi.fn() }),
}));

import { adminPlugin as coreAdminPlugin } from '@better-auth-ui/core/plugins/admin';
import { AdminUsers, type AdminUsersProps } from '@/components/auth/admin/admin-users';
import { AdminPanelHost } from '@/components/ui/admin-panel';

const ada = {
  id: 'u-ada',
  name: 'Ada Lovelace',
  email: 'ada@jarxis.test',
  emailVerified: true,
  role: 'user',
  banned: false,
  banReason: null,
  banExpires: null,
  image: null,
  createdAt: new Date('2026-01-02T00:00:00Z'),
  updatedAt: new Date('2026-01-02T00:00:00Z'),
};
const bob = {
  ...ada,
  id: 'u-bob',
  name: 'Bob Banned',
  email: 'banned@jarxis.test',
  role: null,
  banned: true,
  banReason: 'Spam',
  banExpires: new Date('2027-01-01T00:00:00Z'),
};
const root = {
  ...ada,
  id: 'u-root',
  name: 'Root Admin',
  email: 'admin@jarxis.test',
  role: 'admin',
};

function listResult(users: unknown[], total = users.length): QueryState {
  return {
    data: { users, total, limit: 20, offset: 0 },
    isError: false,
    isFetching: false,
    isPending: false,
    isSuccess: true,
    refetch: vi.fn(),
  };
}

function lastParams() {
  return h.listParams.at(-1) as Record<string, unknown>;
}

function setConfig(options: Parameters<typeof coreAdminPlugin>[0] = {}) {
  h.config = coreAdminPlugin(options) as unknown as Record<string, unknown>;
}

const defaultProps: AdminUsersProps = {
  currentUserId: 'actor',
  canManageAccess: true,
  roles: [
    {
      key: 'user',
      name: 'user',
      description: '',
      permissions: [],
      system: true,
      editable: true,
      userCount: 0,
    },
    {
      key: 'viewer',
      name: 'viewer',
      description: '',
      permissions: [],
      system: true,
      editable: true,
      userCount: 0,
    },
    {
      key: 'administrator',
      name: 'administrator',
      description: '',
      permissions: [],
      system: true,
      editable: true,
      userCount: 0,
    },
    {
      key: 'owner',
      name: 'owner',
      description: '',
      permissions: [],
      system: true,
      editable: true,
      userCount: 0,
    },
    {
      key: 'admin',
      name: 'admin',
      description: '',
      permissions: [],
      system: true,
      editable: true,
      userCount: 0,
    },
  ],
};
function renderUsers(props: Partial<AdminUsersProps> = {}) {
  const merged = { ...defaultProps, ...props };
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });
  const wrap = (node: ReactNode) => (
    <QueryClientProvider client={queryClient}>
      <AdminPanelHost>{node}</AdminPanelHost>
    </QueryClientProvider>
  );
  const view = render(wrap(<AdminUsers {...merged} />));
  return {
    ...view,
    rerenderUsers: (next: Partial<AdminUsersProps> = props) =>
      view.rerender(wrap(<AdminUsers {...defaultProps} {...next} />)),
    user: userEvent.setup(),
  };
}

const forbidden = () => Object.assign(new Error('raw <script>'), { code: 'FORBIDDEN' });

async function openInspector(user: ReturnType<typeof userEvent.setup>, name = 'Ada Lovelace') {
  await user.click(screen.getByRole('button', { name }));
  return screen.findByRole('dialog', { name });
}

async function chooseOption(
  user: ReturnType<typeof userEvent.setup>,
  trigger: string,
  option: string,
) {
  await user.click(screen.getByRole('combobox', { name: trigger }));
  await user.click(await screen.findByRole('option', { name: option }));
}

beforeEach(() => {
  for (const fn of Object.values(h.admin)) fn.mockReset().mockResolvedValue({ data: {} });
  h.additionalFields = [];
  h.copy = { copied: false, copy: vi.fn(), reset: vi.fn() };
  h.detail = undefined;
  h.listParams = [];
  h.navigate.mockReset();
  h.permissions = {};
  h.plugins = [];
  h.session = { user: { id: 'actor' }, session: {} };
  h.sessions = { data: { sessions: [] }, isPending: false };
  h.toastError.mockReset();
  h.users = listResult([ada, bob]);
  setConfig();
});

describe('AdminUsers directory', () => {
  it('lists users with role, status and the pagination range', () => {
    renderUsers();
    expect(screen.queryByRole('heading', { level: 1, name: 'Users' })).toBeNull();
    const rows = screen.getAllByRole('row');
    expect(rows).toHaveLength(3);
    const adaRow = within(rows[1]);
    expect(adaRow.getByText('ada@jarxis.test')).toBeTruthy();
    expect(adaRow.getByText('user')).toBeTruthy();
    expect(adaRow.getByText('Active')).toBeTruthy();
    // A user without a role falls back to the configured default role.
    expect(within(rows[2]).getByText('user')).toBeTruthy();
    expect(within(rows[2]).getByText('Banned')).toBeTruthy();
    expect(screen.getByText('1-2 of 2')).toBeTruthy();
    expect(lastParams()).toEqual({
      limit: 20,
      offset: 0,
      searchField: 'email',
      searchOperator: 'contains',
      searchValue: undefined,
      sortBy: 'createdAt',
      sortDirection: 'desc',
    });
  });

  it('shows a skeleton while the list permission is pending', () => {
    h.permissions['user:list'] = 'pending';
    h.permissions['user:create'] = 'pending';
    const { container } = renderUsers();
    expect(screen.queryByRole('columnheader')).toBeNull();
    expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(5);
    expect(screen.queryByRole('button', { name: 'Create user' })).toBeNull();
  });

  it('denies access without the list permission', () => {
    h.permissions['user:list'] = false;
    h.permissions['user:create'] = false;
    renderUsers();
    expect(screen.getByRole('heading', { name: 'Access denied' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Create user' })).toBeNull();
    expect(h.listParams).toHaveLength(0);
    expect(screen.getByText('0-0 of 0')).toBeTruthy();
  });

  it('offers a retry when the list fails to load', async () => {
    const refetch = vi.fn();
    h.users = { isError: true, isPending: false, isSuccess: false, refetch };
    const { user } = renderUsers();
    expect(screen.getByRole('heading', { name: 'Could not load users' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalledOnce();
  });

  it('renders loading rows while users are pending', () => {
    h.users = { isPending: true, isSuccess: false, isFetching: true };
    renderUsers();
    expect(screen.getAllByRole('row')).toHaveLength(6);
    expect((screen.getByRole('button', { name: 'Next page' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('shows the empty state', () => {
    h.users = listResult([]);
    renderUsers();
    expect(screen.getByText('No users found')).toBeTruthy();
    expect(screen.getByText('Change the search or create a user.')).toBeTruthy();
  });

  it('renders names as plain text without the get permission', async () => {
    h.permissions['user:get'] = false;
    const { user } = renderUsers();
    expect(screen.queryByRole('button', { name: 'Ada Lovelace' })).toBeNull();
    await user.click(screen.getByText('Ada Lovelace'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('toggles sorting through the column headers', async () => {
    const { user } = renderUsers();
    expect(screen.getByRole('button', { name: 'Created↓' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Name' }));
    expect(lastParams()).toMatchObject({ sortBy: 'name', sortDirection: 'asc' });
    expect(screen.getByRole('button', { name: 'Name↑' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Name↑' }));
    expect(lastParams()).toMatchObject({ sortBy: 'name', sortDirection: 'desc' });
  });

  it('pages through results and returns to the first page on a new search', async () => {
    setConfig({ pageSize: 2 });
    h.users = listResult([ada, bob], 5);
    const { user } = renderUsers();
    const previous = screen.getByRole('button', { name: 'Previous page' }) as HTMLButtonElement;
    expect(previous.disabled).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Next page' }));
    expect(lastParams()).toMatchObject({ limit: 2, offset: 2 });
    expect(screen.getByText('3-4 of 5')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Next page' }));
    expect(screen.getByText('5-5 of 5')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Next page' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    await user.click(previous);
    expect(lastParams()).toMatchObject({ offset: 2 });

    await user.type(screen.getByRole('textbox', { name: 'Search by email' }), ' ada ');
    expect(lastParams()).toMatchObject({ offset: 0, searchValue: 'ada' });
  });

  it('clamps the page when the total shrinks', async () => {
    setConfig({ pageSize: 2 });
    h.users = listResult([ada, bob], 6);
    const { user, rerenderUsers } = renderUsers();
    await user.click(screen.getByRole('button', { name: 'Next page' }));
    await user.click(screen.getByRole('button', { name: 'Next page' }));
    expect(lastParams()).toMatchObject({ offset: 4 });
    h.users = listResult([ada], 1);
    rerenderUsers();
    await waitFor(() => expect(lastParams()).toMatchObject({ offset: 0 }));
  });

  it('changes the search field, operator and status filter', async () => {
    const { user } = renderUsers();
    await chooseOption(user, 'Search', 'Name');
    expect(screen.getByRole('textbox', { name: 'Search by name' })).toBeTruthy();
    expect(lastParams()).toMatchObject({ searchField: 'name' });

    await chooseOption(user, 'Search operator', 'Starts with');
    expect(lastParams()).toMatchObject({ searchOperator: 'starts_with' });

    await chooseOption(user, 'Status', 'Banned');
    expect(lastParams()).toMatchObject({
      filterField: 'banned',
      filterOperator: 'eq',
      filterValue: true,
    });
    await chooseOption(user, 'Status', 'Active');
    expect(lastParams()).toMatchObject({ filterValue: false });
    await chooseOption(user, 'Status', 'All statuses');
    expect(lastParams().filterField).toBeUndefined();
  });

  it('selects a row by clicking it and supports controlled selection', async () => {
    const onSelectedUserIdChange = vi.fn();
    const { user, rerenderUsers } = renderUsers({ onSelectedUserIdChange });
    await user.click(screen.getByText('banned@jarxis.test'));
    expect(onSelectedUserIdChange).toHaveBeenCalledWith('u-bob');
    // Controlled: nothing opens until the parent passes the id back.
    expect(screen.queryByRole('dialog')).toBeNull();

    rerenderUsers({ onSelectedUserIdChange, selectedUserId: 'u-bob' });
    const dialog = await screen.findByRole('dialog', { name: 'Bob Banned' });
    expect(within(dialog).getByText('Spam')).toBeTruthy();
    expect(within(dialog).getByText('Ban expires')).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: 'Close panel' }));
    expect(onSelectedUserIdChange).toHaveBeenLastCalledWith(undefined);
  });
});

describe('AdminUsers create user', () => {
  async function openCreate(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole('button', { name: 'Create user' }));
    return screen.findByRole('dialog', { name: 'Create user' });
  }

  async function fill(user: ReturnType<typeof userEvent.setup>, dialog: HTMLElement) {
    await user.type(within(dialog).getByLabelText('Name'), 'New Person');
    await user.type(within(dialog).getByLabelText('Email'), 'member@jarxis.test');
    await user.type(within(dialog).getByLabelText('Password'), 'fixture-password');
  }

  it('creates a user with roles and verification and closes', async () => {
    const { user } = renderUsers();
    const dialog = await openCreate(user);
    await fill(user, dialog);
    await user.click(within(dialog).getByRole('checkbox', { name: 'admin' }));
    // The last remaining role cannot be unchecked.
    await user.click(within(dialog).getByRole('checkbox', { name: 'user' }));
    await user.click(within(dialog).getByRole('checkbox', { name: 'admin' }));
    await user.click(within(dialog).getByRole('checkbox', { name: 'admin' }));
    await user.click(within(dialog).getByRole('switch', { name: 'Email verified' }));
    await user.click(within(dialog).getByRole('button', { name: 'Create user' }));

    await waitFor(() => expect(h.admin.createUser).toHaveBeenCalledOnce());
    expect(h.admin.createUser.mock.calls[0][0]).toMatchObject({
      data: { emailVerified: true },
      email: 'member@jarxis.test',
      name: 'New Person',
      password: 'fixture-password',
      role: ['admin'],
      fetchOptions: { throw: true },
    });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Create user' })).toBeNull());
  });

  it('uses a single-role radio group and omits the role without set-role', async () => {
    setConfig({ allowMultipleRoles: false });
    const { user } = renderUsers();
    let dialog = await openCreate(user);
    await user.click(within(dialog).getByRole('radio', { name: 'admin' }));
    expect(within(dialog).getByRole('radio', { name: 'admin' }).getAttribute('aria-checked')).toBe(
      'true',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Create user' })).toBeNull());

    h.permissions['user:set-role'] = false;
    dialog = await openCreate(user);
    expect(within(dialog).queryByRole('radiogroup')).toBeNull();
    await fill(user, dialog);
    await user.click(within(dialog).getByRole('button', { name: 'Create user' }));
    await waitFor(() => expect(h.admin.createUser).toHaveBeenCalledOnce());
    expect(h.admin.createUser.mock.calls[0][0]).not.toHaveProperty('role');
  });

  it('shows a skeleton while set-role is pending and renders additional fields', async () => {
    h.permissions['user:set-role'] = 'pending';
    h.additionalFields = [{ name: 'title', type: 'string', label: 'Job title' }];
    const { user } = renderUsers();
    const dialog = await openCreate(user);
    expect(within(dialog).queryByRole('checkbox')).toBeNull();
    await fill(user, dialog);
    await user.type(within(dialog).getByLabelText(/Job title/), 'Engineer');
    await user.click(within(dialog).getByRole('button', { name: 'Create user' }));
    await waitFor(() => expect(h.admin.createUser).toHaveBeenCalledOnce());
    expect(h.admin.createUser.mock.calls[0][0].data).toMatchObject({ title: 'Engineer' });
  });

  it('renders only safe copy for a failed create and keeps the dialog open', async () => {
    h.admin.createUser.mockRejectedValue(forbidden());
    const { user } = renderUsers();
    const dialog = await openCreate(user);
    await fill(user, dialog);
    await user.click(within(dialog).getByRole('button', { name: 'Create user' }));
    expect(await within(dialog).findByText("You don't have permission to do this.")).toBeTruthy();
    expect(screen.queryByText('raw <script>')).toBeNull();
    // Dismissing resets the failed mutation.
    await user.click(within(dialog).getByRole('button', { name: 'Close panel' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Create user' })).toBeNull());
  });

  it('cannot be dismissed while the create is in flight', async () => {
    let resolve: (value: unknown) => void = () => {};
    h.admin.createUser.mockReturnValue(new Promise((r) => (resolve = r)));
    const { user } = renderUsers();
    const dialog = await openCreate(user);
    await fill(user, dialog);
    await user.click(within(dialog).getByRole('button', { name: 'Create user' }));
    await waitFor(() =>
      expect(
        (within(dialog).getByRole('button', { name: 'Cancel' }) as HTMLButtonElement).disabled,
      ).toBe(true),
    );
    await user.keyboard('{Escape}');
    await user.click(within(dialog).getByRole('button', { name: 'Close panel' }));
    expect(screen.getByRole('dialog', { name: 'Create user' })).toBeTruthy();
    await act(async () => resolve({ data: {} }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Create user' })).toBeNull());
  });
});

describe('AdminUsers inspector profile', () => {
  it('saves profile, email and role changes', async () => {
    const { user } = renderUsers();
    const dialog = await openInspector(user);
    const name = within(dialog).getByLabelText('Name');
    await user.clear(name);
    await user.type(name, '  Ada King  ');
    await user.clear(within(dialog).getByLabelText('Email'));
    await user.type(within(dialog).getByLabelText('Email'), 'ada.king@jarxis.test');
    await user.click(within(dialog).getByRole('switch', { name: 'Email verified' }));
    await user.click(within(dialog).getByRole('checkbox', { name: 'admin' }));
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(h.admin.updateUser).toHaveBeenCalledOnce());
    expect(h.admin.updateUser.mock.calls[0][0]).toMatchObject({
      userId: 'u-ada',
      data: { name: 'Ada King', email: 'ada.king@jarxis.test', emailVerified: false },
    });
    expect(h.admin.setRole.mock.calls[0][0]).toMatchObject({
      userId: 'u-ada',
      role: ['user', 'admin'],
    });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Ada Lovelace' })).toBeNull());
  });

  it('omits email changes without set-email and role changes without set-role', async () => {
    h.permissions['user:set-email'] = false;
    h.permissions['user:set-role'] = false;
    setConfig({ allowMultipleRoles: false });
    const { user } = renderUsers();
    const dialog = await openInspector(user);
    expect((within(dialog).getByLabelText('Email') as HTMLInputElement).disabled).toBe(true);
    expect(
      (within(dialog).getByRole('combobox', { name: 'Role' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    await user.type(within(dialog).getByLabelText('Name'), '!');
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(h.admin.updateUser).toHaveBeenCalledOnce());
    expect(h.admin.updateUser.mock.calls[0][0].data).toEqual({ name: 'Ada Lovelace!' });
    expect(h.admin.setRole).not.toHaveBeenCalled();
  });

  it('lets a role-only admin change a role via the role dropdown', async () => {
    h.permissions['user:update'] = false;
    setConfig({ allowMultipleRoles: false });
    const { user } = renderUsers();
    const dialog = await openInspector(user);
    expect((within(dialog).getByLabelText('Name') as HTMLInputElement).disabled).toBe(true);
    await user.click(within(dialog).getByRole('combobox', { name: 'Role' }));
    await user.click(await screen.findByRole('option', { name: 'admin' }));
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(h.admin.setRole).toHaveBeenCalledOnce());
    expect(h.admin.setRole.mock.calls[0][0]).toMatchObject({ role: ['admin'] });
    expect(h.admin.updateUser).not.toHaveBeenCalled();
  });

  it('disables saving when there is nothing the actor may change', async () => {
    h.permissions['user:update'] = false;
    h.permissions['user:set-role'] = false;
    const { user } = renderUsers();
    const dialog = await openInspector(user);
    expect(
      (within(dialog).getByRole('button', { name: 'Save changes' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('protects the actor from changing their own role or banning themselves', async () => {
    h.session = { user: { id: 'u-ada' }, session: {} };
    const { user } = renderUsers();
    const dialog = await openInspector(user);
    const checkbox = within(dialog).getByRole('checkbox', { name: 'admin' }) as HTMLButtonElement;
    expect(checkbox.disabled).toBe(true);
    for (const label of ['Ban user', 'Delete user']) {
      expect(
        (within(dialog).getByRole('button', { name: label }) as HTMLButtonElement).disabled,
      ).toBe(true);
    }
    await user.type(within(dialog).getByLabelText('Name'), 'x');
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(h.admin.updateUser).toHaveBeenCalledOnce());
    expect(h.admin.setRole).not.toHaveBeenCalled();
  });

  it('disables saving when name or email is blank', async () => {
    const { user } = renderUsers();
    const dialog = await openInspector(user);
    await user.clear(within(dialog).getByLabelText('Name'));
    expect(
      (within(dialog).getByRole('button', { name: 'Save changes' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('shows safe copy when the profile save fails and stays open', async () => {
    h.admin.updateUser.mockRejectedValue(forbidden());
    h.admin.setRole.mockRejectedValue(Object.assign(new Error('x'), { code: 'LAST_OWNER' }));
    const { user } = renderUsers();
    const dialog = await openInspector(user);
    await user.type(within(dialog).getByLabelText('Name'), '!');
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    expect(await within(dialog).findByText("You don't have permission to do this.")).toBeTruthy();
    expect(screen.getByRole('dialog', { name: 'Ada Lovelace' })).toBeTruthy();
  });

  it('shows the role error when only the role change fails', async () => {
    h.admin.setRole.mockRejectedValue(Object.assign(new Error('x'), { code: 'LAST_OWNER' }));
    const { user } = renderUsers();
    const dialog = await openInspector(user);
    await user.click(within(dialog).getByRole('checkbox', { name: 'admin' }));
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    expect(
      await within(dialog).findByText(
        'Keep at least one active, verified owner before making this change.',
      ),
    ).toBeTruthy();
  });

  it('cannot be dismissed while a profile save is in flight', async () => {
    let resolve: (value: unknown) => void = () => {};
    h.admin.updateUser.mockReturnValue(new Promise((r) => (resolve = r)));
    const { user } = renderUsers();
    const dialog = await openInspector(user);
    await user.type(within(dialog).getByLabelText('Name'), '!');
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    await waitFor(() =>
      expect(
        (within(dialog).getByRole('button', { name: 'Cancel' }) as HTMLButtonElement).disabled,
      ).toBe(true),
    );
    await user.keyboard('{Escape}');
    await user.click(within(dialog).getByRole('button', { name: 'Close panel' }));
    expect(screen.getByRole('dialog', { name: 'Ada Lovelace' })).toBeTruthy();
    await act(async () => resolve({ data: {} }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Ada Lovelace' })).toBeNull());
  });

  it('closes from the footer cancel button', async () => {
    const { user } = renderUsers();
    const dialog = await openInspector(user);
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Ada Lovelace' })).toBeNull());
  });

  it('renders configured additional fields', async () => {
    h.additionalFields = [{ name: 'title', type: 'string', label: 'Job title' }];
    h.users = listResult([{ ...ada, title: 'Analyst' }]);
    const { user } = renderUsers();
    const dialog = await openInspector(user);
    const field = within(dialog).getByLabelText(/Job title/) as HTMLInputElement;
    expect(field.value).toBe('Analyst');
    await user.clear(field);
    await user.type(field, 'Engineer');
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(h.admin.updateUser).toHaveBeenCalledOnce());
    expect(h.admin.updateUser.mock.calls[0][0].data).toMatchObject({ title: 'Engineer' });
  });

  it('copies the user id', async () => {
    const { user } = renderUsers();
    const dialog = await openInspector(user);
    await user.click(within(dialog).getByRole('button', { name: 'Copy user ID' }));
    expect(h.copy.copy).toHaveBeenCalledWith('u-ada');
    expect(h.copy.reset).toHaveBeenCalled();
    h.copyOptions?.onError();
    expect(h.toastError).toHaveBeenCalledWith('Copy failed');
  });

  it('shows the copied state', async () => {
    h.copy = { copied: true, copy: vi.fn(), reset: vi.fn() };
    const { user } = renderUsers();
    const dialog = await openInspector(user);
    expect(within(dialog).getByRole('button', { name: 'Copied' })).toBeTruthy();
  });

  it('shows loading and missing-user states', async () => {
    h.detail = { data: undefined, isPending: true };
    const { user, rerenderUsers } = renderUsers();
    await user.click(screen.getByRole('button', { name: 'Ada Lovelace' }));
    const dialog = await screen.findByRole('dialog', { name: 'User details' });
    expect(dialog.querySelectorAll('[data-slot="skeleton"]').length).toBe(3);

    h.detail = { data: undefined, isPending: false };
    rerenderUsers();
    expect(
      await within(screen.getByRole('dialog', { name: 'User details' })).findByRole('heading', {
        name: 'Could not load users',
      }),
    ).toBeTruthy();
  });

  it('renders contributed plugin tabs', async () => {
    h.plugins = [
      {
        id: 'audit',
        adminUserTabs: [
          {
            id: 'log',
            label: 'Audit log',
            component: ({ userId }: { userId: string }) => <p>Audit for {userId}</p>,
          },
        ],
      },
      { id: 'other' },
    ];
    const { user } = renderUsers();
    const dialog = await openInspector(user);
    await user.click(within(dialog).getByRole('tab', { name: 'Audit log' }));
    expect(await within(dialog).findByText('Audit for u-ada')).toBeTruthy();
  });
});

describe('AdminUsers inspector security and danger zone', () => {
  async function openConfirm(
    user: ReturnType<typeof userEvent.setup>,
    action: string,
    name = 'Ada Lovelace',
  ) {
    const dialog = await openInspector(user, name);
    await user.click(within(dialog).getByRole('button', { name: action }));
    return screen.findByRole('dialog', { name: action });
  }

  it('sets a password', async () => {
    const { user } = renderUsers();
    const dialog = await openInspector(user);
    await user.click(within(dialog).getByRole('button', { name: 'Set password' }));
    const panel = await screen.findByRole('dialog', { name: 'Set password' });
    const submit = within(panel).getByRole('button', { name: 'Set password' }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    await user.type(within(panel).getByLabelText('Password'), 'another-fixture-pw');
    await user.click(submit);
    await waitFor(() => expect(h.admin.setUserPassword).toHaveBeenCalledOnce());
    expect(h.admin.setUserPassword.mock.calls[0][0]).toMatchObject({
      userId: 'u-ada',
      newPassword: 'another-fixture-pw',
    });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Set password' })).toBeNull());
  });

  it('shows safe copy when setting a password fails and cancels cleanly', async () => {
    h.admin.setUserPassword.mockRejectedValue(
      Object.assign(new Error('x'), { code: 'PASSWORD_TOO_SHORT' }),
    );
    const { user } = renderUsers();
    const dialog = await openInspector(user);
    await user.click(within(dialog).getByRole('button', { name: 'Set password' }));
    const panel = await screen.findByRole('dialog', { name: 'Set password' });
    await user.type(within(panel).getByLabelText('Password'), 'short');
    await user.click(within(panel).getByRole('button', { name: 'Set password' }));
    expect(await within(panel).findByText('This password is too short.')).toBeTruthy();
    expect(within(panel).getByLabelText('Password').getAttribute('aria-invalid')).toBe('true');
    await user.click(within(panel).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Set password' })).toBeNull());
  });

  it('keeps the password dialog open while saving', async () => {
    let resolve: (value: unknown) => void = () => {};
    h.admin.setUserPassword.mockReturnValue(new Promise((r) => (resolve = r)));
    const { user } = renderUsers();
    const dialog = await openInspector(user);
    await user.click(within(dialog).getByRole('button', { name: 'Set password' }));
    const panel = await screen.findByRole('dialog', { name: 'Set password' });
    await user.type(within(panel).getByLabelText('Password'), 'another-fixture-pw');
    await user.click(within(panel).getByRole('button', { name: 'Set password' }));
    await user.keyboard('{Escape}');
    await user.click(within(panel).getByRole('button', { name: 'Close panel' }));
    expect(screen.getByRole('dialog', { name: 'Set password' })).toBeTruthy();
    await act(async () => resolve({ data: {} }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Set password' })).toBeNull());
  });

  it('disables actions the actor lacks permission for', async () => {
    h.permissions['user:set-password'] = false;
    h.permissions['user:ban'] = false;
    h.permissions['user:delete'] = 'pending';
    const { user } = renderUsers();
    const dialog = await openInspector(user);
    for (const label of ['Set password', 'Ban user', 'Delete user']) {
      expect(
        (within(dialog).getByRole('button', { name: label }) as HTMLButtonElement).disabled,
      ).toBe(true);
    }
  });

  it('bans a user with a reason and duration', async () => {
    const { user } = renderUsers();
    const confirm = await openConfirm(user, 'Ban user');
    expect(within(confirm).getByText('ada@jarxis.test')).toBeTruthy();
    const action = within(confirm).getAllByRole('button', { name: 'Ban user' }).at(-1)!;
    await user.type(within(confirm).getByLabelText('Ban duration (days)'), '0');
    expect((action as HTMLButtonElement).disabled).toBe(true);
    await user.clear(within(confirm).getByLabelText('Ban duration (days)'));
    await user.type(within(confirm).getByLabelText('Ban duration (days)'), '2');
    await user.type(within(confirm).getByLabelText('Ban reason'), '  spam  ');
    await user.click(action);

    await waitFor(() => expect(h.admin.banUser).toHaveBeenCalledOnce());
    expect(h.admin.banUser.mock.calls[0][0]).toMatchObject({
      banExpiresIn: 172_800,
      banReason: 'spam',
      userId: 'u-ada',
    });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Ban user' })).toBeNull());
  });

  it('bans permanently without a reason and reports failures safely', async () => {
    h.admin.banUser.mockRejectedValueOnce(forbidden());
    const { user } = renderUsers();
    const confirm = await openConfirm(user, 'Ban user');
    const action = within(confirm).getAllByRole('button', { name: 'Ban user' }).at(-1)!;
    await user.click(action);
    expect(await within(confirm).findByText("You don't have permission to do this.")).toBeTruthy();
    expect(h.admin.banUser.mock.calls[0][0]).toMatchObject({
      banExpiresIn: undefined,
      banReason: undefined,
    });
    await user.click(within(confirm).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Ban user' })).toBeNull());
    expect(await screen.findByRole('dialog', { name: 'Ada Lovelace' })).toBeTruthy();
  });

  it('rejects an oversized ban duration', async () => {
    const { user } = renderUsers();
    const confirm = await openConfirm(user, 'Ban user');
    await user.type(within(confirm).getByLabelText('Ban duration (days)'), '1e300');
    const action = within(confirm).getAllByRole('button', { name: 'Ban user' }).at(-1)!;
    expect((action as HTMLButtonElement).disabled).toBe(true);
  });

  it('unbans a banned user and shows unban failures', async () => {
    h.admin.unbanUser.mockRejectedValueOnce(forbidden());
    const { user } = renderUsers();
    const dialog = await openInspector(user, 'Bob Banned');
    await user.click(within(dialog).getByRole('button', { name: 'Unban user' }));
    await waitFor(() => expect(h.admin.unbanUser).toHaveBeenCalledOnce());
    expect(h.admin.unbanUser.mock.calls[0][0]).toMatchObject({ userId: 'u-bob' });
    expect(await within(dialog).findByText("You don't have permission to do this.")).toBeTruthy();
  });

  it('deletes a user and closes the inspector', async () => {
    const { user } = renderUsers();
    const confirm = await openConfirm(user, 'Delete user');
    await user.click(within(confirm).getAllByRole('button', { name: 'Delete user' }).at(-1)!);
    await waitFor(() => expect(h.admin.removeUser).toHaveBeenCalledOnce());
    expect(h.admin.removeUser.mock.calls[0][0]).toMatchObject({ userId: 'u-ada' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('keeps the confirmation open while the action is in flight', async () => {
    let resolve: (value: unknown) => void = () => {};
    h.admin.removeUser.mockReturnValue(new Promise((r) => (resolve = r)));
    const { user } = renderUsers();
    const confirm = await openConfirm(user, 'Delete user');
    const action = within(confirm).getAllByRole('button', { name: 'Delete user' }).at(-1)!;
    await user.click(action);
    await user.click(action);
    await user.keyboard('{Escape}');
    await user.click(within(confirm).getByRole('button', { name: 'Close panel' }));
    expect(screen.getByRole('dialog', { name: 'Delete user' })).toBeTruthy();
    expect(h.admin.removeUser).toHaveBeenCalledOnce();
    await act(async () => resolve({ data: {} }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('impersonates a user and follows the configured redirect', async () => {
    setConfig({ impersonationRedirectTo: '/dashboard' });
    const { user } = renderUsers();
    const dialog = await openInspector(user);
    await user.click(within(dialog).getByRole('button', { name: 'More actions' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Impersonate user' }));
    const confirm = await screen.findByRole('dialog', { name: 'Impersonate user' });
    await user.click(within(confirm).getByRole('button', { name: 'Impersonate user' }));
    await waitFor(() => expect(h.admin.impersonateUser).toHaveBeenCalledOnce());
    expect(h.admin.impersonateUser.mock.calls[0][0]).toMatchObject({ userId: 'u-ada' });
    await waitFor(() => expect(h.navigate).toHaveBeenCalledWith({ to: '/dashboard' }));
  });

  it('impersonates without a redirect when none is configured', async () => {
    const { user } = renderUsers();
    const dialog = await openInspector(user);
    await user.click(within(dialog).getByRole('button', { name: 'More actions' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Impersonate user' }));
    const confirm = await screen.findByRole('dialog', { name: 'Impersonate user' });
    await user.click(within(confirm).getByRole('button', { name: 'Impersonate user' }));
    await waitFor(() => expect(h.admin.impersonateUser).toHaveBeenCalledOnce());
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Impersonate user' })).toBeNull(),
    );
    expect(h.navigate).not.toHaveBeenCalled();
  });

  it('requires impersonate-admins to impersonate an admin', async () => {
    h.users = listResult([root, ada]);
    h.permissions['user:impersonate-admins'] = false;
    const { user } = renderUsers();
    const dialog = await openInspector(user, 'Root Admin');
    await user.click(within(dialog).getByRole('button', { name: 'More actions' }));
    const item = await screen.findByRole('menuitem', { name: 'Impersonate user' });
    expect(item.getAttribute('data-disabled')).not.toBeNull();
  });

  it('allows impersonating an admin with impersonate-admins', async () => {
    h.users = listResult([root]);
    const { user } = renderUsers();
    const dialog = await openInspector(user, 'Root Admin');
    await user.click(within(dialog).getByRole('button', { name: 'More actions' }));
    const item = await screen.findByRole('menuitem', { name: 'Impersonate user' });
    expect(item.getAttribute('data-disabled')).toBeNull();
  });
});

describe('AdminUsers inspector sessions', () => {
  const sessions = [
    {
      id: 's1',
      token: 'tok-1',
      userAgent: 'Firefox',
      ipAddress: '203.0.113.7',
      createdAt: new Date('2026-03-01T00:00:00Z'),
      expiresAt: new Date('2026-04-01T00:00:00Z'),
    },
    {
      id: 's2',
      token: 'tok-2',
      userAgent: '',
      ipAddress: null,
      createdAt: null,
      expiresAt: new Date('2026-04-01T00:00:00Z'),
    },
  ];

  async function openSessions(user: ReturnType<typeof userEvent.setup>) {
    const dialog = await openInspector(user);
    await user.click(within(dialog).getByRole('tab', { name: 'Sessions' }));
    return dialog;
  }

  it('lists sessions with IP addresses and revokes one', async () => {
    setConfig({ showIpAddress: true });
    h.sessions = { data: { sessions }, isPending: false };
    const { user } = renderUsers();
    const dialog = await openSessions(user);
    expect(await within(dialog).findByText('Firefox')).toBeTruthy();
    expect(within(dialog).getByText('203.0.113.7')).toBeTruthy();
    expect(within(dialog).getByText(/^– · /)).toBeTruthy();
    await user.click(within(dialog).getAllByRole('button', { name: 'Revoke' })[0]);
    await waitFor(() => expect(h.admin.revokeUserSession).toHaveBeenCalledOnce());
    expect(h.admin.revokeUserSession.mock.calls[0][0]).toMatchObject({ sessionToken: 'tok-1' });
  });

  it('revokes all sessions after confirmation', async () => {
    h.sessions = { data: { sessions }, isPending: false };
    const { user } = renderUsers();
    const dialog = await openSessions(user);
    expect(within(dialog).queryByText('203.0.113.7')).toBeNull();
    await user.click(await within(dialog).findByRole('button', { name: 'Revoke all sessions' }));
    const confirm = await screen.findByRole('dialog', { name: 'Revoke all sessions' });
    await user.click(within(confirm).getByRole('button', { name: 'Revoke all sessions' }));
    await waitFor(() => expect(h.admin.revokeUserSessions).toHaveBeenCalledOnce());
    expect(h.admin.revokeUserSessions.mock.calls[0][0]).toMatchObject({ userId: 'u-ada' });
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Revoke all sessions' })).toBeNull(),
    );
  });

  it('disables revoking without the revoke permission', async () => {
    h.permissions['session:revoke'] = false;
    h.sessions = { data: { sessions }, isPending: false };
    const { user } = renderUsers();
    const dialog = await openSessions(user);
    const all = (await within(dialog).findByRole('button', {
      name: 'Revoke all sessions',
    })) as HTMLButtonElement;
    expect(all.disabled).toBe(true);
    for (const button of within(dialog).getAllByRole('button', { name: 'Revoke' })) {
      expect((button as HTMLButtonElement).disabled).toBe(true);
    }
  });

  it('shows the empty and loading states', async () => {
    const { user, rerenderUsers } = renderUsers();
    const dialog = await openSessions(user);
    expect(await within(dialog).findByText('No active sessions')).toBeTruthy();
    h.sessions = { data: undefined, isPending: true };
    rerenderUsers();
    await waitFor(() => expect(within(dialog).queryByText('No active sessions')).toBeNull());
  });

  it('disables the sessions tab without the list permission', async () => {
    h.permissions['session:list'] = false;
    const { user } = renderUsers();
    const dialog = await openInspector(user);
    expect(
      (within(dialog).getByRole('tab', { name: 'Sessions' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});
