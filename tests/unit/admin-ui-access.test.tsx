import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef, useState, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Query = {
  data?: unknown;
  isPending: boolean;
  isError: boolean;
  isSuccess: boolean;
  isFetching: boolean;
  refetch: ReturnType<typeof vi.fn>;
};

type TestUser = {
  id: string;
  name: string;
  email: string;
  role?: string | null;
  banned?: boolean | null;
  banExpires?: string | null;
  emailVerified: boolean;
};

const mocks = vi.hoisted(() => ({
  toast: { success: vi.fn(), error: vi.fn() },
  listPermission: undefined as unknown as Query,
  rolePermission: undefined as unknown as Query,
  users: undefined as unknown as (options: { params: Record<string, unknown> }) => Query,
  usersCalls: [] as Record<string, unknown>[],
  detail: undefined as unknown as (userId?: string) => Query,
  mutationFn: vi.fn(),
}));

vi.mock('sonner', () => ({ toast: mocks.toast }));
vi.mock('next/navigation', () => ({ usePathname: () => '/admin/users' }));
vi.mock('@better-auth-ui/react', () => ({ useAuth: () => ({ authClient: {} }) }));
vi.mock('@better-auth-ui/react/plugins/admin', () => ({
  useAdminPermission: (_client: unknown, permission: Record<string, string[]>) =>
    permission.user?.[0] === 'list' ? mocks.listPermission : mocks.rolePermission,
  useAdminUsers: (_client: unknown, options: { params: Record<string, unknown> }) => {
    mocks.usersCalls.push(options.params);
    return mocks.users(options);
  },
  useAdminUser: (_client: unknown, userId?: string) => mocks.detail(userId),
}));
vi.mock('@better-auth-ui/core/plugins/admin', () => ({
  setAdminUserRoleOptions: () => ({
    mutationKey: ['auth', 'admin', 'setRole'],
    mutationFn: mocks.mutationFn,
    meta: { awaits: [] },
  }),
}));
vi.mock('@/components/auth/user/user-avatar', () => ({
  UserAvatar: () => <span data-testid="avatar" />,
}));

import { AccessManager } from '@/components/admin/access-manager';
import { ChangeRoleDialog } from '@/components/admin/change-role-dialog';
import { AdminPanelHost } from '@/components/ui/admin-panel';

