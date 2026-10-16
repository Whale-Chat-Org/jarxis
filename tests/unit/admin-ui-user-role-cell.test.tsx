import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ setRole: vi.fn(), success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: h.success, error: h.error } }));
vi.mock('@better-auth-ui/react', () => ({ useAuth: () => ({ authClient: {} }) }));
vi.mock('@better-auth-ui/core/plugins/admin', () => ({
  setAdminUserRoleOptions: () => ({ mutationFn: h.setRole }),
}));

import { UserRoleCell } from '@/components/admin/user-role-cell';

const roles = [
  { key: 'user', name: 'User', description: '', permissions: [], system: true },
  { key: 'viewer', name: 'Viewer', description: '', permissions: [], system: true },
  { key: 'custom_a', name: 'Auditor', description: '', permissions: [], system: false },
];
const member = { id: 'u-1', name: 'Member', email: 'member@jarxis.test', role: 'user' };

function renderCell(props: Partial<ComponentProps<typeof UserRoleCell>> = {}) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <UserRoleCell user={member} currentUserId="me" canManageAccess roles={roles} {...props} />
    </QueryClientProvider>,
  );
}

async function choose(option: string) {
  const user = userEvent.setup();
  await user.click(screen.getByRole('combobox', { name: 'Role for Member' }));
  await user.click(await screen.findByRole('option', { name: option }));
  return { user, dialog: await screen.findByRole('alertdialog', { name: 'Change role?' }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.setRole.mockResolvedValue({});
});

describe('UserRoleCell', () => {
  it('is a read-only label marked You on your own row', () => {
    renderCell({ currentUserId: 'u-1' });
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.getByText('User')).toBeTruthy();
    expect(screen.getByText('You')).toBeTruthy();
  });

  it('is a read-only label without role-assignment access, using stored role names', () => {
    renderCell({ canManageAccess: false, user: { ...member, role: 'custom_a, viewer' } });
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.getByText('Auditor, Viewer')).toBeTruthy();
    expect(screen.queryByText('You')).toBeNull();
  });

  it('falls back to User for an empty role and the raw key for an unknown one', () => {
    const { unmount } = renderCell({ canManageAccess: false, user: { ...member, role: null } });
    expect(screen.getByText('User')).toBeTruthy();
    unmount();
    renderCell({ canManageAccess: false, user: { ...member, role: 'custom_gone' } });
    expect(screen.getByText('custom_gone')).toBeTruthy();
  });

  it('lists every role including custom ones and changes after confirmation', async () => {
    renderCell();
    const { user, dialog } = await choose('Auditor');
    expect(within(dialog).getByText('Change Member from User to Auditor?')).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: 'Change role' }));
    await waitFor(() => expect(h.success).toHaveBeenCalledWith('Role updated for Member'));
    expect(h.setRole.mock.calls[0][0]).toEqual({ userId: 'u-1', role: ['custom_a'] });
    expect(screen.getByText('Member is now Auditor')).toBeTruthy();
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('leaves the role unchanged when cancelled', async () => {
    renderCell();
    const { user, dialog } = await choose('Viewer');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(h.setRole).not.toHaveBeenCalled();
  });

  it('reports a failed change and keeps the dialog open to retry', async () => {
    h.setRole.mockRejectedValueOnce(new Error('FORBIDDEN'));
    renderCell({ user: { ...member, name: '' } });
    const user = userEvent.setup();
    await user.click(screen.getByRole('combobox', { name: 'Role for member@jarxis.test' }));
    await user.click(await screen.findByRole('option', { name: 'Viewer' }));
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Change role' }));
    await waitFor(() =>
      expect(h.error).toHaveBeenCalledWith('The role was not changed. Try again.'),
    );
    expect(screen.getByText('The role was not changed')).toBeTruthy();
    expect(screen.getByRole('alertdialog')).toBeTruthy();
  });

  it('lets a user with several roles be moved to one of them', async () => {
    renderCell({ user: { ...member, role: 'viewer,custom_a' } });
    const { user, dialog } = await choose('Viewer');
    await user.click(within(dialog).getByRole('button', { name: 'Change role' }));
    await waitFor(() => expect(h.setRole).toHaveBeenCalled());
    expect(h.setRole.mock.calls[0][0]).toEqual({ userId: 'u-1', role: ['viewer'] });
  });
});
