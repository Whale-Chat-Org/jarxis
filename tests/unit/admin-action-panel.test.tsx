import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState, type RefObject } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { AdminActionPanel } from '@/components/admin/action-panel/admin-action-panel';

import { AdminPanelHost } from '@/components/ui/admin-panel';

function ActionPanelHarness({
  pending = false,
  pendingRef,
}: {
  pending?: boolean;
  pendingRef?: RefObject<boolean>;
}) {
  const [open, setOpen] = useState(true);
  return (
    <AdminPanelHost>
      <AdminActionPanel
        header={{ title: 'Edit profile', description: 'Update this profile.' }}
        actions={[]}
        open={open}
        onOpenChange={setOpen}
        state={{ pending, pendingRef }}
      >
        <button
          onClick={() => {
            if (pendingRef) pendingRef.current = true;
          }}
        >
          Begin save
        </button>
        <button
          onClick={() => {
            if (pendingRef) pendingRef.current = false;
          }}
        >
          Finish save
        </button>
      </AdminActionPanel>
    </AdminPanelHost>
  );
}

describe('AdminActionPanel dismissal', () => {
  it('blocks Escape and the close button while pending, then allows closing', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<ActionPanelHarness pending />);
    await screen.findByRole('dialog', { name: 'Edit profile' });
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: 'Close panel' }));
    expect(screen.getByRole('dialog', { name: 'Edit profile' })).toBeTruthy();
    rerender(<ActionPanelHarness pending={false} />);
    await user.click(screen.getByRole('button', { name: 'Close panel' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Edit profile' })).toBeNull());
  });

  it('honors a synchronous save lock without needing a React rerender', async () => {
    const pendingRef = { current: false };
    render(<ActionPanelHarness pendingRef={pendingRef} />);
    await screen.findByRole('dialog', { name: 'Edit profile' });
    fireEvent.click(screen.getByRole('button', { name: 'Begin save' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: 'Close panel' }));
    expect(screen.getByRole('dialog', { name: 'Edit profile' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Finish save' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Edit profile' })).toBeNull());
  });
});

describe('AdminActionPanel shared frame', () => {
  it('submits its associated form from the fixed footer and Enter while retaining native validation', async () => {
    const submit = vi.fn();
    const user = userEvent.setup();
    render(
      <AdminPanelHost>
        <AdminActionPanel
          open
          onOpenChange={() => {}}
          header={{ title: 'Create record' }}
          actions={[
            { id: 'save', label: 'Save record', type: 'submit', formId: 'panel-test-form' },
          ]}
        >
          <form
            id="panel-test-form"
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
          >
            <label htmlFor="panel-test-name">Record name</label>
            <input id="panel-test-name" required />
          </form>
        </AdminActionPanel>
      </AdminPanelHost>,
    );
    await user.click(screen.getByRole('button', { name: 'Save record' }));
    expect(submit).not.toHaveBeenCalled();
    await user.type(screen.getByLabelText('Record name'), 'Record{Enter}');
    expect(submit).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Save record' }));
    expect(submit).toHaveBeenCalledTimes(2);
  });

  it('renders one accessible error and a shared loading state', async () => {
    const view = render(
      <AdminPanelHost>
        <AdminActionPanel
          open
          onOpenChange={() => {}}
          header={{ title: 'Record' }}
          state={{ loading: true }}
          actions={[]}
        >
          Record fields
        </AdminActionPanel>
      </AdminPanelHost>,
    );
    expect(await screen.findByRole('status', { name: 'Loading…' })).toBeTruthy();
    expect(screen.queryByText('Record fields')).toBeNull();
    view.rerender(
      <AdminPanelHost>
        <AdminActionPanel
          open
          onOpenChange={() => {}}
          header={{ title: 'Record' }}
          state={{ error: 'Please retry.' }}
          actions={[]}
        >
          Record fields
        </AdminActionPanel>
      </AdminPanelHost>,
    );
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(screen.getByRole('alert').textContent).toContain('Please retry.');
    expect(screen.getByText('Record fields')).toBeTruthy();
  });
});