function query(overrides: Partial<Query> = {}): Query {
  return {
    data: undefined,
    isPending: false,
    isError: false,
    isSuccess: true,
    isFetching: false,
    refetch: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

const people: TestUser[] = [
  { id: 'me', name: 'Me Owner', email: 'me@jarxis.test', role: 'owner', emailVerified: true },
  { id: 'u2', name: 'Vera Viewer', email: 'vera@jarxis.test', role: 'viewer', emailVerified: true },
  {
    id: 'u3',
    name: '',
    email: 'banned@jarxis.test',
    role: 'legacy',
    banned: true,
    emailVerified: false,
  },
  { id: 'u4', name: 'No Role', email: 'none@jarxis.test', role: null, emailVerified: true },
  ...Array.from({ length: 8 }, (_, index) => ({
    id: `p${index}`,
    name: `Person ${index}`,
    email: `person${index}@jarxis.test`,
    role: 'user',
    emailVerified: true,
  })),
];

function directory(list: TestUser[] = people) {
  return ({ params }: { params: Record<string, unknown> }) => {
    const value = params.searchValue as string | undefined;
    const field = params.searchField as 'name' | 'email';
    const matches = value ? list.filter((person) => person[field].includes(value)) : list;
    const offset = params.offset as number;
    return query({
      data: {
        users: matches.slice(offset, offset + (params.limit as number)),
        total: matches.length,
      },
    });
  };
}

function wrap(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return (
    <QueryClientProvider client={client}>
      <AdminPanelHost>{children}</AdminPanelHost>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  mocks.listPermission = query({ data: { success: true } });
  mocks.rolePermission = query({ data: { success: true } });
  mocks.users = directory();
  mocks.usersCalls = [];
  mocks.detail = (userId) =>
    query({ data: people.find((person) => person.id === userId), isSuccess: Boolean(userId) });
  mocks.mutationFn.mockReset();
  mocks.mutationFn.mockResolvedValue({ user: {} });
  mocks.toast.success.mockReset();
});

function renderManager(canManageAccess = true) {
  const user = userEvent.setup();
  const view = render(wrap(<AccessManager currentUserId="me" canManageAccess={canManageAccess} />));
  return { user, ...view };
}

const table = () => screen.getByRole('table');

describe('AccessManager states', () => {
  it('shows a skeleton while the permission check is pending', () => {
    mocks.listPermission = query({ isPending: true, isSuccess: false });
    renderManager();
    expect(screen.getByText('Loading people…')).toBeTruthy();
  });

  it('offers a retry when the permission check fails', async () => {
    mocks.listPermission = query({ isError: true, isSuccess: false });
    const { user } = renderManager();
    expect(screen.getByText('Could not check access')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(mocks.listPermission.refetch).toHaveBeenCalled();
  });

  it('explains when access is denied', () => {
    mocks.listPermission = query({ data: { success: false } });
    renderManager();
    expect(screen.getByText('Access denied')).toBeTruthy();
  });

  it('offers a retry when the list fails', async () => {
    const failed = query({ isError: true, isSuccess: false });
    mocks.users = () => failed;
    const { user } = renderManager();
    expect(screen.getByText('Could not load people')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(failed.refetch).toHaveBeenCalled();
  });

  it('shows a skeleton while the list is pending', () => {
    mocks.users = () => query({ isPending: true, isSuccess: false });
    renderManager();
    expect(screen.getByText('Loading people…')).toBeTruthy();
  });

  it('shows an empty state', () => {
    mocks.users = directory([]);
    renderManager();
    expect(screen.getByText('No people found')).toBeTruthy();
  });
});

describe('AccessManager directory', () => {
  it('lists people with roles, statuses and the self row', () => {
    renderManager();
    const rows = within(table()).getAllByRole('row');
    expect(rows).toHaveLength(11);
    const self = rows[1];
    expect(within(self).getByText('Me Owner')).toBeTruthy();
    expect(within(self).getByText('Owner')).toBeTruthy();
    expect(within(self).getByText('You')).toBeTruthy();
    expect(within(self).queryByRole('button', { name: 'Change role' })).toBeNull();

    const banned = rows[3];
    // No name falls back to the address.
    expect(within(banned).getAllByText('banned@jarxis.test')).toHaveLength(2);
    expect(within(banned).getByText('legacy')).toBeTruthy();
    expect(within(banned).getByText('Banned')).toBeTruthy();
    expect(within(banned).getByText('Unverified')).toBeTruthy();
    expect(within(rows[4]).getByText('No role')).toBeTruthy();
    expect(within(rows[2]).getByText('Active')).toBeTruthy();

    expect(within(table()).getAllByRole('button', { name: 'Change role' })).toHaveLength(9);
    expect(screen.getByText('Role change')).toBeTruthy();
    // The mobile list repeats the same people.
    expect(screen.getAllByRole('listitem')).toHaveLength(10);
    expect(screen.getByText('1–10 of 12')).toBeTruthy();
  });

  it('pages through results', async () => {
    const { user } = renderManager();
    const previous = screen.getByRole('button', { name: 'Previous page' });
    expect(previous.hasAttribute('disabled')).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Next page' }));
    expect(screen.getByText('11–12 of 12')).toBeTruthy();
    expect(mocks.usersCalls.at(-1)).toMatchObject({ offset: 10, limit: 10 });
    expect(screen.getByRole('button', { name: 'Next page' }).hasAttribute('disabled')).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Previous page' }));
    expect(screen.getByText('1–10 of 12')).toBeTruthy();
  });

  it('is read-only without the server-side grant', () => {
    renderManager(false);
    expect(screen.queryByRole('button', { name: 'Change role' })).toBeNull();
    expect(screen.queryByText('You')).toBeNull();
    expect(screen.queryByText('Role change')).toBeNull();
  });

  it('is read-only when the client role permission is missing', () => {
    mocks.rolePermission = query({ data: { success: false } });
    renderManager(true);
    expect(screen.queryByRole('button', { name: 'Change role' })).toBeNull();
  });

  it('searches by email or name and returns to the first page', async () => {
    const { user } = renderManager();
    await user.click(screen.getByRole('button', { name: 'Next page' }));
    await user.type(screen.getByLabelText('Search by name or email'), 'vera@');
    // The skeleton covers the debounce window.
    expect(screen.getByText('Loading people…')).toBeTruthy();
    await waitFor(() =>
      expect(mocks.usersCalls.at(-1)).toMatchObject({
        searchField: 'email',
        searchValue: 'vera@',
        offset: 0,
        searchOperator: 'contains',
      }),
    );
    expect(await screen.findByText('1–1 of 1')).toBeTruthy();

    await user.clear(screen.getByLabelText('Search by name or email'));
    await user.type(screen.getByLabelText('Search by name or email'), 'Person');
    await waitFor(() =>
      expect(mocks.usersCalls.at(-1)).toMatchObject({ searchField: 'name', searchValue: 'Person' }),
    );
  });

  it('clamps to the last populated page when the total shrinks', async () => {
    const { user, rerender } = renderManager();
    await user.click(screen.getByRole('button', { name: 'Next page' }));
    mocks.users = directory(people.slice(0, 4));
    rerender(wrap(<AccessManager currentUserId="me" canManageAccess />));
    await waitFor(() => expect(mocks.usersCalls.at(-1)).toMatchObject({ offset: 0 }));
  });

  it('marks fetching rows as pending', () => {
    const base = directory();
    mocks.users = (options) => ({ ...base(options), isFetching: true });
    renderManager();
    // Fetching shows the skeleton instead of stale rows.
    expect(screen.getByText('Loading people…')).toBeTruthy();
  });

  it('opens the role dialog for a row', async () => {
    const { user } = renderManager();
    const row = within(table()).getAllByRole('row')[2];
    await user.click(within(row).getByRole('button', { name: 'Change role' }));
    expect(await screen.findByText('Vera Viewer · vera@jarxis.test')).toBeTruthy();
    expect(screen.getByText('Current: Viewer')).toBeTruthy();
  });
});

function Harness({
  userId = 'u2',
  initiallyOpen = true,
  onOpenChange,
}: {
  userId?: string;
  initiallyOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [open, setOpen] = useState(initiallyOpen);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  return (
    <>
      <button ref={triggerRef} onClick={() => setOpen(true)}>
        Open dialog
      </button>
      <ChangeRoleDialog
        triggerRef={triggerRef}
        userId={userId}
        open={open}
        viewerId="me"
        onOpenChange={(next) => {
          onOpenChange?.(next);
          setOpen(next);
        }}
      />
    </>
  );
}

function renderDialog(props: Parameters<typeof Harness>[0] = {}) {
  const user = userEvent.setup();
  render(wrap(<Harness {...props} />));
  return user;
}

const radio = (label: RegExp) => screen.getByRole('radio', { name: label });

describe('ChangeRoleDialog', () => {
  it('shows a loading state for the person', () => {
    mocks.detail = () => query({ isPending: true, isSuccess: false });
    renderDialog();
    expect(screen.getByText('Loading this person’s details.')).toBeTruthy();
    expect(screen.getByText('Loading this person’s role…')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Save role' })).toBeNull();
  });

  it('shows an error with a retry and no footer', async () => {
    const failed = query({ isError: true, isSuccess: false });
    mocks.detail = () => failed;
    const user = renderDialog();
    expect(screen.getByText('This person’s details could not be loaded.')).toBeTruthy();
    expect(screen.getByText('Details unavailable')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(failed.refetch).toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
  });

  it('saves a changed role, refreshes and closes', async () => {
    const onOpenChange = vi.fn();
    const detail = query({ data: people[1] });
    mocks.detail = () => detail;
    const user = renderDialog({ onOpenChange });
    const save = screen.getByRole('button', { name: 'Save role' });
    expect((radio(/^Viewer/) as HTMLButtonElement).getAttribute('aria-checked')).toBe('true');
    expect(save.hasAttribute('disabled')).toBe(true);

    await user.click(radio(/^Administrator/));
    expect(save.hasAttribute('disabled')).toBe(false);
    await user.click(save);

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(mocks.mutationFn.mock.calls[0][0]).toEqual({ userId: 'u2', role: ['administrator'] });
    expect(detail.refetch).toHaveBeenCalled();
    expect(mocks.toast.success).toHaveBeenCalledWith('Role updated for Vera Viewer');
  });

  it('confirms owner escalation inline', async () => {
    const user = renderDialog();
    await user.click(radio(/^Owner/));
    expect(
      screen.getByText(
        'Owners have full control, including assigning roles and deleting accounts.',
      ),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Make owner' })).toBeTruthy();
  });

  it('blocks owner for banned and unverified accounts', () => {
    mocks.detail = () => query({ data: people[2] });
    renderDialog({ userId: 'u3' });
    expect(screen.getByText('banned@jarxis.test')).toBeTruthy();
    expect(
      screen.getByText('An owner must be an active account, so a banned user cannot be an owner.'),
    ).toBeTruthy();
    expect(radio(/^Owner/).hasAttribute('disabled')).toBe(true);
    expect(screen.getByText('Current: legacy')).toBeTruthy();
  });

  it('explains an unverified account cannot be an owner', () => {
    mocks.detail = () => query({ data: { ...people[1], emailVerified: false } });
    renderDialog();
    expect(
      screen.getByText(
        'An owner must have a verified email address, so this user cannot be an owner yet.',
      ),
    ).toBeTruthy();
  });

  it('warns that saving replaces multiple roles and handles no role', () => {
    mocks.detail = () => query({ data: { ...people[1], role: 'viewer, administrator' } });
    renderDialog();
    expect(screen.getByText('Current: Viewer, Administrator')).toBeTruthy();
    expect(screen.getByText('Saving replaces all current roles.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save role' }).hasAttribute('disabled')).toBe(true);
  });

  it('shows "No role" for an account without roles', () => {
    mocks.detail = () => query({ data: people[3] });
    renderDialog({ userId: 'u4' });
    expect(screen.getByText('Current: No role')).toBeTruthy();
  });

  it('shows a safe inline error when the save fails', async () => {
    mocks.mutationFn.mockRejectedValue({ error: { code: 'LAST_OWNER' } });
    const user = renderDialog();
    await user.click(radio(/^User/));
    await user.click(screen.getByRole('button', { name: 'Save role' }));
    expect(await screen.findByText('Role not changed')).toBeTruthy();
    expect(
      screen.getByText('Keep at least one active, verified owner before making this change.'),
    ).toBeTruthy();
  });

  it('cannot be dismissed while a save is in flight', async () => {
    mocks.mutationFn.mockReturnValue(new Promise(() => {}));
    const onOpenChange = vi.fn();
    const user = renderDialog({ onOpenChange });
    await user.click(radio(/^User/));
    await user.click(screen.getByRole('button', { name: 'Save role' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Cancel' }).hasAttribute('disabled')).toBe(true),
    );
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: 'Close panel' }));
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(screen.getByText('Change role')).toBeTruthy();
  });

  it('cancels and returns focus to the trigger', async () => {
    const onOpenChange = vi.fn();
    const user = renderDialog({ initiallyOpen: false, onOpenChange });
    const trigger = screen.getByRole('button', { name: 'Open dialog' });
    await user.click(trigger);
    await user.click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    await waitFor(() => expect(screen.queryByText('Change role')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it('falls back to a fresh row trigger when the original is gone', async () => {
    function Detached() {
      const [open, setOpen] = useState(true);
      const ref = useRef<HTMLButtonElement | null>(null);
      return (
        <>
          <button
            data-access-user-id="u2"
            ref={(node) => {
              if (node) node.getClientRects = () => [{}] as unknown as DOMRectList;
            }}
          >
            Fresh trigger
          </button>
          <ChangeRoleDialog
            triggerRef={ref}
            userId="u2"
            open={open}
            viewerId="me"
            onOpenChange={setOpen}
          />
        </>
      );
    }
    const user = userEvent.setup();
    render(wrap(<Detached />));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Fresh trigger' })),
    );
  });
});
