import { localization } from '@better-auth-ui/core';
import { QueryClient } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthProvider } from '@/components/auth/auth-provider';
import { ActiveSessions } from '@/components/auth/settings/security/active-sessions';
import { ChangePassword } from '@/components/auth/settings/security/change-password';
import { SecuritySettings } from '@/components/auth/settings/security/security-settings';

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }));
vi.mock('sonner', () => ({ toast: toastMock }));

function TestLink({ href, children }: { href: string; children?: ReactNode }) {
  return <a href={href}>{children}</a>;
}

const DESKTOP_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const MOBILE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

const currentSession = {
  session: { id: 'session-current', token: 'fake-current-token', userId: 'user-1' },
  user: {
    id: 'user-1',
    name: 'Test User',
    email: 'fake.user@gmail.com',
    emailVerified: true,
    image: null,
  },
};

function sessionRow(id: string, token: string, userAgent: string | null, createdAt?: Date) {
  return {
    id,
    token,
    userId: 'user-1',
    userAgent,
    ipAddress: '203.0.113.7',
    createdAt,
    updatedAt: createdAt,
    expiresAt: new Date(Date.now() + 86_400_000),
  };
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
    getSession: vi.fn(async () => currentSession),
    listAccounts: vi.fn(async () => [
      { id: 'acc-1', providerId: 'credential', accountId: 'user-1' },
    ]),
    listSessions: vi.fn(async () => [
      sessionRow(
        'session-other',
        'fake-other-token',
        MOBILE_UA,
        new Date(Date.now() - 2 * 3_600_000),
      ),
      sessionRow('session-current', 'fake-current-token', DESKTOP_UA, new Date()),
    ]),
    changePassword: vi.fn(async () => ({ status: true })),
    requestPasswordReset: vi.fn(async () => ({ status: true })),
    revokeSession: vi.fn(async () => ({ status: true })),
    revokeOtherSessions: vi.fn(async () => ({ status: true })),
    revokeSessions: vi.fn(async () => ({ status: true })),
    signOut: vi.fn(async () => ({ success: true })),
    ...overrides,
  };
}

