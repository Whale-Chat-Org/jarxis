import { authMutationKeys, localization } from '@better-auth-ui/core';
import { oneTapMutationKeys } from '@better-auth-ui/core/plugins/one-tap';
import { useAuth } from '@better-auth-ui/react';
import {
  MutationCache,
  QueryCache,
  QueryClient,
  useMutation,
  useQuery,
} from '@tanstack/react-query';
import { render, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useIsHydrated } from '@/hooks/use-is-hydrated';
import { createTestQueryClient } from '../helpers/query-client';

import { Auth } from '@/components/auth/auth';
import { AuthProvider } from '@/components/auth/provider/auth-provider';
import { AuthRedirect } from '@/components/auth/views/auth-redirect';
import { AuthCallback, AuthError } from '@/components/auth/views/auth-result';
import {
  ReauthenticationAction,
  ReauthenticationNotice,
} from '@/components/auth/shared/reauthentication';
import { SignOut } from '@/components/auth/views/sign-out';

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }));
vi.mock('sonner', () => ({ toast: toastMock }));

const redirectSpy = vi.hoisted(() => ({
  calls: [] as { args: unknown[]; result: { to: string } }[],
}));
vi.mock('@better-auth-ui/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@better-auth-ui/core')>();
  return {
    ...actual,
    getAuthRedirectAction: (...args: Parameters<typeof actual.getAuthRedirectAction>) => {
      const result = actual.getAuthRedirectAction(...args);
      redirectSpy.calls.push({ args, result });
      return result;
    },
  };
});

function TestLink({
  href,
  children,
  className,
}: {
  href: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <a href={href} className={className}>
      {children}
    </a>
  );
}

const fakeSession = {
  session: { id: 'session-1', token: 'fake-session-token', userId: 'user-1' },
  user: { id: 'user-1', name: 'Test User', email: 'test.user@example.test', image: null },
};

function authError(status: number, code: string) {
  return Object.assign(new Error(code), {
    status,
    statusText: code,
    error: { code, message: code },
  });
}

function makeClient(overrides: Record<string, unknown> = {}) {
  return {
    getSession: vi.fn(async () => null),
    signOut: vi.fn(async () => ({ success: true })),
    ...overrides,
  };
}

function makeQueryClient(config: ConstructorParameters<typeof QueryClient>[0] = {}) {
  return createTestQueryClient(config);
}

function renderWithAuth(
  ui: ReactNode,
  client: object = makeClient(),
  options: Record<string, unknown> = {},
  queryClient = makeQueryClient(),
) {
  const navigate = vi.fn();
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
  return { navigate, view, queryClient };
}

beforeEach(() => {
  vi.clearAllMocks();
  redirectSpy.calls = [];
  sessionStorage.clear();
});

afterEach(() => {
  window.history.replaceState(null, '', '/');
});

