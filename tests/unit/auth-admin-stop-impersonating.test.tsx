import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { StopImpersonating } from '@/components/admin/users/action-panel/shared/stop-impersonating';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

/** The Better Auth UI hooks are mocked; no session or network request is involved. */

const state = vi.hoisted(() => ({
  session: null as unknown,
  stop: { isPending: false, mutate: vi.fn() },
}));

vi.mock('@better-auth-ui/react', () => ({
  useAuth: () => ({ authClient: { admin: {} } }),
  useAuthPlugin: () => ({ localization: { stopImpersonating: 'Stop impersonating' } }),
  useSession: () => ({ data: state.session }),
}));

vi.mock('@better-auth-ui/react/plugins/admin', () => ({
  useStopImpersonating: () => state.stop,
}));

function renderMenu() {
  return render(
    <DropdownMenu open>
      <DropdownMenuTrigger>Menu</DropdownMenuTrigger>
      <DropdownMenuContent>
        <StopImpersonating className="extra" />
      </DropdownMenuContent>
    </DropdownMenu>,
  );
}

beforeEach(() => {
  state.session = null;
  state.stop = { isPending: false, mutate: vi.fn() };
});

describe('StopImpersonating', () => {
  it('renders nothing for a normal session', () => {
    state.session = { user: { id: 'u1' }, session: { impersonatedBy: null } };
    renderMenu();
    expect(screen.queryByRole('menuitem', { name: 'Stop impersonating' })).toBeNull();
  });

  it('restores the admin session when selected', async () => {
    state.session = { user: { id: 'u2' }, session: { impersonatedBy: 'admin-1' } };
    renderMenu();
    const item = screen.getByRole('menuitem', { name: 'Stop impersonating' });
    expect(item.className).toContain('extra');
    await userEvent.setup().click(item);
    expect(state.stop.mutate).toHaveBeenCalledWith(undefined);
  });

  it('is disabled with a spinner while the restore is pending', () => {
    state.session = { user: { id: 'u2' }, session: { impersonatedBy: 'admin-1' } };
    state.stop = { isPending: true, mutate: vi.fn() };
    renderMenu();
    const item = screen.getByRole('menuitem', { name: /Stop impersonating/ });
    expect(item.getAttribute('data-disabled')).not.toBeNull();
    expect(screen.getByRole('status', { name: 'Loading' })).toBeTruthy();
  });
});
