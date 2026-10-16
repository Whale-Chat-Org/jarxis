import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ success: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: h.success, error: vi.fn() } }));

import { RolesManager, type RoleView } from '@/components/admin/roles-manager';
import { AdminPanelHost } from '@/components/ui/admin-panel';

const owner: RoleView = {
  key: 'owner',
  name: 'Owner',
  description: 'Full access',
  permissions: ['roles:update', 'audit:read'],
  system: true,
  editable: false,
  userCount: 1,
};
const viewer: RoleView = {
  key: 'viewer',
  name: 'Viewer',
  description: 'Read-only',
  permissions: ['audit:read'],
  system: true,
  editable: true,
  userCount: 3,
};
const auditor: RoleView = {
  key: 'custom_a',
  name: 'Auditor',
  description: 'Reads audit',
  permissions: ['audit:read'],
  system: false,
  editable: true,
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

function renderManager(roles = [owner, viewer, auditor], canManage = true) {
  return render(
    <AdminPanelHost>
      <RolesManager initialRoles={roles} catalog={catalog} canManage={canManage} />
    </AdminPanelHost>,
  );
}
const row = (name: string) => screen.getByRole('button', { name }).closest('tr') as HTMLElement;
async function menu(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(screen.getByRole('button', { name: `Actions for ${name}` }));
  return screen.findByRole('menu');
}

describe('RolesManager', () => {
  it('lists roles in a table with type, permission and user counts', () => {
    renderManager();
    expect(screen.getByRole('table')).toBeTruthy();
    expect(within(row('Owner')).getByText('Locked')).toBeTruthy();
    expect(within(row('Viewer')).getByText('System')).toBeTruthy();
    expect(within(row('Auditor')).getByText('Custom')).toBeTruthy();
    expect(within(row('Owner')).getAllByRole('cell')[2].textContent).toBe('2');
    expect(within(row('Viewer')).getAllByRole('cell')[3].textContent).toBe('3');
  });

  it('shows roles read only to non-owners', async () => {
    const user = userEvent.setup();
    renderManager([owner, viewer, auditor], false);
    expect(screen.queryByRole('button', { name: 'Create role' })).toBeNull();
    const actions = await menu(user, 'Auditor');
    expect(within(actions).getByRole('menuitem', { name: 'View' })).toBeTruthy();
    expect(within(actions).queryByRole('menuitem', { name: 'Duplicate' })).toBeNull();
    expect(within(actions).queryByRole('menuitem', { name: 'Delete' })).toBeNull();
    await user.click(within(actions).getByRole('menuitem', { name: 'View' }));
    const panel = await screen.findByRole('dialog', { name: 'Auditor' });
    expect((within(panel).getByLabelText('Name') as HTMLInputElement).disabled).toBe(true);
    expect(within(panel).queryByRole('button', { name: 'Save role' })).toBeNull();
  });

  it('views a locked role with all its grants and offers duplicate', async () => {
    const user = userEvent.setup();
    renderManager();
    await user.click(screen.getByRole('button', { name: 'Owner' }));
    const panel = await screen.findByRole('dialog', { name: 'Owner' });
    expect(within(panel).getByText(/This role is locked/)).toBeTruthy();
    expect(
      within(panel)
        .getByRole('checkbox', { name: /Manage roles/ })
        .getAttribute('data-state'),
    ).toBe('checked');
    await user.click(within(panel).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const actions = await menu(user, 'Owner');
    expect(within(actions).queryByRole('menuitem', { name: 'Edit' })).toBeNull();
    expect(within(actions).queryByRole('menuitem', { name: /Delete/ })).toBeNull();
    expect(within(actions).getByRole('menuitem', { name: 'Duplicate' })).toBeTruthy();
  });

  it('creates a role in the side panel with grouped permissions', async () => {
    const user = userEvent.setup();
    fetchMock
      .mockReturnValueOnce(reply(201, { role: {} }))
      .mockReturnValueOnce(
        reply(200, { roles: [owner, auditor, { ...auditor, key: 'b', name: 'Reader' }] }),
      );
    renderManager();
    await user.click(screen.getByRole('button', { name: 'Create role' }));
    const panel = await screen.findByRole('dialog', { name: 'Create role' });
    expect(panel.getAttribute('data-slot')).toBe('admin-panel');
    expect(
      (within(panel).getByRole('button', { name: 'Save role' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(within(panel).getByRole('group', { name: 'Dashboard' })).toBeTruthy();
    expect(within(panel).getByRole('group', { name: 'Other' })).toBeTruthy();
    const locked = within(panel).getByRole('checkbox', { name: /Manage roles/ });
    expect(locked.hasAttribute('disabled')).toBe(true);
    expect(within(panel).getByText(/roles:update · Owner only/)).toBeTruthy();

    await user.type(within(panel).getByLabelText('Name'), 'Reader');
    await user.type(within(panel).getByLabelText('Description'), 'Reads');
    await user.click(within(panel).getByRole('checkbox', { name: /View the dashboard/ }));
    await user.click(within(panel).getByRole('checkbox', { name: /View audit events/ }));
    await user.click(within(panel).getByRole('checkbox', { name: /View audit events/ }));
    await user.click(within(panel).getByRole('button', { name: 'Save role' }));

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
    expect(screen.getByRole('button', { name: 'Reader' })).toBeTruthy();
  });

  it('edits a system role without renaming it', async () => {
    const user = userEvent.setup();
    fetchMock
      .mockReturnValueOnce(reply(200, { role: {} }))
      .mockReturnValueOnce(reply(200, { roles: [owner, viewer] }));
    renderManager();
    await user.click(within(await menu(user, 'Viewer')).getByRole('menuitem', { name: 'Edit' }));
    const panel = await screen.findByRole('dialog', { name: 'Edit role' });
    expect((within(panel).getByLabelText('Name') as HTMLInputElement).disabled).toBe(true);
    expect(within(panel).getByText('System roles keep their name.')).toBeTruthy();
    await user.click(within(panel).getByRole('checkbox', { name: /View the dashboard/ }));
    await user.click(within(panel).getByRole('button', { name: 'Save role' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/admin/roles/viewer', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Viewer',
        description: 'Read-only',
        permissions: ['audit:read', 'dashboard:read'],
      }),
    });
  });

  it('duplicates a system role without its owner-only grants', async () => {
    const user = userEvent.setup();
    renderManager();
    await user.click(
      within(await menu(user, 'Owner')).getByRole('menuitem', { name: 'Duplicate' }),
    );
    const panel = await screen.findByRole('dialog', { name: 'Create role' });
    expect((within(panel).getByLabelText('Name') as HTMLInputElement).value).toBe('Owner copy');
    expect(
      within(panel)
        .getByRole('checkbox', { name: /View audit events/ })
        .getAttribute('data-state'),
    ).toBe('checked');
    expect(
      within(panel)
        .getByRole('checkbox', { name: /Manage roles/ })
        .getAttribute('data-state'),
    ).toBe('unchecked');
    await user.click(within(panel).getByRole('button', { name: 'Cancel' }));
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
    await user.click(screen.getByRole('button', { name: 'Auditor' }));
    const panel = await screen.findByRole('dialog', { name: 'Edit role' });
    const save = within(panel).getByRole('button', { name: 'Save role' });
    for (const message of [
      'Too short',
      'This role name is already in use',
      'Could not save role',
      'Could not save role',
    ]) {
      await user.click(save);
      expect((await within(panel).findByRole('alert')).textContent).toBe(message);
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
    await user.click(row('Auditor'));
    const panel = await screen.findByRole('dialog', { name: 'Edit role' });
    await user.click(within(panel).getByRole('button', { name: 'Save role' }));
    expect((await within(panel).findByRole('alert')).textContent).toBe('Could not refresh roles');
  });

  it('blocks deleting a role that users still have and says how many', async () => {
    const user = userEvent.setup();
    renderManager([owner, { ...auditor, userCount: 2 }]);
    const item = within(await menu(user, 'Auditor')).getByRole('menuitem', {
      name: 'Delete (move 2 users first)',
    });
    expect(item.getAttribute('aria-disabled')).toBe('true');
  });

  it('deletes an unused role after confirmation', async () => {
    const user = userEvent.setup();
    fetchMock
      .mockReturnValueOnce(reply(200, { deleted: true }))
      .mockReturnValueOnce(reply(200, { roles: [owner] }));
    renderManager();
    await user.click(within(await menu(user, 'Auditor')).getByRole('menuitem', { name: 'Delete' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Delete role?' });
    await user.click(within(dialog).getByRole('button', { name: 'Delete role' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Auditor' })).toBeNull());
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/admin/roles/custom_a', { method: 'DELETE' });
    expect(h.success).toHaveBeenCalledWith('Role deleted');
  });

  it('shows a refused delete above the table', async () => {
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
      await user.click(
        within(await menu(user, 'Auditor')).getByRole('menuitem', { name: 'Delete' }),
      );
      const dialog = await screen.findByRole('alertdialog');
      await user.click(within(dialog).getByRole('button', { name: 'Delete role' }));
      expect((await screen.findByRole('alert')).textContent).toBe(message);
    }
  });
});