describe('Auth view router', () => {
  it('requires a view or a path', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => renderWithAuth(<Auth />)).toThrow('Either `view` or `path` must be provided');
    consoleSpy.mockRestore();
  });

  it('rejects an unknown path', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => renderWithAuth(<Auth path="nowhere" />)).toThrow('Unknown view "undefined"');
    consoleSpy.mockRestore();
  });

  it('resolves built-in views from their path', () => {
    const { view } = renderWithAuth(<Auth path="sign-in" />);
    expect(screen.getByRole('button', { name: localization.auth.signIn })).toBeTruthy();
    view.unmount();

    renderWithAuth(<Auth path="forgot-password" />);
    expect(screen.getByRole('button', { name: localization.auth.sendResetLink })).toBeTruthy();
  });

  it.each([
    ['signUp', localization.auth.signUp],
    ['resetLinkSent', localization.auth.checkYourEmailTitle],
    ['verifyEmail', localization.auth.checkYourEmail],
    ['callback', localization.auth.callbackGenericSuccessTitle],
    ['error', localization.auth.callbackGenericErrorTitle],
  ] as const)('renders the %s view', (view, text) => {
    renderWithAuth(<Auth view={view} />);
    expect(screen.getAllByText(text).length).toBeGreaterThan(0);
  });

  it('redirects password-only views to sign-in when password auth is off', async () => {
    const { navigate, view } = renderWithAuth(<Auth view="signUp" />, makeClient(), {
      emailAndPassword: { enabled: false },
    });

    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith({ to: '/auth/sign-in', replace: true }),
    );
    expect(view.container.textContent).toBe('');
  });

  it('prefers plugin view overrides, including plugin-introduced paths', () => {
    const plugins = [
      { id: 'no-views' },
      {
        id: 'fake-magic',
        viewPaths: { auth: { magicLink: 'magic-link' } },
        views: {
          auth: {
            signIn: ({ className }: { className?: string }) => (
              <p className={className}>Plugin sign in</p>
            ),
            magicLink: () => <p>Magic link view</p>,
          },
        },
      },
    ];
    const { view } = renderWithAuth(<Auth view="signIn" className="custom" />, makeClient(), {
      plugins,
    });
    expect(screen.getByText('Plugin sign in').className).toBe('custom');
    view.unmount();

    renderWithAuth(<Auth path="magic-link" />, makeClient(), { plugins });
    expect(screen.getByText('Magic link view')).toBeTruthy();
  });

  it('falls back to a plugin sign-in view when password auth is off', () => {
    renderWithAuth(<Auth view="signIn" />, makeClient(), {
      emailAndPassword: { enabled: false },
      plugins: [
        { id: 'fake-fallback', fallbackViews: { auth: { signIn: () => <p>Passwordless</p> } } },
      ],
    });

    expect(screen.getByText('Passwordless')).toBeTruthy();
  });

  it('renders the built-in sign-in when password auth is off and no fallback exists', () => {
    renderWithAuth(<Auth view="signIn" />, makeClient(), { emailAndPassword: { enabled: false } });
    expect(screen.queryByLabelText(localization.auth.email)).toBeNull();
    expect(screen.getByText(localization.auth.signIn)).toBeTruthy();
  });
});

describe('Auth result views', () => {
  it.each([
    [
      '?error=account_not_linked',
      localization.auth.callbackViewAccountSettings,
      '/settings/security',
      'text-destructive',
    ],
    [
      '?result=verified&redirectTo=/projects',
      localization.auth.callbackContinue,
      '/projects',
      'text-primary',
    ],
    [
      '?error=invalid_token&flow=password_reset',
      localization.auth.forgotPassword,
      '/auth/forgot-password',
      'text-destructive',
    ],
    [
      '?error=email_not_verified',
      localization.auth.verifyEmail,
      '/auth/verify-email',
      'text-warning',
    ],
    ['?result=success', localization.auth.signIn, '/auth/sign-in', 'text-primary'],
  ])('callback %s offers %s', async (search, label, target, iconClass) => {
    window.history.replaceState(null, '', `/auth/callback${search}`);
    const user = userEvent.setup();
    const { navigate, view } = renderWithAuth(<AuthCallback className="result" />);

    const button = await screen.findByRole('button', { name: label });
    expect(view.container.querySelector('svg')?.getAttribute('class')).toContain(iconClass);
    await user.click(button);
    expect(navigate).toHaveBeenCalledWith({ to: target });
  });

  it('AuthError defaults to a danger result', () => {
    const { view } = renderWithAuth(<AuthError />);

    expect(screen.getByText(localization.auth.callbackGenericErrorTitle)).toBeTruthy();
    expect(view.container.querySelector('svg')?.getAttribute('class')).toContain(
      'text-destructive',
    );
  });
});

