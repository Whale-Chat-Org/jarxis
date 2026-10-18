import { getReauthenticationSignInURL, localization } from '@better-auth-ui/core';
import { lastLoginMethodPlugin } from '@better-auth-ui/core/plugins/last-login-method';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestQueryClient } from '../helpers/query-client';

import { AuthProvider } from '@/components/auth/auth-provider';
import { SignIn } from '@/components/auth/sign-in';

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }));
vi.mock('sonner', () => ({ toast: toastMock }));

type ProviderOptions = Record<string, unknown>;

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
    signIn: { email: vi.fn(async () => ({ token: 'fake-token', user: { id: 'user-1' } })) },
    ...overrides,
  };
}

function renderSignIn(client: ReturnType<typeof makeClient>, options: ProviderOptions = {}) {
  const navigate = vi.fn();
  const queryClient = createTestQueryClient();
  const view = render(
    <AuthProvider
      authClient={client as never}
      navigate={navigate}
      Link={TestLink}
      queryClient={queryClient}
      {...(options as object)}
    >
      <SignIn />
    </AuthProvider>,
  );
  return { navigate, view };
}

const emailInput = () => screen.getByLabelText(localization.auth.email) as HTMLInputElement;
const passwordInput = () => screen.getByLabelText(localization.auth.password) as HTMLInputElement;
const submitButton = () =>
  screen.getByRole('button', { name: new RegExp(localization.auth.signIn) });

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
});

afterEach(() => {
  window.history.replaceState(null, '', '/');
});

