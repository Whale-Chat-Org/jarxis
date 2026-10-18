import { localization } from '@better-auth-ui/core';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestQueryClient } from '../helpers/query-client';

import { AuthProvider } from '@/components/auth/auth-provider';
import { ForgotPassword } from '@/components/auth/forgot-password';
import { OpenEmailButton } from '@/components/auth/open-email-button';
import { RESET_LINK_SENT_STORAGE_KEY, ResetLinkSent } from '@/components/auth/reset-link-sent';
import { ResetPassword } from '@/components/auth/reset-password';
import { VerifyEmail } from '@/components/auth/verify-email';

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }));
vi.mock('sonner', () => ({ toast: toastMock }));

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
    requestPasswordReset: vi.fn(async () => ({ status: true })),
    resetPassword: vi.fn(async () => ({ status: true })),
    sendVerificationEmail: vi.fn(async () => ({ status: true })),
    ...overrides,
  };
}

function renderWithAuth(
  ui: ReactNode,
  client: object = makeClient(),
  options: Record<string, unknown> = {},
) {
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
      {ui}
    </AuthProvider>,
  );
  return { navigate, view };
}

const byLabel = (label: string) => screen.getByLabelText(label) as HTMLInputElement;

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
});

afterEach(() => {
  window.history.replaceState(null, '', '/');
  vi.useRealTimers();
});

describe('ForgotPassword', () => {
  it('validates the email before requesting a reset', async () => {
    const client = makeClient();
    const { view } = renderWithAuth(<ForgotPassword />, client);

    fireEvent.submit(view.container.querySelector('form') as HTMLFormElement);
    expect(await screen.findByText(localization.auth.fieldRequired)).toBeTruthy();

    const user = userEvent.setup();
    await user.type(byLabel(localization.auth.email), 'nope');
    expect(await screen.findByText(localization.auth.invalidEmail)).toBeTruthy();
    expect(client.requestPasswordReset).not.toHaveBeenCalled();
    expect(screen.getByRole('link', { name: localization.auth.signIn }).getAttribute('href')).toBe(
      '/auth/sign-in',
    );
  });

  it('requests a reset link, stores the email and navigates to the sent view', async () => {
    const user = userEvent.setup();
    const client = makeClient();
    const { navigate } = renderWithAuth(<ForgotPassword />, client);

    await user.type(byLabel(localization.auth.email), 'forgetful@example.test');
    await user.click(screen.getByRole('button', { name: localization.auth.sendResetLink }));

    await waitFor(() => expect(navigate).toHaveBeenCalledWith({ to: '/auth/reset-link-sent' }));
    expect(client.requestPasswordReset).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'forgetful@example.test',
        redirectTo: expect.stringContaining('/auth/reset-password'),
      }),
    );
    expect(sessionStorage.getItem(RESET_LINK_SENT_STORAGE_KEY)).toBe('forgetful@example.test');
  });

  it('toasts a failure and stays on the page', async () => {
    const user = userEvent.setup();
    const client = makeClient({
      requestPasswordReset: vi.fn(async () => {
        throw authError(429, 'TOO_MANY_REQUESTS');
      }),
    });
    const { navigate } = renderWithAuth(<ForgotPassword />, client, {
      plugins: [{ id: 'fake-captcha', captchaComponent: <div>Fake captcha</div> }],
    });

    expect(screen.getByText('Fake captcha')).toBeTruthy();
    await user.type(byLabel(localization.auth.email), 'forgetful@example.test');
    await user.click(screen.getByRole('button', { name: localization.auth.sendResetLink }));

    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith(
        'Too many attempts. Wait a moment and try again.',
      ),
    );
    expect(navigate).not.toHaveBeenCalled();
  });
});

