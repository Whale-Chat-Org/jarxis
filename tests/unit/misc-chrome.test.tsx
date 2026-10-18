import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  session: { data: null as unknown, isPending: false },
  userButtonProps: [] as Array<Record<string, unknown>>,
  pageGrants: vi.fn(),
  isMobile: false,
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: React.ComponentProps<'a'> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
vi.mock('@better-auth-ui/react', () => ({
  useAuth: () => ({ authClient: {} }),
  useSession: () => mocks.session,
}));
vi.mock('@/components/header/user/user-button', () => ({
  UserButton: (props: Record<string, unknown>) => {
    mocks.userButtonProps.push(props);
    return <div data-testid="user-button" />;
  },
}));
vi.mock('@/components/header/theme-toggle-item', () => ({
  ThemeToggleItem: () => <div role="menuitem">Theme options</div>,
}));
vi.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => mocks.isMobile }));
vi.mock('@/lib/rbac', () => ({ pageGrants: mocks.pageGrants }));

import { LandingPage } from '@/components/landing/landing-page';
import { AccountNav } from '@/components/header/account-nav';
import { Header } from '@/components/header/header';
import { Footer } from '@/components/footer/footer';
import { ThemeToggle } from '@/components/header/theme-toggle';
import { HttpError } from '@/lib/errors';

beforeEach(() => {
  mocks.session = { data: null, isPending: false };
  mocks.userButtonProps = [];
  mocks.isMobile = false;
  mocks.pageGrants.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AccountNav', () => {
  it('shows a skeleton while the session loads', () => {
    mocks.session = { data: null, isPending: true };
    const { container } = render(<AccountNav canAccessAdmin={false} />);
    expect(container.querySelector('[data-slot="skeleton"]')).toBeTruthy();
  });

  it('shows sign in and sign up links when signed out', () => {
    render(<AccountNav canAccessAdmin={false} />);
    expect(screen.getByRole('link', { name: 'Sign in' }).getAttribute('href')).toBe(
      '/auth/sign-in',
    );
    expect(screen.getByRole('link', { name: 'Sign up' }).getAttribute('href')).toBe(
      '/auth/sign-up',
    );
  });

  it('renders the user button with an admin link when allowed', () => {
    mocks.session = { data: { user: { id: 'u' } }, isPending: false };
    render(<AccountNav canAccessAdmin />);
    expect(screen.getByTestId('user-button')).toBeTruthy();
    const props = mocks.userButtonProps.at(-1)!;
    expect(props.size).toBe('default');
    expect((props.links as Array<{ href: string }>)[0]?.href).toBe('/admin');
  });

  it('uses the icon size on mobile and omits admin links when not allowed', () => {
    mocks.session = { data: { user: { id: 'u' } }, isPending: false };
    mocks.isMobile = true;
    render(<AccountNav canAccessAdmin={false} />);
    const props = mocks.userButtonProps.at(-1)!;
    expect(props.size).toBe('icon');
    expect(props.links).toBeUndefined();
  });
});

describe('ThemeToggle', () => {
  it('opens the theme menu', async () => {
    render(<ThemeToggle />);
    await userEvent.click(screen.getByRole('button', { name: 'Toggle theme' }));
    expect(screen.getByRole('menuitem', { name: 'Theme options' })).toBeTruthy();
  });
});

describe('Header', () => {
  it('passes dashboard access to the account nav', async () => {
    mocks.session = { data: { user: { id: 'u' } }, isPending: false };
    mocks.pageGrants.mockResolvedValue({ permissions: new Set(['dashboard:read']) });
    render(await Header());
    expect(screen.getByRole('link', { name: 'Jarxis home' }).getAttribute('href')).toBe('/');
    expect(screen.getByRole('navigation', { name: 'Account' })).toBeTruthy();
    expect(mocks.userButtonProps.at(-1)?.links).toBeTruthy();
  });

  it.each([401, 403])('treats a %s as no admin access', async (status) => {
    mocks.session = { data: { user: { id: 'u' } }, isPending: false };
    mocks.pageGrants.mockRejectedValue(new HttpError(status, 'denied', 'no'));
    render(await Header());
    expect(mocks.userButtonProps.at(-1)?.links).toBeUndefined();
  });

  it('rethrows unexpected errors', async () => {
    mocks.pageGrants.mockRejectedValue(new HttpError(500, 'boom', 'boom'));
    await expect(Header()).rejects.toThrow('boom');
    mocks.pageGrants.mockRejectedValue(new Error('network'));
    await expect(Header()).rejects.toThrow('network');
  });
});

describe('Footer and LandingPage', () => {
  it('renders the footer with the current year', () => {
    render(<Footer />);
    expect(screen.getByText(`© ${new Date().getFullYear()} Jarxis`)).toBeTruthy();
    expect(screen.getByRole('navigation', { name: 'Footer' })).toBeTruthy();
  });

  it('renders the landing page as its own main, without chrome', () => {
    render(<LandingPage />);
    expect(screen.getByRole('main')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Jarxis' })).toBeTruthy();
    expect(screen.getByText('Content coming soon.')).toBeTruthy();
    expect(screen.queryByRole('contentinfo')).toBeNull();
  });
});
