import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ success: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: h.success, error: vi.fn() } }));

import { RolesManager, type RoleView } from '@/components/admin/roles-manager';

const owner: RoleView = {
  key: 'owner',
  name: 'Owner',
  description: 'Full access',
  permissions: ['roles:update', 'audit:read'],
  system: true,
};
const auditor: RoleView = {
  key: 'custom_a',
  name: 'Auditor',
  description: 'Reads audit',
  permissions: ['audit:read'],
  system: false,
  userCount: 0,
};
const catalog = [
  { key: 'dashboard:read', description: 'View the dashboard', restricted: false },
  { key: 'audit:read', description: 'View audit events', restricted: false },
  { key: 'roles:update', description: 'Manage roles', restricted: true },
  { key: 'mystery:read', description: 'Something else', restricted: false },
];
const fetchMock = vi.fn();
const reply = (status: number, body: unknown) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

function renderManager(roles = [owner, auditor], canManage = true) {
  return render(<RolesManager initialRoles={roles} catalog={catalog} canManage={canManage} />);
}

describe('RolesManager', () => {
  it('shows system roles locked and roles read only to non-owners', () => {
    renderManager([owner, auditor], false);
    expect(screen.getByText(/Locked system role/)).toBeTruthy();
    expect(screen.getByText('1 permissions · Custom role · 0 users')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Create role' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
  });

  it('offers duplicate only for system roles and edit/delete for custom roles', () => {
    renderManager();
    const ownerCard = screen.getByText('Owner').closest('[data-slot="card"]') as HTMLElement;
    expect(within(ownerCard).getByRole('button', { name: 'Duplicate' })).toBeTruthy();
    expect(within(ownerCard).queryByRole('button', { name: 'Edit' })).toBeNull();
    expect(within(ownerCard).queryByRole('button', { name: 'Delete' })).toBeNull();
    expect(screen.getByRole('list', { name: 'Owner permissions' })).toBeTruthy();
  });

  it('creates a role with grouped permissions and locked owner-only grants', async () => {
    const user = userEvent.setup();
    fetchMock
      .mockReturnValueOnce(reply(201, { role: {} }))
      .mockReturnValueOnce(
        reply(200, { roles: [owner, auditor, { ...auditor, key: 'b', name: 'Reader' }] }),
      );
    renderManager();
    await user.click(screen.getByRole('button', { name: 'Create role' }));
    const dialog = await screen.findByRole('dialog', { name: 'Create role' });
    expect(
      (within(dialog).getByRole('button', { name: 'Save role' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(within(dialog).getByRole('group', { name: 'Dashboard' })).toBeTruthy();
    expect(within(dialog).getByRole('group', { name: 'Other' })).toBeTruthy();
    const locked = within(dialog).getByRole('checkbox', { name: /Manage roles/ });
    expect(locked.hasAttribute('disabled')).toBe(true);
    expect(within(dialog).getByText(/roles:update · Owner only/)).toBeTruthy();

    await user.type(within(dialog).getByLabelText('Name'), 'Reader');
    await user.type(within(dialog).getByLabelText('Description'), 'Reads');
    await user.click(within(dialog).getByRole('checkbox', { name: /View the dashboard/ }));
    await user.click(within(dialog).getByRole('checkbox', { name: /View audit events/ }));
    await user.click(within(dialog).getByRole('checkbox', { name: /View audit events/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Save role' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/admin/roles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Reader',
        description: 'Reads',
        permissions: ['dashboard:read'],
      }),
    });
    expect(h.success).toHaveBeenCalledWith('Role saved');
    expect(screen.getByText('Reader')).toBeTruthy();
  });

  it('duplicates a system role without its owner-only grants', async () => {
    const user = userEvent.setup();
    renderManager();
    const ownerCard = screen.getByText('Owner').closest('[data-slot="card"]') as HTMLElement;
    await user.click(within(ownerCard).getByRole('button', { name: 'Duplicate' }));
    const dialog = await screen.findByRole('dialog', { name: 'Create role' });
    expect((within(dialog).getByLabelText('Name') as HTMLInputElement).value).toBe('Owner copy');
    expect(
      within(dialog)
        .getByRole('checkbox', { name: /View audit events/ })
        .getAttribute('data-state'),
    ).toBe('checked');
    expect(
      within(dialog)
        .getByRole('checkbox', { name: /Manage roles/ })
        .getAttribute('data-state'),
    ).toBe('unchecked');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('shows the first validation issue or error message in the form', async () => {
    const user = userEvent.setup();
    fetchMock
      .mockReturnValueOnce(
        reply(400, { error: { message: 'Invalid request', issues: [{ message: 'Too short' }] } }),
      )
      .mockReturnValueOnce(reply(409, { error: { message: 'This role name is already in use' } }))
      .mockReturnValueOnce(reply(500, {}))
      .mockRejectedValueOnce('offline');
    renderManager();
    const card = screen.getByText('Auditor').closest('[data-slot="card"]') as HTMLElement;
    await user.click(within(card).getByRole('button', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit role' });
    const save = within(dialog).getByRole('button', { name: 'Save role' });
    for (const message of [
      'Too short',
      'This role name is already in use',
      'Could not save role',
      'Could not save role',
    ]) {
      await user.click(save);
      expect((await within(dialog).findByRole('alert')).textContent).toBe(message);
    }
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin/roles/custom_a',
      expect.objectContaining({ method: 'PATCH' }),
    );
  });

  it('reports a failed refresh after saving', async () => {
    const user = userEvent.setup();
    fetchMock.mockReturnValueOnce(reply(200, {})).mockReturnValueOnce(reply(500, {}));
    renderManager();
    const card = screen.getByText('Auditor').closest('[data-slot="card"]') as HTMLElement;
    await user.click(within(card).getByRole('button', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit role' });
    await user.click(within(dialog).getByRole('button', { name: 'Save role' }));
    expect((await within(dialog).findByRole('alert')).textContent).toBe('Could not refresh roles');
  });

  it('blocks deleting a role that users still have and says how many', () => {
    renderManager([owner, { ...auditor, userCount: 2 }]);
    const button = screen.getByRole('button', { name: 'Delete' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(screen.getByText('Move 2 users to another role before deleting it.')).toBeTruthy();
    expect(button.getAttribute('aria-describedby')).toBe('role-in-use-custom_a');
  });

  it('deletes an unused role after confirmation', async () => {
    const user = userEvent.setup();
    fetchMock
      .mockReturnValueOnce(reply(200, { deleted: true }))
      .mockReturnValueOnce(reply(200, { roles: [owner] }));
    renderManager();
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Delete role?' });
    await user.click(within(dialog).getByRole('button', { name: 'Delete role' }));
    await waitFor(() => expect(screen.queryByText('Auditor')).toBeNull());
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/admin/roles/custom_a', { method: 'DELETE' });
    expect(h.success).toHaveBeenCalledWith('Role deleted');
  });

  it('shows a refused delete on the role card', async () => {
    const user = userEvent.setup();
    fetchMock
      .mockReturnValueOnce(reply(409, { error: { message: '1 user must change role first' } }))
      .mockReturnValueOnce(reply(500, {}))
      .mockRejectedValueOnce('offline');
    renderManager();
    for (const message of [
      '1 user must change role first',
      'Could not delete role',
      'Could not delete role',
    ]) {
      await user.click(screen.getByRole('button', { name: 'Delete' }));
      const dialog = await screen.findByRole('alertdialog');
      await user.click(within(dialog).getByRole('button', { name: 'Delete role' }));
      expect((await screen.findByRole('alert')).textContent).toBe(message);
    }
  });
});