function renderWithAuth(
  ui: ReactNode,
  client: object = makeClient(),
  options: Record<string, unknown> = {},
) {
  const navigate = vi.fn();
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
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
const updateButton = () =>
  screen.getByRole('button', { name: localization.settings.updatePassword }) as HTMLButtonElement;

async function waitForForm() {
  await waitFor(() => expect(updateButton().disabled).toBe(false));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ChangePassword', () => {
  it('shows skeletons while accounts load', () => {
    const client = makeClient({ listAccounts: vi.fn(() => new Promise(() => undefined)) });
    const { view } = renderWithAuth(<ChangePassword />, client);

    expect(view.container.querySelectorAll('[data-slot="skeleton"]').length).toBe(2);
    expect(updateButton().disabled).toBe(true);
  });

  it('changes the password, revoking other sessions', async () => {
    const user = userEvent.setup();
    const client = makeClient();
    renderWithAuth(<ChangePassword />, client);

    await waitForForm();
    await user.type(byLabel(localization.settings.currentPassword), 'old-fake-password');
    await user.type(byLabel(localization.auth.newPassword), 'Mnbvxzlk1pqw!');
    expect(screen.getByText(localization.auth.passwordStrong)).toBeTruthy();
    await user.click(updateButton());

    await waitFor(() =>
      expect(toastMock.success).toHaveBeenCalledWith(localization.settings.changePasswordSuccess),
    );
    expect(client.changePassword).toHaveBeenCalledWith(
      expect.objectContaining({
        currentPassword: 'old-fake-password',
        newPassword: 'Mnbvxzlk1pqw!',
        revokeOtherSessions: true,
      }),
    );
    await waitFor(() => expect(byLabel(localization.settings.currentPassword).value).toBe(''));
  });

  it('validates required, length and matching confirmation, and toggles visibility', async () => {
    const user = userEvent.setup();
    const client = makeClient();
    const { view } = renderWithAuth(<ChangePassword />, client, {
      emailAndPassword: { confirmPassword: true },
    });

    await waitForForm();
    fireEvent.submit(view.container.querySelector('form') as HTMLFormElement);
    await waitFor(() =>
      expect(screen.getAllByText(localization.auth.fieldRequired)).toHaveLength(3),
    );

    await user.type(byLabel(localization.auth.newPassword), 'short');
    expect(
      await screen.findByText(localization.auth.tooShort.replace('{{min}}', '8')),
    ).toBeTruthy();
    await user.clear(byLabel(localization.auth.newPassword));
    await user.type(byLabel(localization.auth.newPassword), 'Mnbvxzlk1pqw!');
    await user.type(byLabel(localization.auth.confirmPassword), 'Mnbvxzlk1pqw?');
    expect(await screen.findByText(localization.auth.passwordsDoNotMatch)).toBeTruthy();

    for (const id of ['currentPassword', 'newPassword', 'confirmPassword']) {
      const input = view.container.querySelector(`#${id}`) as HTMLInputElement;
      const toggle = input.parentElement?.querySelector('button') as HTMLButtonElement;
      expect(input.type).toBe('password');
      await user.click(toggle);
      expect(input.type).toBe('text');
      expect(toggle.getAttribute('aria-label')).toBe(localization.auth.hidePassword);
    }
    expect(client.changePassword).not.toHaveBeenCalled();
  });

  it('shows a compromised password against the new password field', async () => {
    const user = userEvent.setup();
    const client = makeClient({
      changePassword: vi.fn(async () => {
        throw authError(400, 'PASSWORD_COMPROMISED');
      }),
    });
    renderWithAuth(<ChangePassword />, client);

    await waitForForm();
    await user.type(byLabel(localization.settings.currentPassword), 'old-fake-password');
    await user.type(byLabel(localization.auth.newPassword), 'Mnbvxzlk1pqw!');
    await user.click(updateButton());

    expect(await screen.findByText(localization.auth.passwordCompromised)).toBeTruthy();
    expect(toastMock.error).not.toHaveBeenCalled();
    await user.type(byLabel(localization.auth.newPassword), 'x');
    expect(screen.queryByText(localization.auth.passwordCompromised)).toBeNull();
  });

  it('toasts a wrong current password', async () => {
    const user = userEvent.setup();
    const client = makeClient({
      changePassword: vi.fn(async () => {
        throw authError(400, 'INVALID_PASSWORD');
      }),
    });
    renderWithAuth(<ChangePassword />, client);

    await waitForForm();
    await user.type(byLabel(localization.settings.currentPassword), 'wrong-fake-password');
    await user.type(byLabel(localization.auth.newPassword), 'Mnbvxzlk1pqw!');
    await user.click(updateButton());

    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith('The sign-in details are incorrect. Try again.'),
    );
    expect(screen.queryByText(localization.auth.passwordCompromised)).toBeNull();
  });

  it('offers to set a password for social-only accounts', async () => {
    const user = userEvent.setup();
    const client = makeClient({
      listAccounts: vi.fn(async () => [{ id: 'acc-2', providerId: 'github', accountId: 'gh-1' }]),
    });
    renderWithAuth(<ChangePassword />, client, {
      plugins: [{ id: 'fake-captcha', captchaComponent: <div>Fake captcha</div> }],
    });

    expect(await screen.findByText(localization.settings.setPassword)).toBeTruthy();
    expect(screen.getByText('Fake captcha')).toBeTruthy();
    const send = screen.getByRole('button', {
      name: localization.auth.sendResetLink,
    }) as HTMLButtonElement;
    await waitFor(() => expect(send.disabled).toBe(false));
    await user.click(send);

    expect(
      await screen.findByText(
        localization.auth.resetLinkSentTo.replace('{{email}}', 'fake.user@gmail.com'),
      ),
    ).toBeTruthy();
    expect(client.requestPasswordReset).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'fake.user@gmail.com',
        redirectTo: expect.stringContaining('/auth/reset-password'),
      }),
    );
    expect(screen.getByRole('button', { name: /Open Gmail/ })).toBeTruthy();
  });

  it('keeps the set-password button when the reset request fails', async () => {
    const user = userEvent.setup();
    const client = makeClient({
      listAccounts: vi.fn(async () => []),
      requestPasswordReset: vi.fn(async () => {
        throw authError(429, 'TOO_MANY_REQUESTS');
      }),
    });
    renderWithAuth(<ChangePassword />, client);

    const send = (await screen.findByRole('button', {
      name: localization.auth.sendResetLink,
    })) as HTMLButtonElement;
    await waitFor(() => expect(send.disabled).toBe(false));
    await user.click(send);

    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith(
        'Too many attempts. Wait a moment and try again.',
      ),
    );
    expect(screen.getByRole('button', { name: localization.auth.sendResetLink })).toBeTruthy();
  });

  it('stays in the loading state without a session', () => {
    const client = makeClient({
      getSession: vi.fn(async () => null),
      listAccounts: vi.fn(async () => []),
    });
    const { view } = renderWithAuth(<ChangePassword />, client);

    // Accounts are keyed by user id, so without a session the list never loads.
    expect(view.container.querySelectorAll('[data-slot="skeleton"]').length).toBe(2);
    expect(updateButton().disabled).toBe(true);
    expect(client.listAccounts).not.toHaveBeenCalled();
  });
});

