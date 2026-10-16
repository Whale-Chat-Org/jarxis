import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const navigation = vi.hoisted(() => ({ pathname: '/admin' }));
vi.mock('next/navigation', () => ({ usePathname: () => navigation.pathname }));

import {
  AlertDialogAction,
  AlertDialogCancel,
  AdminPanelHost,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/admin-panel';

function stubMedia({ desktop, reducedMotion }: { desktop: boolean; reducedMotion: boolean }) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('min-width') ? desktop : reducedMotion,
    media: query,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => false,
  }));
}

beforeEach(() => {
  navigation.pathname = '/admin';
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

type PanelProps = {
  title: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  layout?: 'form' | 'inspector';
  showCloseButton?: boolean;
  children?: React.ReactNode;
  contentProps?: Partial<React.ComponentProps<typeof DialogContent>>;
};

function Panel({
  title,
  open,
  onOpenChange,
  layout,
  showCloseButton,
  children,
  contentProps,
}: PanelProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent layout={layout} showCloseButton={showCloseButton} {...contentProps}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{title} description</DialogDescription>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}

function Harness({
  initial = true,
  onChange,
  children,
  ...rest
}: Omit<PanelProps, 'open' | 'onOpenChange' | 'title'> & {
  initial?: boolean;
  onChange?: (open: boolean) => void;
}) {
  const [open, setOpen] = React.useState(initial);
  return (
    <AdminPanelHost>
      <button type="button" onClick={() => setOpen(true)}>
        Opener
      </button>
      <Panel
        title="Details"
        open={open}
        onOpenChange={(next) => {
          onChange?.(next);
          setOpen(next);
        }}
        {...rest}
      >
        {children}
      </Panel>
      <button type="button">After</button>
    </AdminPanelHost>
  );
}

describe('admin panel guards', () => {
  it('requires a host and a dialog', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    stubMedia({ desktop: false, reducedMotion: true });
    expect(() => render(<Dialog />)).toThrow(/AdminPanelHost/);
    expect(() =>
      render(
        <AdminPanelHost>
          <DialogContent />
        </AdminPanelHost>,
      ),
    ).toThrow(/requires Dialog/);
  });
});

describe('admin panel as a mobile sheet', () => {
  beforeEach(() => stubMedia({ desktop: false, reducedMotion: true }));

  it('opens as a modal dialog and closes from the X button', async () => {
    const onChange = vi.fn();
    render(
      <Harness onChange={onChange}>
        <DialogFooter showCloseButton>
          <AlertDialogAction>Save</AlertDialogAction>
        </DialogFooter>
      </Harness>,
    );
    const dialog = await screen.findByRole('dialog', { name: 'Details' });
    expect(dialog.getAttribute('data-mode')).toBe('sheet');
    expect(dialog.getAttribute('data-layout')).toBe('form');
    expect(document.querySelector('[data-slot="sheet-overlay"]')).toBeTruthy();
    expect(screen.getByText('Details & actions')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Close panel' }));
    expect(onChange).toHaveBeenCalledWith(false);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('closes from the footer close button and Escape', async () => {
    const onChange = vi.fn();
    render(
      <Harness onChange={onChange} showCloseButton={false}>
        <DialogFooter showCloseButton />
      </Harness>,
    );
    expect(screen.queryByRole('button', { name: 'Close panel' })).toBeNull();
    await userEvent.click(await screen.findByRole('button', { name: 'Close' }));
    expect(onChange).toHaveBeenLastCalledWith(false);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    fireEvent.click(screen.getByRole('button', { name: 'Opener' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('cancel closes unless the click handler prevents it', async () => {
    const onChange = vi.fn();
    const prevent = vi.fn((event: React.MouseEvent) => event.preventDefault());
    render(
      <Harness onChange={onChange}>
        <AlertDialogCancel onClick={prevent}>Keep</AlertDialogCancel>
        <AlertDialogCancel type="submit" variant="ghost">
          Cancel
        </AlertDialogCancel>
      </Harness>,
    );
    const keep = await screen.findByRole('button', { name: 'Keep' });
    expect(keep.getAttribute('type')).toBe('button');
    expect(keep.getAttribute('data-variant')).toBe('outline');
    await userEvent.click(keep);
    expect(prevent).toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    expect(cancel.getAttribute('type')).toBe('submit');
    expect(cancel.getAttribute('data-variant')).toBe('ghost');
    await userEvent.click(cancel);
    expect(onChange).toHaveBeenCalledWith(false);
  });

  it('closes when the route changes while open', async () => {
    const onChange = vi.fn();
    const { rerender } = render(<Harness onChange={onChange} />);
    await screen.findByRole('dialog');
    navigation.pathname = '/admin/other';
    rerender(<Harness onChange={onChange} />);
    expect(onChange).toHaveBeenCalledWith(false);
  });

  it('stacks nested panels with a back button', async () => {
    function Nested() {
      const [outer, setOuter] = React.useState(true);
      const [inner, setInner] = React.useState(false);
      return (
        <AdminPanelHost>
          <Panel title="Outer" open={outer} onOpenChange={setOuter} layout="inspector">
            <button type="button" onClick={() => setInner(true)}>
              Drill
            </button>
          </Panel>
          <Panel title="Inner" open={inner} onOpenChange={setInner} />
        </AdminPanelHost>
      );
    }
    render(<Nested />);
    const outer = await screen.findByRole('dialog', { name: 'Outer' });
    expect(outer.getAttribute('data-layout')).toBe('inspector');
    await userEvent.click(screen.getByRole('button', { name: 'Drill' }));
    const inner = await screen.findByRole('dialog', { name: 'Inner' });
    const panels = document.querySelectorAll<HTMLElement>('[data-slot="admin-panel"]');
    expect(panels.length).toBe(2);
    expect(panels[0]?.hasAttribute('hidden')).toBe(true);
    await userEvent.click(within(inner).getByRole('button', { name: 'Back' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Inner' })).toBeNull());
    await waitFor(() =>
      expect(screen.getByRole('dialog', { name: 'Outer' }).hasAttribute('hidden')).toBe(false),
    );
  });
});

describe('admin panel docked on desktop', () => {
  beforeEach(() => stubMedia({ desktop: true, reducedMotion: false }));

  it('renders in the dock as a region and keeps the exit animation briefly', async () => {
    vi.useFakeTimers();
    try {
      const onChange = vi.fn();
      const { container } = render(<Harness onChange={onChange} />);
      await act(async () => {});
      const region = screen.getByRole('region', { name: 'Details' });
      expect(region.getAttribute('data-mode')).toBe('docked');
      const dock = container.querySelector('[data-slot="admin-panel-dock"]') as HTMLElement;
      expect(dock.contains(region)).toBe(true);
      expect(dock.getAttribute('aria-hidden')).toBe('false');
      expect(container.firstElementChild?.getAttribute('data-panel-open')).toBe('true');
      expect(document.querySelector('[data-slot="sheet-overlay"]')).toBeNull();

      fireEvent.click(screen.getByRole('button', { name: 'Close panel' }));
      expect(onChange).toHaveBeenCalledWith(false);
      // Still mounted (inert) during the exit animation.
      expect(container.querySelector('[data-slot="admin-panel"]')).toBeTruthy();
      await act(async () => {
        vi.advanceTimersByTime(200);
      });
      expect(container.querySelector('[data-slot="admin-panel"]')).toBeNull();
      expect(dock.getAttribute('aria-hidden')).toBe('true');
    } finally {
      vi.useRealTimers();
    }
  });

  it('lets Tab leave the dock into the page order', async () => {
    vi.spyOn(Element.prototype, 'getClientRects').mockReturnValue([{}] as unknown as DOMRectList);
    const onKeyDown = vi.fn();
    render(
      <Harness contentProps={{ onKeyDown }}>
        <input aria-label="First field" />
        <input aria-label="Last field" />
      </Harness>,
    );
    const region = await screen.findByRole('region', { name: 'Details' });
    const last = screen.getByRole('textbox', { name: 'Last field' });
    last.focus();
    fireEvent.keyDown(last, { key: 'Tab' });
    expect(onKeyDown).toHaveBeenCalled();
    // Focus moves to the next tabbable outside the dock (wrapping to the page start).
    expect(region.contains(document.activeElement)).toBe(false);

    // Shift+Tab from the content itself moves backwards out of the panel.
    region.focus();
    fireEvent.keyDown(region, { key: 'Tab', shiftKey: true });
    expect(region.contains(document.activeElement)).toBe(false);

    // Tab from the middle stays with the browser default.
    const first = screen.getByRole('textbox', { name: 'First field' });
    first.focus();
    fireEvent.keyDown(first, { key: 'Tab' });
    expect(document.activeElement).toBe(first);

    // Other keys are ignored.
    fireEvent.keyDown(last, { key: 'Enter' });
  });

  it('ignores Tab handling when the handler prevents default', async () => {
    render(
      <Harness contentProps={{ onKeyDown: (event) => event.preventDefault() }}>
        <input aria-label="Only" />
      </Harness>,
    );
    vi.spyOn(Element.prototype, 'getClientRects').mockReturnValue([{}] as unknown as DOMRectList);
    const region = await screen.findByRole('region');
    const input = screen.getByRole('textbox', { name: 'Only' });
    input.focus();
    fireEvent.keyDown(input, { key: 'Tab' });
    // The dock logic is skipped, so focus never leaves the panel.
    expect(region.contains(document.activeElement)).toBe(true);
  });

  it('does not close on outside interaction', async () => {
    const onChange = vi.fn();
    const onInteractOutside = vi.fn();
    render(<Harness onChange={onChange} contentProps={{ onInteractOutside }} />);
    await screen.findByRole('region');
    fireEvent.pointerDown(screen.getByRole('button', { name: 'After' }));
    fireEvent.focusIn(screen.getByRole('button', { name: 'After' }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('returns focus to the opener after closing', async () => {
    render(<Harness initial={false} />);
    const opener = screen.getByRole('button', { name: 'Opener' });
    opener.focus();
    await userEvent.click(opener);
    const region = await screen.findByRole('region');
    expect(document.activeElement).toBe(region);
    await userEvent.click(screen.getByRole('button', { name: 'Close panel' }));
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });
});
