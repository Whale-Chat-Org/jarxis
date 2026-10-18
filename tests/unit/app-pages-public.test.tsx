import { render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  setupStatus: vi.fn(),
  connection: vi.fn(),
  pageGrants: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
  notFound: () => {
    throw new Error('NOT_FOUND');
  },
}));
vi.mock('next/server', () => ({ connection: mocks.connection }));
vi.mock('@/lib/initial-owner-setup', () => ({
  ensureInitialOwnerSetupStatus: mocks.setupStatus,
}));
vi.mock('@/lib/rbac', () => ({ pageGrants: mocks.pageGrants }));
vi.mock('@/components/landing/landing-page', () => ({ LandingPage: () => <p>Landing</p> }));
vi.mock('@/components/auth/owner-setup', () => ({ OwnerSetup: () => <p>Owner setup form</p> }));
vi.mock('@/components/auth/auth', () => ({
  Auth: ({ path }: { path: string }) => <p>Auth view {path}</p>,
}));
vi.mock('@/components/auth/settings/settings', () => ({
  Settings: ({ path }: { path: string }) => <p>Settings view {path}</p>,
}));
vi.mock('@/components/public-chrome', () => ({
  PublicHeader: () => <header>Public header</header>,
  PublicFooter: () => <footer>Public footer</footer>,
}));
vi.mock('@/components/providers', () => ({
  Providers: ({ children }: { children: React.ReactNode }) => (
    <div data-providers="">{children}</div>
  ),
}));
vi.mock('@/components/chat/chat-page', () => ({ ChatPage: () => <p>Chat workspace</p> }));

import AccessDeniedPage from '@/app/access-denied/page';
import AuthLoading from '@/app/auth/[path]/loading';
import AuthPage, { generateStaticParams } from '@/app/auth/[path]/page';
import AuthLayout from '@/app/auth/layout';
import ChatLoading from '@/app/chat/loading';
import ChatRoute, { metadata as chatMetadata } from '@/app/chat/page';
import RootLayout, { metadata as rootMetadata } from '@/app/layout';
import RootLoading from '@/app/loading';
import HomePage from '@/app/page';
import SettingsLoading from '@/app/settings/[path]/loading';
import SettingsPage from '@/app/settings/[path]/page';
import SettingsLayout from '@/app/settings/layout';
import SetupLayout from '@/app/setup/layout';
import SetupLoading from '@/app/setup/loading';
import SetupPage, { metadata as setupMetadata } from '@/app/setup/page';
import { HttpError } from '@/lib/errors';

beforeEach(() => {
  mocks.setupStatus.mockReset();
  mocks.connection.mockReset();
  mocks.pageGrants.mockReset();
});

const params = (path: string) => ({ params: Promise.resolve({ path }) });

describe('home page', () => {
  it('redirects to setup while the first owner is missing', async () => {
    mocks.setupStatus.mockResolvedValue('available');
    await expect(HomePage()).rejects.toThrow('REDIRECT:/setup');
    expect(mocks.connection).toHaveBeenCalled();
  });

  it('renders the landing page once setup is done', async () => {
    mocks.setupStatus.mockResolvedValue('completed');
    render(await HomePage());
    expect(screen.getByText('Landing')).toBeTruthy();
  });
});

describe('root layout and loading', () => {
  it('wraps children in providers inside an English document', () => {
    const html = renderToStaticMarkup(RootLayout({ children: <p>child</p> }) as ReactElement);
    expect(html).toContain('<html lang="en">');
    expect(html).toContain('<div data-providers=""><p>child</p></div>');
    expect(rootMetadata.title).toBe('Jarxis Admin');
  });

  it.each([
    ['root', RootLoading],
    ['chat', ChatLoading],
    ['setup', SetupLoading],
    ['settings', SettingsLoading],
    ['auth', AuthLoading],
  ])('renders the %s loading skeleton', (_name, Loading) => {
    const { container } = render(<Loading />);
    expect(container.querySelector('[data-slot="skeleton"]')).toBeTruthy();
  });

  it('labels the chat skeleton', () => {
    render(<ChatLoading />);
    expect(screen.getByRole('status').textContent).toContain('Loading chat');
  });
});