describe('ResetPassword', () => {
  it('rejects a missing token on mount', async () => {
    const { navigate } = renderWithAuth(<ResetPassword />, makeClient(), { redirectTo: '/x' });

    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith({ to: '/auth/sign-in?redirectTo=%2Fx' }),
    );
    expect(toastMock.error).toHaveBeenCalledWith(localization.auth.invalidResetPasswordToken);
  });

  it('resets the password with the URL token and returns to sign-in', async () => {
    window.history.replaceState(null, '', '/auth/reset-password?token=fake-reset-token');
    const user = userEvent.setup();
    const client = makeClient();
    const { navigate } = renderWithAuth(<ResetPassword />, client);

    expect(navigate).not.toHaveBeenCalled();
    await user.type(byLabel(localization.auth.password), 'Mnbvxzlk1pqw!');
    expect(screen.getByText(localization.auth.passwordStrong)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: localization.auth.showPassword }));
    expect(byLabel(localization.auth.password).type).toBe('text');
    await user.click(screen.getByRole('button', { name: localization.auth.hidePassword }));
    await user.click(screen.getByRole('button', { name: localization.auth.resetPassword }));

    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith({ to: '/auth/sign-in?redirectTo=%2F' }),
    );
    expect(client.resetPassword).toHaveBeenCalledWith(
      expect.objectContaining({ token: 'fake-reset-token', newPassword: 'Mnbvxzlk1pqw!' }),
    );
    expect(toastMock.success).toHaveBeenCalledWith(localization.auth.passwordResetSuccess);
  });

  it('validates the confirmation and length', async () => {
    window.history.replaceState(null, '', '/auth/reset-password?token=fake-reset-token');
    const user = userEvent.setup();
    const client = makeClient();
    const { view } = renderWithAuth(<ResetPassword />, client, {
      emailAndPassword: { confirmPassword: true },
    });

    fireEvent.submit(view.container.querySelector('form') as HTMLFormElement);
    await waitFor(() =>
      expect(screen.getAllByText(localization.auth.fieldRequired)).toHaveLength(2),
    );

    await user.type(byLabel(localization.auth.password), 'Mnbvxzlk1pqw!');
    await user.type(byLabel(localization.auth.confirmPassword), 'Mnbvxzlk1pqw?');
    expect(await screen.findByText(localization.auth.passwordsDoNotMatch)).toBeTruthy();

    const toggles = screen.getAllByRole('button', { name: localization.auth.showPassword });
    await user.click(toggles[1]);
    expect(byLabel(localization.auth.confirmPassword).type).toBe('text');
    await user.click(screen.getByRole('button', { name: localization.auth.hidePassword }));
    expect(byLabel(localization.auth.confirmPassword).type).toBe('password');
    expect(client.resetPassword).not.toHaveBeenCalled();
  });

  it('marks a compromised password on the field without a toast', async () => {
    window.history.replaceState(null, '', '/auth/reset-password?token=fake-reset-token');
    const user = userEvent.setup();
    const client = makeClient({
      resetPassword: vi.fn(async () => {
        throw authError(400, 'PASSWORD_COMPROMISED');
      }),
    });
    renderWithAuth(<ResetPassword />, client);

    await user.type(byLabel(localization.auth.password), 'Mnbvxzlk1pqw!');
    await user.click(screen.getByRole('button', { name: localization.auth.resetPassword }));

    expect(await screen.findByText(localization.auth.passwordCompromised)).toBeTruthy();
    expect(toastMock.error).not.toHaveBeenCalled();
    await user.type(byLabel(localization.auth.password), 'x');
    expect(screen.queryByText(localization.auth.passwordCompromised)).toBeNull();
  });

  it('rejects a submit after the token disappears from the URL', async () => {
    window.history.replaceState(null, '', '/auth/reset-password?token=fake-reset-token');
    const user = userEvent.setup();
    const client = makeClient();
    const { navigate } = renderWithAuth(<ResetPassword />, client);

    await user.type(byLabel(localization.auth.password), 'Mnbvxzlk1pqw!');
    window.history.replaceState(null, '', '/auth/reset-password');
    await user.click(screen.getByRole('button', { name: localization.auth.resetPassword }));

    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith(localization.auth.invalidResetPasswordToken),
    );
    expect(navigate).toHaveBeenCalled();
    expect(client.resetPassword).not.toHaveBeenCalled();
  });
});

describe('ResetLinkSent', () => {
  it('shows a generic message without a stored email', () => {
    renderWithAuth(<ResetLinkSent />);

    expect(screen.getByText(localization.auth.passwordResetEmailSent)).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByRole('link', { name: localization.auth.signIn }).getAttribute('href')).toBe(
      '/auth/sign-in?redirectTo=%2F',
    );
  });

  it('names the stored email and offers to open a known provider', () => {
    sessionStorage.setItem(RESET_LINK_SENT_STORAGE_KEY, 'fake.user@gmail.com');
    renderWithAuth(<ResetLinkSent />);

    expect(
      screen.getByText(
        localization.auth.resetLinkSentTo.replace('{{email}}', 'fake.user@gmail.com'),
      ),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: /Open Gmail/ })).toBeTruthy();
  });
});

describe('OpenEmailButton', () => {
  it('opens the provider login page in a new tab', async () => {
    const user = userEvent.setup();
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    renderWithAuth(<OpenEmailButton email="fake.user@gmail.com" variant="secondary" />);

    await user.click(screen.getByRole('button', { name: /Open Gmail/ }));

    expect(openSpy).toHaveBeenCalledWith(
      'https://mail.google.com/mail/',
      '_blank',
      'noopener,noreferrer',
    );
    openSpy.mockRestore();
  });

  it('reveals a QR code hint on hover', async () => {
    const user = userEvent.setup();
    renderWithAuth(<OpenEmailButton email="fake.user@gmail.com" />);

    await user.hover(screen.getByRole('button', { name: /Open Gmail/ }));

    expect(await screen.findByText('Scan to open Gmail on your phone')).toBeTruthy();
  });

  it('renders nothing for an unknown domain', () => {
    const { view } = renderWithAuth(<OpenEmailButton email="someone@unknown-provider.test" />);
    expect(view.container.textContent).toBe('');
  });
});

describe('VerifyEmail', () => {
  it('hides the resend controls without a stored email', () => {
    renderWithAuth(<VerifyEmail />);

    expect(screen.getByText(localization.auth.checkYourEmail)).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByRole('link', { name: localization.auth.signIn }).getAttribute('href')).toBe(
      '/auth/sign-in',
    );
  });

  it('counts down, resends the verification email and restarts the cooldown', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    sessionStorage.setItem('better-auth-ui.verify-email', 'fake.user@gmail.com');
    const client = makeClient();
    renderWithAuth(<VerifyEmail />, client, {
      baseURL: 'https://app.example.test',
      redirectTo: '/home',
    });

    const resend = () => screen.getByRole('button', { name: /Resend/ }) as HTMLButtonElement;
    expect(resend().textContent).toContain('Resend in 60s');
    expect(resend().disabled).toBe(true);
    expect(screen.getByRole('button', { name: /Open Gmail/ })).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(resend().textContent).toContain('Resend in 59s');

    for (let index = 0; index < 60; index += 1) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
    }
    expect(resend().textContent).toBe(localization.auth.resend);
    expect(resend().disabled).toBe(false);

    fireEvent.click(resend());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(client.sendVerificationEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'fake.user@gmail.com',
        callbackURL: 'https://app.example.test/home',
      }),
    );
    expect(toastMock.success).toHaveBeenCalledWith(localization.auth.verificationEmailSent);
    expect(resend().textContent).toContain('Resend in 60s');
  });
});
