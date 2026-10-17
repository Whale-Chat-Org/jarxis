'use client';

import * as React from 'react';
import { usePathname } from 'next/navigation';
import { ArrowLeftIcon, XIcon } from 'lucide-react';
import { Dialog as DialogPrimitive, Slot } from 'radix-ui';

import { Button } from '@/components/ui/button';
import { DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { SheetOverlay, SheetPortal } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';

const desktopQuery = '(min-width: 1024px)';
const subscribeDesktop = (notify: () => void) => {
  const query = window.matchMedia(desktopQuery);
  query.addEventListener('change', notify);
  return () => query.removeEventListener('change', notify);
};
const getDesktopSnapshot = () => window.matchMedia(desktopQuery).matches;
const getServerSnapshot = () => false;
const reducedMotionQuery = '(prefers-reduced-motion: reduce)';
const subscribeReducedMotion = (notify: () => void) => {
  const query = window.matchMedia(reducedMotionQuery);
  query.addEventListener('change', notify);
  return () => query.removeEventListener('change', notify);
};
const getReducedMotionSnapshot = () => window.matchMedia(reducedMotionQuery).matches;
const focusableSelector =
  'a[href], button, input:not([type="hidden"]), select, textarea, [tabindex]';
function tabbableElements(root: ParentNode) {
  return Array.from(root.querySelectorAll<HTMLElement>(focusableSelector)).filter(
    (element) =>
      element.tabIndex >= 0 &&
      !element.matches(':disabled') &&
      !element.closest('[inert]') &&
      element.getClientRects().length > 0,
  );
}

type HostState = {
  desktop: boolean;
  container: HTMLDivElement | null;
  panels: string[];
  register: (id: string) => () => void;
};
const HostContext = React.createContext<HostState | null>(null);

/** A single dock beside the admin page; panel contents remain mounted while drilling down. */
export function AdminPanelHost({ children }: { children: React.ReactNode }) {
  const desktop = React.useSyncExternalStore(
    subscribeDesktop,
    getDesktopSnapshot,
    getServerSnapshot,
  );
  const [container, setContainer] = React.useState<HTMLDivElement | null>(null);
  const [panels, setPanels] = React.useState<string[]>([]);
  const register = React.useCallback((id: string) => {
    setPanels((current) => [...current.filter((item) => item !== id), id]);
    return () => setPanels((current) => current.filter((item) => item !== id));
  }, []);
  const value = React.useMemo(
    () => ({ desktop, container, panels, register }),
    [desktop, container, panels, register],
  );

  return (
    <HostContext.Provider value={value}>
      <div
        className="group/admin-workspace flex min-w-none flex-1 items-start"
        data-panel-open={desktop && panels.length > 0}
      >
        <div className="flex min-w-none flex-1 flex-col">{children}</div>
        <aside
          aria-label="Administration panel"
          data-slot="admin-panel-dock"
          aria-hidden={panels.length === 0}
          className={cn(
            'sticky top-none hidden h-svh w-drawer shrink-0 overflow-hidden border-l bg-background admin-dock-motion lg:flex xl:w-drawer-wide',
            panels.length === 0 && 'w-none border-none xl:w-none',
          )}
        >
          <div
            ref={setContainer}
            className="absolute inset-y-none right-none flex h-full w-drawer min-w-none flex-col xl:w-drawer-wide"
          />
        </aside>
      </div>
    </HostContext.Provider>
  );
}

type PanelState = {
  open: boolean;
  closing: boolean;
  active: boolean;
  nested: boolean;
  close: () => void;
  host: HostState;
};
const PanelContext = React.createContext<PanelState | null>(null);
type PanelLayout = 'form' | 'inspector';
const LayoutContext = React.createContext<PanelLayout>('form');

function Dialog({
  open = false,
  onOpenChange,
  children,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Root>) {
  const host = React.useContext(HostContext);
  if (!host) throw new Error('Administration panels require AdminPanelHost');
  const { register, panels, desktop } = host;
  const reducedMotion = React.useSyncExternalStore(
    subscribeReducedMotion,
    getReducedMotionSnapshot,
    getServerSnapshot,
  );
  const [present, setPresent] = React.useState(open);
  if (open && !present) setPresent(true);
  React.useEffect(() => {
    if (open || !present) return;
    // Keep the content mounted for its 150ms exit animation; cancelled by a quick reopen.
    const timeout = window.setTimeout(() => setPresent(false), reducedMotion ? 0 : 180);
    return () => window.clearTimeout(timeout);
  }, [open, present, reducedMotion]);
  const id = React.useId();
  const pathname = usePathname();
  const openedPath = React.useRef(pathname);
  const closeOnNavigation = React.useEffectEvent(() => onOpenChange?.(false));
  React.useEffect(() => {
    if (!open) {
      openedPath.current = pathname;
      return;
    }
    if (openedPath.current !== pathname) {
      closeOnNavigation();
      return;
    }
  }, [open, pathname]);
  React.useEffect(() => {
    if (present) return register(id);
  }, [present, id, register]);

  const active = present && panels.at(-1) === id;
  const close = () => onOpenChange?.(false);
  return (
    <PanelContext.Provider
      value={{ open: present, closing: !open, active, nested: panels.indexOf(id) > 0, close, host }}
    >
      <DialogPrimitive.Root
        {...props}
        open={active && open}
        onOpenChange={onOpenChange}
        modal={!desktop && active}
      >
        {children}
      </DialogPrimitive.Root>
    </PanelContext.Provider>
  );
}

function DialogContent({
  className,
  children,
  layout = 'form',
  showCloseButton = true,
  onOpenAutoFocus,
  onCloseAutoFocus,
  onEscapeKeyDown,
  onInteractOutside,
  onKeyDown,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  layout?: PanelLayout;
  showCloseButton?: boolean;
}) {
  const panel = React.useContext(PanelContext);
  if (!panel) throw new Error('Administration panel content requires Dialog');
  const { open, closing, active, nested, close, host } = panel;
  const content = React.useRef<HTMLDivElement>(null);
  const opener = React.useRef<HTMLElement | null>(null);
  React.useLayoutEffect(() => {
    if (open && !opener.current && document.activeElement instanceof HTMLElement)
      opener.current = document.activeElement;
    if (active) content.current?.focus();
  }, [open, active, host.desktop]);

  if (!open || (host.desktop && !host.container)) return null;
  return (
    <SheetPortal forceMount container={host.desktop ? host.container : undefined}>
      {!host.desktop && active && <SheetOverlay />}
      <DialogPrimitive.Content
        {...props}
        forceMount
        ref={content}
        role={host.desktop ? 'region' : 'dialog'}
        tabIndex={-1}
        hidden={!active}
        inert={!active || closing}
        data-slot="admin-panel"
        data-layout={layout}
        data-mode={host.desktop ? 'docked' : 'sheet'}
        className={cn(
          'flex min-w-none admin-panel-motion flex-col bg-background outline-none',
          host.desktop
            ? 'relative h-full w-full'
            : 'fixed inset-y-none right-none z-50 h-svh w-full border-l shadow-lg sm:max-w-narrow',
          !active && 'hidden',
        )}
        onOpenAutoFocus={(event) => {
          onOpenAutoFocus?.(event);
          // Keep focus inside the newly selected panel without trapping it on desktop.
          if (!event.defaultPrevented) {
            event.preventDefault();
            if (active) content.current?.focus();
          }
        }}
        onCloseAutoFocus={(event) => {
          onCloseAutoFocus?.(event);
          if (!event.defaultPrevented) {
            event.preventDefault();
            if (opener.current?.isConnected) opener.current.focus();
          }
        }}
        onEscapeKeyDown={(event) => {
          if (!active) event.preventDefault();
          else onEscapeKeyDown?.(event);
        }}
        onInteractOutside={(event) => {
          onInteractOutside?.(event);
          // The dock deliberately leaves the directory/table interactive.
          if (host.desktop || !active) event.preventDefault();
        }}
        onKeyDown={(event) => {
          onKeyDown?.(event);
          if (event.defaultPrevented || !host.desktop || !active || event.key !== 'Tab') return;
          const inside = tabbableElements(event.currentTarget);
          const focused = document.activeElement;
          const leaving = event.shiftKey
            ? focused === inside[0] || focused === event.currentTarget
            : focused === inside.at(-1);
          if (!leaving) return;
          // Radix's nonmodal content still loops Tab at its edges. Let the dock join
          // the page's normal keyboard order rather than cycling inside the panel.
          const all = tabbableElements(document);
          const index = all.indexOf(
            focused === event.currentTarget ? inside[0] : (focused as HTMLElement),
          );
          const direction = event.shiftKey ? -1 : 1;
          const next = all[(index + direction + all.length) % all.length];
          if (next && !event.currentTarget.contains(next)) {
            event.preventDefault();
            next.focus();
          }
        }}
      >
        <div className="flex shrink-0 items-center justify-between gap-sm border-b px-lg py-sm">
          {nested ? (
            <Button type="button" variant="ghost" size="sm" onClick={close}>
              <ArrowLeftIcon />
              Back
            </Button>
          ) : (
            <span className="text-caption text-muted-foreground">Details &amp; actions</span>
          )}
          {showCloseButton && (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Close panel"
              onClick={close}
            >
              <XIcon />
            </Button>
          )}
        </div>
        <div
          className={cn(
            'min-h-none min-w-none flex-1',
            layout === 'inspector'
              ? 'flex flex-col overflow-hidden'
              : 'flex flex-col gap-lg overflow-y-auto p-xl [&>form]:min-w-none [&>form]:flex-1',
            className,
          )}
        >
          <LayoutContext.Provider value={layout}>{children}</LayoutContext.Provider>
        </div>
      </DialogPrimitive.Content>
    </SheetPortal>
  );
}

function DialogHeader({ className, ...props }: React.ComponentProps<'div'>) {
  const layout = React.useContext(LayoutContext);
  return (
    <div
      data-slot="admin-panel-header"
      className={cn(
        'flex shrink-0 flex-col gap-sm text-left',
        layout === 'inspector' && 'border-b px-xl py-lg-plus',
        className,
      )}
      {...props}
    />
  );
}

/**
 * Inspector frame: a scrolling body above a fixed action bar. Pass `asChild` to make an existing
 * form element the frame, so its submit button can live in the {@link DialogFooter}.
 */
function DialogForm({
  className,
  asChild = false,
  ...props
}: React.ComponentProps<'form'> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : 'form';
  return (
    <Comp
      data-slot="admin-panel-form"
      className={cn('grid h-full min-h-none flex-1 grid-rows-inspector-form', className)}
      {...props}
    />
  );
}

/** The scrolling part of a {@link DialogForm}. */
function DialogScrollArea({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="admin-panel-scroll-area"
      className={cn('min-h-none overflow-y-auto', className)}
      {...props}
    />
  );
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<'div'> & { showCloseButton?: boolean }) {
  const panel = React.useContext(PanelContext);
  const layout = React.useContext(LayoutContext);
  return (
    <div
      data-slot="admin-panel-footer"
      className={cn(
        layout === 'inspector'
          ? 'flex flex-col-reverse gap-sm border-t bg-muted/50 px-xl py-lg sm:flex-row sm:justify-end'
          : 'sticky bottom-none mt-auto flex shrink-0 flex-wrap items-center justify-end gap-sm border-t bg-background py-lg',
        className,
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <Button type="button" variant="outline" onClick={panel?.close}>
          Close
        </Button>
      )}
    </div>
  );
}

function AlertDialogCancel({ onClick, ...props }: React.ComponentProps<typeof Button>) {
  const panel = React.useContext(PanelContext);
  return (
    <Button
      {...props}
      type={props.type ?? 'button'}
      variant={props.variant ?? 'outline'}
      data-panel-initial-focus
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) panel?.close();
      }}
    />
  );
}

// Confirmation actions intentionally stay open until the owning mutation succeeds.
const AlertDialogAction = Button;
export {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogForm,
  DialogScrollArea,
  DialogTitle,
  DialogDescription,
  Dialog as AlertDialog,
  DialogContent as AlertDialogContent,
  DialogHeader as AlertDialogHeader,
  DialogFooter as AlertDialogFooter,
  DialogTitle as AlertDialogTitle,
  DialogDescription as AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
};