describe('access denied page', () => {
  it('offers home and sign-out links', () => {
    render(<AccessDeniedPage />);
    expect(
      screen.getByRole('heading', { name: "You don't have access to this page" }),
    ).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Go home' }).getAttribute('href')).toBe('/');
    expect(screen.getByRole('link', { name: 'Sign out' }).getAttribute('href')).toBe(
      '/auth/sign-out',
    );
  });
});

describe('auth pages', () => {
  it('pre-renders every auth view', () => {
    const paths = generateStaticParams().map((entry) => entry.path);
    expect(paths).toContain('sign-in');
    expect(paths).toContain('sign-up');
    expect(paths).toHaveLength(10);
  });

  it('rejects unknown views', async () => {
    await expect(AuthPage(params('nope'))).rejects.toThrow('NOT_FOUND');
  });

  it('sends sign-in to setup while setup is available', async () => {
    mocks.setupStatus.mockResolvedValue('available');
    await expect(AuthPage(params('sign-in'))).rejects.toThrow('REDIRECT:/setup');
    expect(mocks.connection).toHaveBeenCalled();
  });

  it('renders sign-in after setup', async () => {
    mocks.setupStatus.mockResolvedValue('completed');
    render(await AuthPage(params('sign-in')));
    expect(screen.getByText('Auth view sign-in')).toBeTruthy();
  });

  it('renders other views without checking setup', async () => {
    render(await AuthPage(params('sign-up')));
    expect(screen.getByText('Auth view sign-up')).toBeTruthy();
    expect(mocks.setupStatus).not.toHaveBeenCalled();
  });

  it('frames views with the public chrome', () => {
    render(<AuthLayout>inner</AuthLayout>);
    expect(screen.getByText('Public header')).toBeTruthy();
    expect(screen.getByRole('main').textContent).toBe('inner');
    expect(screen.getByText('Public footer')).toBeTruthy();
  });
});

describe('setup pages', () => {
  it.each(['available', 'unknown'])('shows the setup form when status is %s', async (status) => {
    mocks.setupStatus.mockResolvedValue(status);
    render(await SetupPage());
    expect(screen.getByText('Owner setup form')).toBeTruthy();
    expect(mocks.connection).toHaveBeenCalled();
  });

  it('closes the form once an owner exists', async () => {
    mocks.setupStatus.mockResolvedValue('completed');
    render(await SetupPage());
    expect(screen.getByRole('heading', { name: 'Setup already completed' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Go to sign-in' }).getAttribute('href')).toBe(
      '/auth/sign-in',
    );
    expect(setupMetadata.robots).toEqual({ index: false, follow: false });
  });

  it('frames setup with the public chrome', () => {
    render(<SetupLayout>setup body</SetupLayout>);
    expect(screen.getByText('Public header')).toBeTruthy();
    expect(screen.getByRole('main').textContent).toBe('setup body');
  });
});

describe('settings pages', () => {
  it('rejects unknown settings views', async () => {
    await expect(SettingsPage(params('nope'))).rejects.toThrow('NOT_FOUND');
  });

  it('renders a known settings view', async () => {
    render(await SettingsPage(params('security')));
    expect(screen.getByText('Settings view security')).toBeTruthy();
  });

  it('renders the layout for a signed-in account', async () => {
    mocks.pageGrants.mockResolvedValue({ userId: 'u1' });
    render(await SettingsLayout({ children: <p>panel</p> }));
    expect(screen.getByText('panel')).toBeTruthy();
    expect(screen.getByText('Public footer')).toBeTruthy();
  });

  it.each([
    [401, 'REDIRECT:/auth/sign-in'],
    [403, 'REDIRECT:/access-denied'],
  ])('redirects a %s from the grants lookup', async (status, target) => {
    mocks.pageGrants.mockRejectedValue(new HttpError(status, 'X', 'denied'));
    await expect(SettingsLayout({ children: null })).rejects.toThrow(target);
  });

  it('rethrows unexpected failures', async () => {
    mocks.pageGrants.mockRejectedValue(new HttpError(500, 'X', 'boom'));
    await expect(SettingsLayout({ children: null })).rejects.toThrow('boom');
    mocks.pageGrants.mockRejectedValue(new Error('db down'));
    await expect(SettingsLayout({ children: null })).rejects.toThrow('db down');
  });
});

describe('chat route', () => {
  it('renders the chat workspace', () => {
    render(<ChatRoute />);
    expect(screen.getByText('Chat workspace')).toBeTruthy();
    expect(chatMetadata.title).toBe('Chat · Jarxis');
  });
});