describe('AuthRedirect', () => {
  it('sends a signed-out visitor through sign-in exactly once', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    window.history.replaceState(null, '', '/auth/redirect?redirectTo=%2Fapi%2Fexport');
    const client = makeClient();
    const { view } = renderWithAuth(<AuthRedirect className="spin" />, client);

    expect(view.container.querySelector('.spin')).toBeTruthy();
    await waitFor(() => expect(redirectSpy.calls).toHaveLength(1));
    expect(redirectSpy.calls[0].args[1]).toBe(false);
    expect(redirectSpy.calls[0].args[2]).toBe('/auth/sign-in');
    expect(redirectSpy.calls[0].result.to).toBe(
      '/auth/sign-in?redirectTo=%2Fauth%2Fredirect%3FredirectTo%3D%252Fapi%252Fexport',
    );
    consoleSpy.mockRestore();
  });

  it('sends a signed-in user to the validated target', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    window.history.replaceState(null, '', '/auth/redirect?redirectTo=%2Fapi%2Fexport');
    renderWithAuth(<AuthRedirect />, makeClient({ getSession: vi.fn(async () => fakeSession) }));

    await waitFor(() => expect(redirectSpy.calls).toHaveLength(1));
    expect(redirectSpy.calls[0].args[1]).toBe(true);
    expect(redirectSpy.calls[0].result.to).toBe('/api/export');
    consoleSpy.mockRestore();
  });
});

describe('SignOut', () => {
  it('signs out on mount and navigates to sign-in', async () => {
    const client = makeClient();
    const { navigate } = renderWithAuth(<SignOut />, client);

    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith({ to: '/auth/sign-in', replace: true }),
    );
    expect(client.signOut).toHaveBeenCalledTimes(1);
  });

  it('offers a retry when signing out fails', async () => {
    const user = userEvent.setup();
    const signOut = vi
      .fn()
      .mockRejectedValueOnce(authError(500, 'INTERNAL'))
      .mockResolvedValueOnce({ success: true });
    const { navigate } = renderWithAuth(<SignOut className="retry" />, makeClient({ signOut }));

    const retry = await screen.findByRole('button', { name: 'Try signing out again' });
    expect(retry.className).toContain('retry');
    await user.click(retry);

    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith({ to: '/auth/sign-in', replace: true }),
    );
    expect(signOut).toHaveBeenCalledTimes(2);
  });
});

describe('ReauthenticationAction', () => {
  it('signs out and returns to a reauthentication sign-in URL', async () => {
    window.history.replaceState(null, '', '/settings/security');
    const user = userEvent.setup();
    const client = makeClient();
    const { navigate } = renderWithAuth(<ReauthenticationAction />, client);

    expect(
      screen.getByRole('heading', { name: localization.settings.reauthenticationTitle }),
    ).toBeTruthy();
    await user.click(
      screen.getByRole('button', { name: localization.settings.reauthenticationAction }),
    );

    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith({
        to: '/auth/sign-in?reauthenticate=true&redirectTo=%2Fsettings%2Fsecurity',
      }),
    );
    expect(client.signOut).toHaveBeenCalled();
  });
});

