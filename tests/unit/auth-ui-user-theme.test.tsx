import { localization } from '@better-auth-ui/core';
import { themeLocalization } from '@better-auth-ui/core/plugins/theme';
import { QueryClient } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type ReactNode, useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthProvider } from '@/components/auth/provider/auth-provider';
import { Appearance } from '@/components/settings/account/appearance';
import { UserAvatar } from '@/components/header/user/user-avatar';
import { UserButton } from '@/components/header/user/user-button';
import { UserView } from '@/components/header/user/user-view';
import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { themePlugin } from '@/lib/auth/theme-plugin';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));

function TestLink({ href, children }: { href: string; children?: ReactNode }) {
  return <a href={href}>{children}</a>;
}

const sessionUser = {
  id: 'user-1',
  name: 'Test User',
  email: 'test.user@example.test',
  emailVerified: true,
  image: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function makeClient(
  session: unknown = {
    session: { id: 's-1', token: 'fake-token', userId: 'user-1' },
    user: sessionUser,
  },
) {
  return {
    getSession: vi.fn(async () => session),
    multiSession: { setActive: vi.fn() },
  };
}

function renderWithAuth(
  ui: ReactNode,
  client: object = makeClient(),
  options: Record<string, unknown> = {},
) {
  const navigate = vi.fn();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <AuthProvider
      authClient={client as never}
      navigate={navigate}
      Link={TestLink}
      queryClient={queryClient}
      {...(options as object)}
    >
      {ui}
    </AuthProvider>,
  );
  return { navigate, view };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('UserAvatar', () => {
  it('shows a skeleton while the session loads', () => {
    const { view } = renderWithAuth(<UserAvatar className="avatar" />, {
      getSession: () => new Promise(() => undefined),
    });
    expect(view.container.querySelector('[data-slot="skeleton"].avatar')).toBeTruthy();
  });

  it('shows a skeleton when explicitly pending', () => {
    const { view } = renderWithAuth(<UserAvatar isPending />);
    expect(view.container.querySelector('[data-slot="skeleton"]')).toBeTruthy();
  });

  it('derives initials from the session user', async () => {
    renderWithAuth(<UserAvatar />);
    expect(await screen.findByText('TE')).toBeTruthy();
  });

  it('prefers a username, then a custom fallback, for an explicit user', () => {
    const { view } = renderWithAuth(<UserAvatar user={{ ...sessionUser, username: 'zed' }} />);
    expect(screen.getByText('ZE')).toBeTruthy();
    view.unmount();

    renderWithAuth(<UserAvatar user={sessionUser} fallback={<span>FB</span>} />);
    expect(screen.getByText('FB')).toBeTruthy();
  });

  it('shows an icon when the user has no identifying text', async () => {
    const { view } = renderWithAuth(<UserAvatar />, makeClient(null));
    await waitFor(() =>
      expect(view.container.querySelector('[data-slot="avatar-fallback"] svg')).toBeTruthy(),
    );
  });
});

describe('UserView', () => {
  it('shows the session user name and email', async () => {
    renderWithAuth(<UserView />);
    expect(await screen.findByText('Test User')).toBeTruthy();
    expect(screen.getByText('test.user@example.test')).toBeTruthy();
  });

  it('prefers the display username and can hide the subtitle', () => {
    renderWithAuth(<UserView user={{ ...sessionUser, displayUsername: 'Zed' }} hideSubtitle />);
    expect(screen.getByText('Zed')).toBeTruthy();
    expect(screen.queryByText('test.user@example.test')).toBeNull();
  });

  it('shows only the email when there is no name', () => {
    renderWithAuth(<UserView user={{ email: 'only.email@example.test' }} />);
    expect(screen.getAllByText('only.email@example.test')).toHaveLength(1);
  });

  it('renders skeletons while pending', () => {
    const { view } = renderWithAuth(<UserView isPending hideSubtitle />);
    expect(view.container.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(2);
    view.unmount();

    const second = renderWithAuth(<UserView isPending />);
    expect(second.view.container.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(3);
  });
});

describe('UserButton', () => {
  it('offers sign-in and sign-up when signed out', async () => {
    const user = userEvent.setup();
    const { navigate } = renderWithAuth(
      <UserButton
        links={[
          { label: 'Docs', href: '/docs' },
          { label: 'Members only', href: '/members', visibility: 'authenticated' },
          { label: 'Join', href: '/join', visibility: 'unauthenticated' },
        ]}
      />,
      makeClient(null),
    );

    const trigger = await screen.findByRole('button', {
      name: new RegExp(localization.auth.account),
    });
    await user.click(trigger);

    expect(screen.queryByRole('menuitem', { name: 'Members only' })).toBeNull();
    await user.click(screen.getByRole('menuitem', { name: 'Join' }));
    expect(navigate).toHaveBeenCalledWith({ to: '/join' });

    await user.click(trigger);
    await user.click(screen.getByRole('menuitem', { name: localization.auth.signIn }));
    expect(navigate).toHaveBeenCalledWith({ to: '/auth/sign-in' });

    await user.click(trigger);
    expect(screen.getByRole('menuitem', { name: 'Docs' })).toBeTruthy();
    await user.click(screen.getByRole('menuitem', { name: localization.auth.signUp }));
    expect(navigate).toHaveBeenCalledWith({ to: '/auth/sign-up' });
  });

  it('shows the user, settings, custom links and sign-out when signed in', async () => {
    const user = userEvent.setup();
    const { navigate } = renderWithAuth(
      <UserButton
        links={[
          {
            label: 'Members only',
            href: '/members',
            visibility: 'authenticated',
            icon: <span>*</span>,
            variant: 'destructive',
          },
          { label: 'Join', href: '/join', visibility: 'unauthenticated' },
          <DropdownMenuItem key="custom">Custom element</DropdownMenuItem>,
        ]}
      />,
    );

    const trigger = await screen.findByRole('button', { name: /Test User/ });
    await user.click(trigger);

    const menu = await screen.findByRole('menu');
    expect(within(menu).getByText('test.user@example.test')).toBeTruthy();
    expect(within(menu).queryByRole('menuitem', { name: 'Join' })).toBeNull();
    expect(within(menu).getByRole('menuitem', { name: 'Custom element' })).toBeTruthy();
    expect(menu.querySelectorAll('[role="separator"]')).toHaveLength(2);

    await user.click(within(menu).getByRole('menuitem', { name: /Members only/ }));
    expect(navigate).toHaveBeenCalledWith({ to: '/members' });

    await user.click(trigger);
    await user.click(screen.getByRole('menuitem', { name: localization.settings.settings }));
    expect(navigate).toHaveBeenCalledWith({ to: '/settings/account' });

    await user.click(trigger);
    await user.click(screen.getByRole('menuitem', { name: localization.auth.signOut }));
    expect(navigate).toHaveBeenCalledWith({ to: '/auth/sign-out' });
  });

  it('drops the leading separator when nothing sits between the label and sign-out', async () => {
    const user = userEvent.setup();
    renderWithAuth(<UserButton hideSettings size="icon" className="round" />);

    const trigger = screen.getByRole('button', { name: localization.auth.account });
    expect(trigger.className).toContain('round');
    await waitFor(() => expect(screen.getByText('TE')).toBeTruthy());
    await user.click(trigger);

    const menu = await screen.findByRole('menu');
    expect(
      within(menu).queryByRole('menuitem', { name: localization.settings.settings }),
    ).toBeNull();
    expect(menu.querySelectorAll('[role="separator"]')).toHaveLength(1);
  });
});

function ThemeHarness({
  initial = 'light',
  themes,
  onSet,
}: {
  initial?: string;
  themes?: string[];
  onSet: (theme: string) => void;
}) {
  const [theme, setTheme] = useState(initial);
  const queryClient = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: false } } }),
  )[0];
  return (
    <AuthProvider
      authClient={makeClient() as never}
      navigate={vi.fn()}
      Link={TestLink}
      queryClient={queryClient}
      plugins={[
        themePlugin({
          theme,
          themes,
          setTheme: (next) => {
            onSet(next);
            setTheme(next);
          },
        }),
      ]}
    >
      <UserButton />
      <Appearance className="appearance" />
    </AuthProvider>
  );
}

