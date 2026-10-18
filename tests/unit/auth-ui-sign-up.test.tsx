import { localization } from '@better-auth-ui/core';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestQueryClient } from '../helpers/query-client';

import { AuthProvider } from '@/components/auth/provider/auth-provider';
import { PasswordStrengthMeter } from '@/components/auth/password/password-strength-meter';
import { SignUp } from '@/components/auth/views/sign-up';

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

function makeClient(
  signUpEmail: (...args: unknown[]) => Promise<unknown> = async () => ({ token: null }),
) {
  return {
    getSession: vi.fn(async () => null),
    signUp: { email: vi.fn(signUpEmail) },
  };
}

function renderWithAuth(ui: ReactNode, client: object, options: Record<string, unknown> = {}) {
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
const submit = () => screen.getByRole('button', { name: localization.auth.signUp });

async function fillBasics(user: ReturnType<typeof userEvent.setup>, password = 'Mnbvxzlk1pqw!') {
  await user.type(byLabel(localization.auth.name), '  Test Person ');
  await user.type(byLabel(localization.auth.email), ' new.person@example.test ');
  await user.type(byLabel(localization.auth.password), password);
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
});

describe('SignUp', () => {
  it('renders name, email and password fields with a sign-in link carrying redirectTo', () => {
    renderWithAuth(<SignUp />, makeClient(), { redirectTo: '/home' });

    expect(byLabel(localization.auth.name)).toBeTruthy();
    expect(byLabel(localization.auth.email)).toBeTruthy();
    expect(screen.queryByLabelText(localization.auth.confirmPassword)).toBeNull();
    expect(screen.getByRole('link', { name: localization.auth.signIn }).getAttribute('href')).toBe(
      '/auth/sign-in?redirectTo=%2Fhome',
    );
  });

  it('shows required errors on an empty submit', async () => {
    const client = makeClient();
    const { view } = renderWithAuth(<SignUp />, client);

    fireEvent.submit(view.container.querySelector('form') as HTMLFormElement);

    await waitFor(() =>
      expect(screen.getAllByText(localization.auth.fieldRequired)).toHaveLength(3),
    );
    expect(client.signUp.email).not.toHaveBeenCalled();
  });

  it('reports mismatched and short confirmation passwords', async () => {
    const user = userEvent.setup();
    renderWithAuth(<SignUp />, makeClient(), { emailAndPassword: { confirmPassword: true } });

    await user.type(byLabel(localization.auth.password), 'Mnbvxzlk1pqw!');
    await user.type(byLabel(localization.auth.confirmPassword), 'abc');
    expect(
      await screen.findByText(localization.auth.tooShort.replace('{{min}}', '8')),
    ).toBeTruthy();

    await user.type(byLabel(localization.auth.confirmPassword), 'defghijk');
    expect(await screen.findByText(localization.auth.passwordsDoNotMatch)).toBeTruthy();

    await user.click(screen.getAllByRole('button', { name: localization.auth.showPassword })[1]);
    expect(byLabel(localization.auth.confirmPassword).type).toBe('text');
    await user.click(screen.getByRole('button', { name: localization.auth.hidePassword }));
    expect(byLabel(localization.auth.confirmPassword).type).toBe('password');
  });

  it('submits trimmed values and redirects when no verification is needed', async () => {
    const user = userEvent.setup();
    const client = makeClient();
    const { navigate } = renderWithAuth(<SignUp />, client, { redirectTo: '/welcome' });

    await fillBasics(user);
    await user.click(screen.getByRole('button', { name: localization.auth.showPassword }));
    expect(byLabel(localization.auth.password).type).toBe('text');
    await user.click(submit());

    await waitFor(() => expect(navigate).toHaveBeenCalledWith({ to: '/welcome' }));
    expect(client.signUp.email).toHaveBeenCalledWith(
      expect.objectContaining({
        name: '  Test Person ',
        email: 'new.person@example.test',
        password: 'Mnbvxzlk1pqw!',
      }),
    );
  });

  it('calls onSignUpSuccess instead of redirecting', async () => {
    const user = userEvent.setup();
    const onSignUpSuccess = vi.fn();
    const { navigate } = renderWithAuth(<SignUp onSignUpSuccess={onSignUpSuccess} />, makeClient());

    await fillBasics(user);
    await user.click(submit());

    await waitFor(() => expect(onSignUpSuccess).toHaveBeenCalledTimes(1));
    expect(navigate).not.toHaveBeenCalled();
  });

  it('routes to verify-email when verification is required', async () => {
    const user = userEvent.setup();
    const onSignUpSuccess = vi.fn();
    const { navigate } = renderWithAuth(
      <SignUp onSignUpSuccess={onSignUpSuccess} />,
      makeClient(),
      {
        emailAndPassword: { requireEmailVerification: true },
        redirectTo: '/after',
      },
    );

    await fillBasics(user);
    await user.click(submit());

    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith({ to: '/auth/verify-email?redirectTo=%2Fafter' }),
    );
    expect(sessionStorage.getItem('better-auth-ui.verify-email')).toBe('new.person@example.test');
    expect(onSignUpSuccess).not.toHaveBeenCalled();
  });

  it('sends an empty name when the name field is disabled', async () => {
    const user = userEvent.setup();
    const client = makeClient();
    renderWithAuth(<SignUp />, client, { emailAndPassword: { name: false } });

    expect(screen.queryByLabelText(localization.auth.name)).toBeNull();
    await user.type(byLabel(localization.auth.email), 'new.person@example.test');
    await user.type(byLabel(localization.auth.password), 'Mnbvxzlk1pqw!');
    await user.click(submit());

    await waitFor(() =>
      expect(client.signUp.email).toHaveBeenCalledWith(expect.objectContaining({ name: '' })),
    );
  });

  it('flags a compromised password against the field and clears it on edit', async () => {
    const user = userEvent.setup();
    const client = makeClient(async () => {
      throw authError(400, 'PASSWORD_COMPROMISED');
    });
    const { navigate } = renderWithAuth(<SignUp />, client);

    await fillBasics(user);
    await user.click(submit());

    expect(await screen.findByText(localization.auth.passwordCompromised)).toBeTruthy();
    expect(byLabel(localization.auth.password).value).toBe('Mnbvxzlk1pqw!');
    expect(toastMock.error).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();

    await user.type(byLabel(localization.auth.password), 'x');
    expect(screen.queryByText(localization.auth.passwordCompromised)).toBeNull();
  });

  it('shows other sign-up failures inline', async () => {
    const user = userEvent.setup();
    renderWithAuth(
      <SignUp />,
      makeClient(async () => {
        throw authError(422, 'USER_ALREADY_EXISTS');
      }),
    );

    await fillBasics(user);
    await user.click(submit());

    expect(await screen.findByText('An account with this email already exists.')).toBeTruthy();
    expect(toastMock.error).not.toHaveBeenCalled();
  });

  it('renders configured additional fields above and below and submits their values', async () => {
    const user = userEvent.setup();
    const client = makeClient();
    renderWithAuth(<SignUp />, client, {
      additionalFields: [
        { name: 'company', type: 'string', label: 'Company', signUp: 'above', required: true },
        { name: 'nickname', type: 'string', label: 'Nickname', signUp: true },
        { name: 'internal', type: 'string', label: 'Internal', signUp: false },
      ],
    });

    expect(screen.queryByLabelText('Internal')).toBeNull();
    const fieldIds = Array.from(document.querySelectorAll('input')).map((input) => input.id);
    expect(fieldIds.indexOf('additionalFields.company')).toBeLessThan(fieldIds.indexOf('password'));
    expect(fieldIds.indexOf('additionalFields.nickname')).toBeGreaterThan(
      fieldIds.indexOf('password'),
    );

    await fillBasics(user);
    fireEvent.submit(submit().closest('form') as HTMLFormElement);
    expect(await screen.findByText(localization.auth.fieldRequired)).toBeTruthy();
    expect(client.signUp.email).not.toHaveBeenCalled();

    await user.type(byLabel('Company'), 'Fake Co');
    await user.type(byLabel(`Nickname${localization.auth.optional}`), 'Nick');
    await user.click(submit());

    await waitFor(() =>
      expect(client.signUp.email).toHaveBeenCalledWith(
        expect.objectContaining({ company: 'Fake Co', nickname: 'Nick' }),
      ),
    );
  });

  it('renders plugin captcha and auth buttons and hides everything when password auth is off', () => {
    function PluginButton({ view }: { view: string }) {
      return <button type="button">Plugin {view}</button>;
    }
    const plugins = [
      { id: 'fake-captcha', captchaComponent: <div>Fake captcha</div> },
      { id: 'fake-buttons', authButtons: [PluginButton] },
    ];
    const { view } = renderWithAuth(<SignUp />, makeClient(), { plugins });
    expect(screen.getByText('Fake captcha')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Plugin signUp' })).toBeTruthy();
    view.unmount();

    renderWithAuth(<SignUp />, makeClient(), { emailAndPassword: { enabled: false } });
    expect(screen.queryByLabelText(localization.auth.email)).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
  });
});

