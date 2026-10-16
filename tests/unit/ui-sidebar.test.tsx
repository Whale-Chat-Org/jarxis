import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInput,
  SidebarInset,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
  SidebarRail,
  SidebarSeparator,
  SidebarTrigger,
  useSidebar,
} from '@/components/ui/sidebar';
import { useIsMobile } from '@/hooks/use-mobile';

type Listener = () => void;

/** Stubs matchMedia so every query reports `matches` and can broadcast a change. */
function stubMatchMedia(initial: boolean) {
  let matches = initial;
  const listeners = new Set<Listener>();
  vi.stubGlobal('matchMedia', (query: string) => ({
    get matches() {
      return matches;
    },
    media: query,
    onchange: null,
    addEventListener: (_: string, listener: Listener) => listeners.add(listener),
    removeEventListener: (_: string, listener: Listener) => listeners.delete(listener),
    addListener() {},
    removeListener() {},
    dispatchEvent: () => false,
  }));
  return {
    set(next: boolean) {
      matches = next;
      act(() => listeners.forEach((listener) => listener()));
    },
    listeners,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.cookie = 'sidebar_state=; max-age=0; path=/';
});

function StateProbe() {
  const { state, open, openMobile, isMobile } = useSidebar();
  return (
    <output data-testid="probe">{JSON.stringify({ state, open, openMobile, isMobile })}</output>
  );
}

const probe = () => JSON.parse(screen.getByTestId('probe').textContent ?? '{}');

function FullSidebar(props: React.ComponentProps<typeof Sidebar>) {
  return (
    <Sidebar {...props}>
      <SidebarHeader>
        <SidebarInput aria-label="Filter" />
      </SidebarHeader>
      <SidebarSeparator />
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Group</SidebarGroupLabel>
          <SidebarGroupLabel asChild>
            <h3>Heading label</h3>
          </SidebarGroupLabel>
          <SidebarGroupAction aria-label="Add" />
          <SidebarGroupAction asChild>
            <a href="/add">Add link</a>
          </SidebarGroupAction>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton isActive tooltip="Home tip" size="lg" variant="outline">
                  Home
                </SidebarMenuButton>
                <SidebarMenuAction showOnHover aria-label="More" />
                <SidebarMenuBadge>3</SidebarMenuBadge>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton tooltip={{ children: 'Obj tip' }}>Settings</SidebarMenuButton>
                <SidebarMenuAction asChild>
                  <a href="/act">Act</a>
                </SidebarMenuAction>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton asChild>
                  <a href="/plain">Plain</a>
                </SidebarMenuButton>
                <SidebarMenuSub>
                  <SidebarMenuSubItem>
                    <SidebarMenuSubButton href="/sub" isActive size="sm">
                      Sub
                    </SidebarMenuSubButton>
                  </SidebarMenuSubItem>
                  <SidebarMenuSubItem>
                    <SidebarMenuSubButton asChild>
                      <button type="button">Sub button</button>
                    </SidebarMenuSubButton>
                  </SidebarMenuSubItem>
                </SidebarMenuSub>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuSkeleton />
                <SidebarMenuSkeleton showIcon />
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>Footer</SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}

describe('useIsMobile', () => {
  it('tracks the media query', () => {
    const media = stubMatchMedia(false);
    const { result, unmount } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);
    media.set(true);
    expect(result.current).toBe(true);
    unmount();
    expect(media.listeners.size).toBe(0);
  });
});

describe('useIsMobile on the server', () => {
  it('reports desktop during server rendering', () => {
    function Probe() {
      return <span>{String(useIsMobile())}</span>;
    }
    stubMatchMedia(true);
    expect(renderToString(<Probe />)).toContain('false');
  });
});

describe('useSidebar', () => {
  it('throws outside a provider', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<StateProbe />)).toThrow(/within a SidebarProvider/);
  });
});