describe('ErrorToaster', () => {
  function FailingQuery({
    queryKey,
    error,
    meta,
  }: {
    queryKey: string[];
    error: unknown;
    meta?: Record<string, unknown>;
  }) {
    useQuery({
      queryKey,
      queryFn: async () => {
        throw error;
      },
      meta,
    });
    return null;
  }

  function FailingMutation({
    mutationKey,
    error,
    meta,
  }: {
    mutationKey: readonly string[];
    error: unknown;
    meta?: Record<string, unknown>;
  }) {
    const mutation = useMutation({
      mutationKey,
      mutationFn: async () => {
        throw error;
      },
      meta,
    });
    return (
      <button type="button" onClick={() => mutation.mutate()}>
        Run {mutationKey.join('.')}
      </button>
    );
  }

  it('toasts auth query failures with safe copy and chains the existing handler', async () => {
    const previous = vi.fn();
    const queryClient = makeQueryClient({ queryCache: new QueryCache({ onError: previous }) });
    renderWithAuth(
      <FailingQuery queryKey={['auth', 'fake']} error={authError(403, 'FORBIDDEN')} />,
      makeClient(),
      {},
      queryClient,
    );

    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith("You don't have permission to do this."),
    );
    expect(previous).toHaveBeenCalled();
  });

  it('ignores non-auth, inline and unverified-email query failures', async () => {
    const queryClient = makeQueryClient();
    renderWithAuth(
      <>
        <FailingQuery queryKey={['other']} error={authError(403, 'FORBIDDEN')} />
        <FailingQuery
          queryKey={['auth', 'inline']}
          error={authError(403, 'FORBIDDEN')}
          meta={{ errorPresentation: 'inline' }}
        />
        <FailingQuery
          queryKey={['auth', 'unverified']}
          error={authError(403, 'EMAIL_NOT_VERIFIED')}
        />
      </>,
      makeClient(),
      {},
      queryClient,
    );

    await waitFor(() =>
      expect(queryClient.getQueryState(['auth', 'unverified'])?.status).toBe('error'),
    );
    await waitFor(() => expect(queryClient.getQueryState(['other'])?.status).toBe('error'));
    expect(toastMock.error).not.toHaveBeenCalled();
  });

  it('toasts auth mutation failures except the ones another surface owns', async () => {
    const user = userEvent.setup();
    const previous = vi.fn();
    const queryClient = makeQueryClient({
      mutationCache: new MutationCache({ onError: previous }),
    });
    renderWithAuth(
      <>
        <FailingMutation mutationKey={['other', 'thing']} error={authError(403, 'FORBIDDEN')} />
        <FailingMutation
          mutationKey={authMutationKeys.signIn.email}
          error={authError(400, 'PASSWORD_COMPROMISED')}
        />
        <FailingMutation
          mutationKey={authMutationKeys.signUp.email}
          error={authError(403, 'EMAIL_NOT_VERIFIED')}
        />
        <FailingMutation
          mutationKey={['auth', 'silent']}
          error={authError(403, 'FORBIDDEN')}
          meta={{ errorPresentation: 'silent' }}
        />
        <FailingMutation
          mutationKey={['auth', 'signIn', 'popup']}
          error={authError(400, 'POPUP_CLOSED')}
        />
        <FailingMutation
          mutationKey={oneTapMutationKeys.prompt}
          error={authError(418, 'EMAIL_NOT_VERIFIED')}
        />
      </>,
      makeClient(),
      {},
      queryClient,
    );

    for (const button of screen.getAllByRole('button').slice(0, 5)) {
      await user.click(button);
    }
    await waitFor(() => expect(previous).toHaveBeenCalledTimes(5));
    expect(toastMock.error).not.toHaveBeenCalled();

    await user.click(
      screen.getByRole('button', { name: `Run ${oneTapMutationKeys.prompt.join('.')}` }),
    );
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledTimes(1));
    expect(toastMock.error).toHaveBeenCalledWith(
      localization.auth.callbackEmailNotVerifiedDescription,
    );
  });

  it('restores the previous handlers on unmount', () => {
    const onError = vi.fn();
    const queryClient = makeQueryClient({ queryCache: new QueryCache({ onError }) });
    const { view } = renderWithAuth(<span>child</span>, makeClient(), {}, queryClient);

    expect(queryClient.getQueryCache().config.onError).not.toBe(onError);
    view.unmount();
    expect(queryClient.getQueryCache().config.onError).toBe(onError);
  });
});

describe('useIsHydrated', () => {
  it('reports true once rendered on the client', () => {
    const { result } = renderHook(() => useIsHydrated());
    expect(result.current).toBe(true);
  });

  it('reports false and hides client-only notices during server rendering', () => {
    window.history.replaceState(null, '', '/auth/sign-in?reauthenticate=true');
    function Probe() {
      return <p>hydrated:{String(useIsHydrated())}</p>;
    }
    const html = renderToString(
      <AuthProvider
        authClient={makeClient() as never}
        navigate={vi.fn()}
        Link={TestLink}
        queryClient={makeQueryClient()}
      >
        <Probe />
        <ReauthenticationNotice />
      </AuthProvider>,
    );

    expect(html).toContain('hydrated:<!-- -->false');
    expect(html).not.toContain(localization.settings.reauthenticationTitle);
  });

  it('AuthProvider exposes the merged configuration', () => {
    function Probe() {
      const { redirectTo, basePaths } = useAuth();
      return (
        <p>
          {basePaths.auth}|{redirectTo}
        </p>
      );
    }
    renderWithAuth(<Probe />, makeClient(), { redirectTo: '/configured' });
    expect(screen.getByText('/auth|/configured')).toBeTruthy();
  });
});