describe('PasswordStrengthMeter', () => {
  it.each([
    ['abc', localization.auth.passwordWeak, 1],
    ['mnbvxzlk', localization.auth.passwordWeak, 1],
    ['Mnbvxzlk1', localization.auth.passwordFair, 2],
    ['Mnbvxzlk1pqw', localization.auth.passwordGood, 3],
    ['Mnbvxzlk1pqw!', localization.auth.passwordStrong, 4],
  ])('rates %s as %s', (password, label, filled) => {
    const { view } = renderWithAuth(<PasswordStrengthMeter password={password} />, makeClient());

    expect(screen.getByText(label)).toBeTruthy();
    const segments = view.container.querySelectorAll('[aria-hidden="true"] > span');
    expect(segments).toHaveLength(4);
    const coloured = Array.from(segments).filter((segment) =>
      /bg-(destructive|warning|primary)/.test(segment.className),
    );
    expect(coloured).toHaveLength(filled);
  });

  it('renders nothing for an empty password', () => {
    const { view } = renderWithAuth(<PasswordStrengthMeter password="" />, makeClient());
    expect(view.container.textContent).toBe('');
  });

  it('renders nothing when the strength meter is disabled', () => {
    const { view } = renderWithAuth(
      <PasswordStrengthMeter password="Mnbvxzlk1pqw!" />,
      makeClient(),
      {
        emailAndPassword: { strengthMeter: false },
      },
    );
    expect(view.container.textContent).toBe('');
  });
});