describe('Theme controls', () => {
  it('switches the theme from the user menu', async () => {
    const user = userEvent.setup();
    const onSet = vi.fn();
    render(<ThemeHarness onSet={onSet} />);

    await user.click(await screen.findByRole('button', { name: /Test User/ }));
    const menu = await screen.findByRole('menu');
    expect(within(menu).getByText(themeLocalization.theme)).toBeTruthy();

    const lightTab = within(menu).getByRole('tab', { name: themeLocalization.light });
    expect(lightTab.getAttribute('data-state')).toBe('active');
    await user.click(within(menu).getByRole('tab', { name: themeLocalization.dark }));

    expect(onSet).toHaveBeenCalledWith('dark');
    expect(
      within(menu).getByRole('tab', { name: themeLocalization.dark }).getAttribute('data-state'),
    ).toBe('active');
    // Selecting a theme keeps the menu open.
    expect(screen.getByRole('menu')).toBeTruthy();
  });

  it('moves focus between the theme tabs and the surrounding menu items', async () => {
    const user = userEvent.setup();
    render(<ThemeHarness onSet={vi.fn()} />);

    await user.click(await screen.findByRole('button', { name: /Test User/ }));
    const menu = await screen.findByRole('menu');
    const themeItem = within(menu)
      .getByText(themeLocalization.theme)
      .closest('[role="menuitem"]') as HTMLElement;

    themeItem.focus();
    await waitFor(() =>
      expect(document.activeElement?.getAttribute('aria-label')).toBe(themeLocalization.light),
    );

    await user.keyboard('{Enter}');
    expect(screen.getByRole('menu')).toBeTruthy();

    (within(menu).getByRole('tab', { name: themeLocalization.light }) as HTMLElement).focus();
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement?.textContent).toContain(localization.auth.signOut);

    (within(menu).getByRole('tab', { name: themeLocalization.light }) as HTMLElement).focus();
    await user.keyboard('{ArrowUp}');
    expect(document.activeElement?.textContent).toContain(localization.settings.settings);
  });

  it('switches the theme from the appearance card', async () => {
    const user = userEvent.setup();
    const onSet = vi.fn();
    const { container } = render(<ThemeHarness onSet={onSet} />);

    expect(screen.getByText(themeLocalization.appearance)).toBeTruthy();
    expect(container.querySelector('.appearance')).toBeTruthy();
    const light = screen.getByRole('radio', { name: new RegExp(themeLocalization.light) });
    await waitFor(() => expect(light.getAttribute('aria-checked')).toBe('true'));

    await user.click(screen.getByRole('radio', { name: new RegExp(themeLocalization.system) }));
    expect(onSet).toHaveBeenCalledWith('system');
  });

  it('only offers the configured themes', async () => {
    const user = userEvent.setup();
    render(<ThemeHarness onSet={vi.fn()} themes={['dark']} initial="dark" />);

    expect(screen.queryByRole('radio', { name: new RegExp(themeLocalization.system) })).toBeNull();
    expect(screen.getByRole('radio', { name: new RegExp(themeLocalization.dark) })).toBeTruthy();

    await user.click(await screen.findByRole('button', { name: /Test User/ }));
    const menu = await screen.findByRole('menu');
    expect(within(menu).getAllByRole('tab')).toHaveLength(1);
  });

  it('disables the appearance choices until a theme is known', () => {
    render(<ThemeHarness onSet={vi.fn()} initial="" />);

    const radios = screen.getAllByRole('radio') as HTMLButtonElement[];
    expect(radios.every((radio) => radio.disabled)).toBe(true);
  });
});