describe('SignIn', () => {
  it('renders the email form with forgot-password and sign-up links', () => {
    renderSignIn(makeClient());

    expect(
      screen.getByText(localization.auth.signIn, { selector: '[data-slot="card-title"]' }),
    ).toBeTruthy();
    expect(
      screen.getByRole('link', { name: localization.auth.forgotPasswordLink }).getAttribute('href'),
    ).toBe('/auth/forgot-password');
    expect(screen.getByRole('link', { name: localization.auth.signUp }).getAttribute('href')).toBe(
      '/auth/sign-up',
    );
    expect(screen.queryByLabelText(localization.auth.rememberMe)).toBeNull();
  });

  it('shows required errors and does not call the client for an empty form', async () => {
    const client = makeClient();
    const { view } = renderSignIn(client);

    fireEvent.submit(view.container.querySelector('form') as HTMLFormElement);

    await waitFor(() =>
      expect(screen.getAllByText(localization.auth.fieldRequired)).toHaveLength(2),
    );
    expect(client.signIn.email).not.toHaveBeenCalled();
    expect(emailInput().getAttribute('aria-invalid')).toBe('true');
  });

  it('validates the email format and the minimum password length', async () => {
    const user = userEvent.setup();
    renderSignIn(makeClient(), { emailAndPassword: { minPasswordLength: 12 } });

    await user.type(emailInput(), 'not-an-email');
    await user.type(passwordInput(), 'short');
    await user.tab();

    expect(await screen.findByText(localization.auth.invalidEmail)).toBeTruthy();
    expect(screen.getByText(localization.auth.tooShort.replace('{{min}}', '12'))).toBeTruthy();
  });

  it('signs in with the entered credentials and navigates to the redirect target', async () => {
    const user = userEvent.setup();
    const client = makeClient();
    const { navigate } = renderSignIn(client, { redirectTo: '/dashboard' });

    await user.type(emailInput(), 'person@example.test');
    await user.type(passwordInput(), 'fake-password-123');
    await user.click(submitButton());

    await waitFor(() => expect(navigate).toHaveBeenCalledWith({ to: '/dashboard' }));
    expect(client.signIn.email).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'person@example.test',
        password: 'fake-password-123',
        fetchOptions: expect.objectContaining({ throw: true }),
      }),
    );
    expect((client.signIn.email.mock.calls[0] as unknown[])[0]).not.toHaveProperty('rememberMe');
  });

  it('sends rememberMe when the option is enabled', async () => {
    const user = userEvent.setup();
    const client = makeClient();
    renderSignIn(client, { emailAndPassword: { rememberMe: true } });

    await user.type(emailInput(), 'person@example.test');
    await user.type(passwordInput(), 'fake-password-123');
    await user.click(screen.getByRole('checkbox'));
    await user.click(submitButton());

    await waitFor(() =>
      expect(client.signIn.email).toHaveBeenCalledWith(
        expect.objectContaining({ rememberMe: true }),
      ),
    );
  });

  it('toggles password visibility', async () => {
    const user = userEvent.setup();
    renderSignIn(makeClient());

    expect(passwordInput().type).toBe('password');
    await user.click(screen.getByRole('button', { name: localization.auth.showPassword }));
    expect(passwordInput().type).toBe('text');
    await user.click(screen.getByRole('button', { name: localization.auth.hidePassword }));
    expect(passwordInput().type).toBe('password');
  });

  it('shows a safe inline message and preserves the password on invalid credentials', async () => {
    const user = userEvent.setup();
    const client = makeClient({
      signIn: {
        email: vi.fn(async () => {
          throw authError(401, 'INVALID_EMAIL_OR_PASSWORD');
        }),
      },
    });
    const { navigate } = renderSignIn(client);

    await user.type(emailInput(), 'person@example.test');
    await user.type(passwordInput(), 'wrong-password-1');
    await user.click(submitButton());

    expect(await screen.findByText('The sign-in details are incorrect. Try again.')).toBeTruthy();
    expect(passwordInput().value).toBe('wrong-password-1');
    expect(toastMock.error).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('routes an unverified account to the verify-email view', async () => {
    const user = userEvent.setup();
    const client = makeClient({
      signIn: {
        email: vi.fn(async () => {
          throw authError(403, 'EMAIL_NOT_VERIFIED');
        }),
      },
    });
    const { navigate } = renderSignIn(client);

    await user.type(emailInput(), 'pending@example.test');
    await user.type(passwordInput(), 'fake-password-123');
    await user.click(submitButton());

    await waitFor(() => expect(navigate).toHaveBeenCalledWith({ to: '/auth/verify-email' }));
    expect(sessionStorage.getItem('better-auth-ui.verify-email')).toBe('pending@example.test');
    expect(toastMock.error).not.toHaveBeenCalled();
  });

  it('hides the form and links when email and password auth is disabled', () => {
    renderSignIn(makeClient(), { emailAndPassword: { enabled: false } });

    expect(screen.queryByLabelText(localization.auth.email)).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('hides the forgot-password link when the flow is disabled', () => {
    renderSignIn(makeClient(), { emailAndPassword: { forgotPassword: false } });

    expect(screen.queryByRole('link', { name: localization.auth.forgotPasswordLink })).toBeNull();
  });

  it('renders plugin captcha and auth buttons', () => {
    function PluginButton({ view }: { view: string }) {
      return <button type="button">Plugin {view}</button>;
    }
    renderSignIn(makeClient(), {
      plugins: [
        { id: 'fake-captcha', captchaComponent: <div>Fake captcha</div> },
        { id: 'fake-buttons', authButtons: [PluginButton] },
      ],
    });

    expect(screen.getByText('Fake captcha')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Plugin signIn' })).toBeTruthy();
  });

  it('shows the last-used badge when email was the last login method', () => {
    renderSignIn(makeClient({ getLastUsedLoginMethod: () => 'email' }), {
      plugins: [lastLoginMethodPlugin()],
    });

    expect(screen.getByText('Last')).toBeTruthy();
  });

  it('omits the last-used badge for another method', () => {
    renderSignIn(makeClient({ getLastUsedLoginMethod: () => 'github' }), {
      plugins: [lastLoginMethodPlugin()],
    });

    expect(screen.queryByText('Last')).toBeNull();
  });

  it('shows the reauthentication notice when opened for reauthentication', () => {
    window.history.replaceState(
      null,
      '',
      getReauthenticationSignInURL(new URL('http://localhost/settings/security'), '/auth/sign-in'),
    );
    renderSignIn(makeClient());

    expect(screen.getByText(localization.settings.reauthenticationTitle)).toBeTruthy();
    expect(screen.getByText(localization.settings.reauthenticationDescription)).toBeTruthy();
  });
});