describe('Sidebar on desktop', () => {
  it('renders all parts and toggles via trigger, rail and keyboard', async () => {
    const onTriggerClick = vi.fn();
    const { container } = render(
      <SidebarProvider style={{ color: 'red' }} className="wrap">
        <FullSidebar side="right" variant="floating" collapsible="icon" />
        <SidebarInset>
          <SidebarTrigger onClick={onTriggerClick} />
          <StateProbe />
        </SidebarInset>
      </SidebarProvider>,
    );
    const wrapper = container.querySelector('[data-slot="sidebar-wrapper"]') as HTMLElement;
    expect(wrapper.className).toContain('wrap');
    expect(wrapper.style.color).toBe('red');
    const sidebar = container.querySelector('[data-slot="sidebar"]') as HTMLElement;
    expect(sidebar.getAttribute('data-side')).toBe('right');
    expect(sidebar.getAttribute('data-variant')).toBe('floating');
    expect(sidebar.getAttribute('data-state')).toBe('expanded');
    expect(sidebar.getAttribute('data-collapsible')).toBe('');
    expect(probe()).toMatchObject({ open: true, isMobile: false });

    await userEvent.click(container.querySelector('[data-slot="sidebar-trigger"]') as HTMLElement);
    expect(onTriggerClick).toHaveBeenCalledOnce();
    expect(sidebar.getAttribute('data-state')).toBe('collapsed');
    expect(sidebar.getAttribute('data-collapsible')).toBe('icon');
    expect(document.cookie).toContain('sidebar_state=false');

    fireEvent.click(screen.getByTitle('Toggle Sidebar'));
    expect(probe().state).toBe('expanded');

    fireEvent.keyDown(window, { key: 'b', ctrlKey: true });
    expect(probe().state).toBe('collapsed');
    fireEvent.keyDown(window, { key: 'b', metaKey: true });
    expect(probe().state).toBe('expanded');
    fireEvent.keyDown(window, { key: 'b' });
    expect(probe().state).toBe('expanded');

    expect(container.querySelectorAll('[data-sidebar="menu-skeleton-icon"]').length).toBe(1);
    expect(screen.getByText('Sub').getAttribute('data-active')).toBe('true');
    expect(screen.getByText('Sub').getAttribute('data-size')).toBe('sm');
    expect(screen.getByRole('button', { name: 'Sub button' }).getAttribute('data-size')).toBe('md');
    expect(screen.getByRole('link', { name: 'Plain' }).getAttribute('data-sidebar')).toBe(
      'menu-button',
    );
    expect(screen.getByRole('heading', { name: 'Heading label' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Add link' }).getAttribute('data-sidebar')).toBe(
      'group-action',
    );
    expect(screen.getByRole('link', { name: 'Act' }).getAttribute('data-sidebar')).toBe(
      'menu-action',
    );
  });

  it('shows tooltips only when collapsed', async () => {
    render(
      <SidebarProvider defaultOpen={false}>
        <FullSidebar collapsible="icon" variant="inset" />
      </SidebarProvider>,
    );
    await userEvent.hover(screen.getByRole('button', { name: 'Home' }));
    expect((await screen.findByRole('tooltip')).textContent).toContain('Home tip');
  });

  it('supports controlled open state', async () => {
    const onOpenChange = vi.fn();
    const { rerender } = render(
      <SidebarProvider open onOpenChange={onOpenChange}>
        <Sidebar />
        <SidebarTrigger />
        <StateProbe />
      </SidebarProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Toggle Sidebar' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(probe().open).toBe(true);
    rerender(
      <SidebarProvider open={false} onOpenChange={onOpenChange}>
        <Sidebar />
        <StateProbe />
      </SidebarProvider>,
    );
    expect(probe().state).toBe('collapsed');
  });

  it('renders a non-collapsible sidebar', () => {
    const { container } = render(
      <SidebarProvider>
        <Sidebar collapsible="none" className="fixed-sidebar">
          Static
        </Sidebar>
      </SidebarProvider>,
    );
    const sidebar = container.querySelector('[data-slot="sidebar"]') as HTMLElement;
    expect(sidebar.className).toContain('fixed-sidebar');
    expect(sidebar.textContent).toBe('Static');
  });
});

describe('Sidebar on mobile', () => {
  it('renders inside a sheet that the trigger opens', async () => {
    stubMatchMedia(true);
    render(
      <SidebarProvider>
        <FullSidebar side="left" />
        <SidebarTrigger />
        <StateProbe />
      </SidebarProvider>,
    );
    expect(probe().isMobile).toBe(true);
    expect(screen.queryByRole('dialog')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Toggle Sidebar' }));
    const dialog = await screen.findByRole('dialog', { name: 'Sidebar' });
    expect(dialog.getAttribute('data-mobile')).toBe('true');
    expect(probe().openMobile).toBe(true);
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});