describe('ActiveSessions', () => {
  it('lists the current session first with device details', async () => {
    renderWithAuth(<ActiveSessions />);

    const badge = await screen.findByText(localization.settings.currentSession);
    const rows = document.querySelectorAll('[data-slot="item"]');
    expect(rows).toHaveLength(2);
    expect(rows[0].contains(badge)).toBe(true);
    expect(rows[0].textContent).toContain('Chrome, macOS');
    expect(rows[0].querySelector('.lucide-monitor')).toBeTruthy();
    expect(rows[1].textContent).toContain('Safari, iOS');
    expect(rows[1].textContent).toContain('2 hours ago');
    expect(rows[1].querySelector('.lucide-smartphone')).toBeTruthy();
  });

  it('signs out of the current session and revokes another one', async () => {
    const user = userEvent.setup();
    const client = makeClient();
    const { navigate } = renderWithAuth(<ActiveSessions />, client);

    await user.click(await screen.findByRole('button', { name: localization.auth.signOut }));
    expect(navigate).toHaveBeenCalledWith({ to: '/auth/sign-out' });

    await user.click(screen.getByRole('button', { name: localization.settings.revokeSession }));
    await waitFor(() =>
      expect(toastMock.success).toHaveBeenCalledWith(localization.settings.revokeSessionSuccess),
    );
    expect(client.revokeSession).toHaveBeenCalledWith(
      expect.objectContaining({ token: 'fake-other-token' }),
    );
  });

  it('labels unknown devices and very recent sessions', async () => {
    const client = makeClient({
      listSessions: vi.fn(async () => [
        sessionRow('session-current', 'fake-current-token', DESKTOP_UA, new Date()),
        sessionRow('session-blank', 'fake-blank-token', 'curl/8.0', new Date(Date.now() + 5_000)),
        sessionRow('session-nodate', 'fake-nodate-token', DESKTOP_UA),
      ]),
    });
    renderWithAuth(<ActiveSessions />, client);

    expect(
      await screen.findByText('Unknown Browser', { selector: '[data-slot="item-title"]' }),
    ).toBeTruthy();
    const rows = document.querySelectorAll('[data-slot="item"]');
    expect(
      rows[1].querySelector('[data-slot="item-description"]')?.textContent?.toLowerCase(),
    ).toBe('now');
    expect(rows[2].querySelector('[data-slot="item-description"]')).toBeNull();
  });

  it('shows a skeleton while loading', () => {
    const client = makeClient({ listSessions: vi.fn(() => new Promise(() => undefined)) });
    const { view } = renderWithAuth(<ActiveSessions />, client);

    expect(view.container.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0);
    expect(
      screen.queryByRole('button', { name: localization.settings.signOutEverywhere }),
    ).toBeNull();
  });

  it('asks for reauthentication when the session is not fresh', async () => {
    const client = makeClient({
      listSessions: vi.fn(async () => {
        throw authError(403, 'SESSION_NOT_FRESH');
      }),
    });
    renderWithAuth(<ActiveSessions />, client);

    expect(
      await screen.findByRole('button', { name: localization.settings.reauthenticationAction }),
    ).toBeTruthy();
    expect(toastMock.error).not.toHaveBeenCalled();
  });

  it('shows an inline error with a retry', async () => {
    const user = userEvent.setup();
    const listSessions = vi
      .fn()
      .mockRejectedValueOnce(authError(403, 'FORBIDDEN'))
      .mockResolvedValue([
        sessionRow('session-current', 'fake-current-token', DESKTOP_UA, new Date()),
      ]);
    renderWithAuth(<ActiveSessions />, makeClient({ listSessions }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain(localization.errors.permissionDenied);
    expect(toastMock.error).not.toHaveBeenCalled();

    await user.click(within(alert).getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText(localization.settings.currentSession)).toBeTruthy();
  });
});

describe('SessionActions', () => {
  it('disables signing out other devices when there are none', async () => {
    const client = makeClient({
      listSessions: vi.fn(async () => [
        sessionRow('session-current', 'fake-current-token', DESKTOP_UA, new Date()),
      ]),
    });
    renderWithAuth(<ActiveSessions />, client);

    const button = (await screen.findByRole('button', {
      name: localization.settings.signOutOtherDevices,
    })) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it('confirms and signs out other devices', async () => {
    const user = userEvent.setup();
    const client = makeClient();
    renderWithAuth(<ActiveSessions />, client);

    const open = await screen.findByRole('button', {
      name: localization.settings.signOutOtherDevices,
    });
    await waitFor(() => expect((open as HTMLButtonElement).disabled).toBe(false));
    await user.click(open);

    const dialog = await screen.findByRole('alertdialog');
    expect(
      within(dialog).getByText(localization.settings.signOutOtherDevicesDescription),
    ).toBeTruthy();
    await user.click(
      within(dialog).getByRole('button', { name: localization.settings.signOutOtherDevices }),
    );

    await waitFor(() =>
      expect(toastMock.success).toHaveBeenCalledWith(
        localization.settings.signOutOtherDevicesSuccess,
      ),
    );
    expect(client.revokeOtherSessions).toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  });

  it('cancels and then signs out everywhere', async () => {
    const user = userEvent.setup();
    const client = makeClient();
    const { navigate } = renderWithAuth(<ActiveSessions />, client);

    await user.click(
      await screen.findByRole('button', { name: localization.settings.signOutEverywhere }),
    );
    let dialog = await screen.findByRole('alertdialog');
    expect(
      within(dialog).getByText(localization.settings.signOutEverywhereDescription),
    ).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: localization.settings.cancel }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());

    await user.click(screen.getByRole('button', { name: localization.settings.signOutEverywhere }));
    dialog = await screen.findByRole('alertdialog');
    await user.click(
      within(dialog).getByRole('button', { name: localization.settings.signOutEverywhere }),
    );

    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith({ to: '/auth/sign-in', replace: true }),
    );
    expect(client.revokeSessions).toHaveBeenCalled();
    expect(client.revokeOtherSessions).not.toHaveBeenCalled();
  });
});

describe('SecuritySettings', () => {
  it('renders password and sessions cards plus plugin security cards', async () => {
    renderWithAuth(<SecuritySettings className="security" />, makeClient(), {
      plugins: [{ id: 'fake-passkeys', securityCards: [() => <p>Passkeys card</p>] }],
    });

    expect(screen.getByText(localization.settings.changePassword)).toBeTruthy();
    expect(screen.getByText(localization.settings.activeSessions)).toBeTruthy();
    expect(screen.getByText('Passkeys card')).toBeTruthy();
  });

  it('omits the password card when password auth is off', () => {
    renderWithAuth(<SecuritySettings />, makeClient(), { emailAndPassword: { enabled: false } });

    expect(screen.queryByText(localization.settings.changePassword)).toBeNull();
    expect(screen.getByText(localization.settings.activeSessions)).toBeTruthy();
  });
});
