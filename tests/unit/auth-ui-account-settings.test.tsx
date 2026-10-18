import { localization } from '@better-auth-ui/core';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestQueryClient } from '../helpers/query-client';

import { AuthProvider } from '@/components/auth/provider/auth-provider';
import { AccountSettings } from '@/components/settings/account/account-settings';
import { ChangeAvatar } from '@/components/settings/account/change-avatar';
import { ChangeEmail } from '@/components/settings/account/change-email';
import { UserProfile } from '@/components/settings/account/user-profile';
import { Settings } from '@/components/settings/settings';

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }));
vi.mock('sonner', () => ({ toast: toastMock }));

function TestLink({ href, children }: { href: string; children?: ReactNode }) {
  return <a href={href}>{children}</a>;
}

const OLD_IMAGE = '/api/profile/avatar/user-1/old';
const NEW_IMAGE = '/api/profile/avatar/user-1/new';

function makeSession(user: Record<string, unknown> = {}) {
  return {
    session: { id: 'session-1', token: 'fake-session-token', userId: 'user-1' },
    user: {
      id: 'user-1',
      name: 'Test User',
      email: 'test.user@example.test',
      emailVerified: true,
      image: OLD_IMAGE,
      ...user,
    },
  };
}

function authError(status: number, code: string) {
  return Object.assign(new Error(code), {
    status,
    statusText: code,
    error: { code, message: code },
  });
}

function makeClient(overrides: Record<string, unknown> = {}, session: unknown = makeSession()) {
  return {
    getSession: vi.fn(async () => session),
    updateUser: vi.fn(async () => ({ status: true })),
    changeEmail: vi.fn(async () => ({ status: true })),
    listAccounts: vi.fn(async () => [
      { id: 'acc-1', providerId: 'credential', accountId: 'user-1' },
    ]),
    listSessions: vi.fn(async () => []),
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

function avatarOptions(overrides: Record<string, unknown> = {}) {
  return {
    avatar: {
      enabled: true,
      resize: async (file: File) => file,
      upload: vi.fn(async () => NEW_IMAGE),
      delete: vi.fn(async () => undefined),
      ...overrides,
    },
  };
}

const fakeFile = () => new File(['fake-bytes'], 'avatar.png', { type: 'image/png' });
const fileInput = (container: HTMLElement) =>
  container.querySelector('input[type="file"]') as HTMLInputElement;

async function waitForAvatarReady() {
  await waitFor(() =>
    expect(
      screen
        .getByRole('button', { name: localization.settings.changeAvatar })
        .hasAttribute('disabled'),
    ).toBe(false),
  );
}

async function openAvatarMenu(user: ReturnType<typeof userEvent.setup>) {
  await waitForAvatarReady();
  await user.click(screen.getByRole('button', { name: localization.settings.changeAvatar }));
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  window.history.replaceState(null, '', '/');
});

describe('ChangeAvatar', () => {
  it('uploads a new avatar, saves it and deletes the previous image', async () => {
    const user = userEvent.setup();
    const client = makeClient();
    const options = avatarOptions();
    const { view } = renderWithAuth(<ChangeAvatar />, client, options);

    await waitForAvatarReady();
    await user.upload(fileInput(view.container), fakeFile());

    await waitFor(() =>
      expect(toastMock.success).toHaveBeenCalledWith(localization.settings.avatarChangedSuccess),
    );
    expect(options.avatar.upload).toHaveBeenCalledWith(expect.any(File));
    expect(client.updateUser).toHaveBeenCalledWith(expect.objectContaining({ image: NEW_IMAGE }));
    expect(options.avatar.delete).toHaveBeenCalledWith(OLD_IMAGE);
  });

  it('warns when the previous image cannot be cleaned up', async () => {
    const user = userEvent.setup();
    const client = makeClient();
    const options = avatarOptions({ delete: vi.fn(async () => Promise.reject(new Error('gone'))) });
    const { view } = renderWithAuth(<ChangeAvatar />, client, options);

    await waitForAvatarReady();
    await user.upload(fileInput(view.container), fakeFile());

    await waitFor(() => expect(toastMock.warning).toHaveBeenCalledTimes(1));
    expect(toastMock.success).not.toHaveBeenCalled();
  });

  it('removes the uploaded blob when saving the profile fails', async () => {
    const user = userEvent.setup();
    const client = makeClient({
      updateUser: vi.fn(async () => {
        throw authError(403, 'FORBIDDEN');
      }),
    });
    const options = avatarOptions();
    const { view } = renderWithAuth(<ChangeAvatar />, client, options);

    await waitForAvatarReady();
    await user.upload(fileInput(view.container), fakeFile());

    await waitFor(() => expect(options.avatar.delete).toHaveBeenCalledWith(NEW_IMAGE));
    // The global toaster reports the failure once; the component does not repeat it.
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledTimes(1));
    expect(toastMock.error).toHaveBeenCalledWith("You don't have permission to do this.");
  });

  it('reports an upload failure with safe copy and ignores an empty selection', async () => {
    const options = avatarOptions({
      upload: vi.fn(async () => Promise.reject(new Error('raw upload text'))),
    });
    const client = makeClient();
    const { view } = renderWithAuth(<ChangeAvatar />, client, options);

    fireEvent.change(fileInput(view.container), { target: { files: [] } });
    expect(options.avatar.upload).not.toHaveBeenCalled();

    const user = userEvent.setup();
    await user.upload(fileInput(view.container), fakeFile());
    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith(localization.errors.imageUploadFailed),
    );
    expect(client.updateUser).not.toHaveBeenCalled();
  });

  it('deletes the avatar from the menu', async () => {
    const user = userEvent.setup();
    const client = makeClient();
    const options = avatarOptions();
    renderWithAuth(<ChangeAvatar />, client, options);

    await openAvatarMenu(user);
    await user.click(
      await screen.findByRole('menuitem', { name: localization.settings.deleteAvatar }),
    );

    await waitFor(() =>
      expect(toastMock.success).toHaveBeenCalledWith(localization.settings.avatarDeletedSuccess),
    );
    expect(client.updateUser).toHaveBeenCalledWith(expect.objectContaining({ image: null }));
    expect(options.avatar.delete).toHaveBeenCalledWith(OLD_IMAGE);
  });

  it('warns when the stored image cannot be deleted', async () => {
    const user = userEvent.setup();
    const options = avatarOptions({ delete: vi.fn(async () => Promise.reject(new Error('gone'))) });
    renderWithAuth(<ChangeAvatar />, makeClient(), options);

    await openAvatarMenu(user);
    await user.click(
      await screen.findByRole('menuitem', { name: localization.settings.deleteAvatar }),
    );

    await waitFor(() => expect(toastMock.warning).toHaveBeenCalledTimes(1));
    expect(toastMock.success).not.toHaveBeenCalled();
  });

  it('reports a failed delete exactly once', async () => {
    const user = userEvent.setup();
    const client = makeClient({ updateUser: vi.fn(async () => Promise.reject(new Error('raw'))) });
    // The global toaster surfaces the mutation failure; the component must not add a second toast.
    renderWithAuth(<ChangeAvatar />, client, avatarOptions());

    await openAvatarMenu(user);
    await user.click(
      await screen.findByRole('menuitem', { name: localization.settings.deleteAvatar }),
    );

    await waitFor(() => expect(toastMock.error).toHaveBeenCalledTimes(1));
    expect(toastMock.error).toHaveBeenCalledWith(localization.errors.generic);
    expect(toastMock.success).not.toHaveBeenCalled();
  });

  it('uploads from the menu item and disables delete without an image', async () => {
    const user = userEvent.setup();
    const { view } = renderWithAuth(
      <ChangeAvatar />,
      makeClient({}, makeSession({ image: null })),
      avatarOptions(),
    );
    const clickSpy = vi.spyOn(fileInput(view.container), 'click');

    await openAvatarMenu(user);
    const deleteItem = await screen.findByRole('menuitem', {
      name: localization.settings.deleteAvatar,
    });
    expect(deleteItem.getAttribute('aria-disabled')).toBe('true');
    await user.click(screen.getByRole('menuitem', { name: localization.settings.uploadAvatar }));
    expect(clickSpy).toHaveBeenCalled();
  });

  it('removes the profile image without touching storage when there was none', async () => {
    const user = userEvent.setup();
    const options = avatarOptions();
    const { view } = renderWithAuth(
      <ChangeAvatar />,
      makeClient({}, makeSession({ image: null })),
      options,
    );

    await waitForAvatarReady();
    await user.upload(fileInput(view.container), fakeFile());

    await waitFor(() =>
      expect(toastMock.success).toHaveBeenCalledWith(localization.settings.avatarChangedSuccess),
    );
    expect(options.avatar.delete).not.toHaveBeenCalled();
  });
});

describe('UserProfile', () => {
  it('prefills the name and saves profile changes', async () => {
    const user = userEvent.setup();
    const client = makeClient();
    renderWithAuth(<UserProfile />, client, avatarOptions());

    const name = (await screen.findByLabelText(localization.auth.name)) as HTMLInputElement;
    await waitFor(() => expect(name.value).toBe('Test User'));
    await user.clear(name);
    expect(await screen.findByText(localization.auth.fieldRequired)).toBeTruthy();
    await user.type(name, 'Renamed User');
    await user.click(screen.getByRole('button', { name: localization.settings.saveChanges }));

    await waitFor(() =>
      expect(toastMock.success).toHaveBeenCalledWith(localization.settings.profileUpdatedSuccess),
    );
    expect(client.updateUser).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Renamed User' }),
    );
  });

  it('edits profile additional fields seeded from the user model', async () => {
    const user = userEvent.setup();
    const client = makeClient({}, makeSession({ company: 'Old Co', internalTag: 'x' }));
    renderWithAuth(<UserProfile />, client, {
      ...avatarOptions(),
      profile: { name: false },
      additionalFields: [
        { name: 'company', type: 'string', label: 'Company' },
        { name: 'internalTag', type: 'string', label: 'Tag', inputType: 'hidden' },
        { name: 'signupOnly', type: 'string', label: 'Signup only', profile: false },
      ],
    });

    expect(screen.queryByLabelText(localization.auth.name)).toBeNull();
    expect(screen.queryByLabelText('Signup only')).toBeNull();
    const company = (await screen.findByLabelText('Company')) as HTMLInputElement;
    await waitFor(() => expect(company.value).toBe('Old Co'));
    await user.clear(company);
    await user.type(company, 'New Co');
    await user.click(screen.getByRole('button', { name: localization.settings.saveChanges }));

    await waitFor(() =>
      expect(client.updateUser).toHaveBeenCalledWith(
        expect.objectContaining({ company: 'New Co', internalTag: 'x' }),
      ),
    );
    expect((client.updateUser.mock.calls[0] as unknown[])[0]).not.toHaveProperty('name');
  });

  it('shows skeletons while the session loads', () => {
    const client = makeClient({ getSession: vi.fn(() => new Promise(() => undefined)) });
    const { view } = renderWithAuth(<UserProfile />, client, {
      additionalFields: [
        { name: 'company', type: 'string', label: 'Company' },
        { name: 'internalTag', type: 'string', label: 'Tag', inputType: 'hidden' },
      ],
    });

    expect(screen.queryByLabelText(localization.auth.name)).toBeNull();
    expect(view.container.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThanOrEqual(
      2,
    );
    expect(
      (screen.getByRole('button', { name: localization.settings.saveChanges }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it('renders nothing without an avatar or editable fields', () => {
    const { view } = renderWithAuth(<UserProfile />, makeClient(), {
      avatar: { enabled: false },
      profile: { name: false },
    });
    expect(view.container.textContent).toBe('');
  });

  it('hides the save button when only the avatar is editable', async () => {
    renderWithAuth(<UserProfile />, makeClient(), { ...avatarOptions(), profile: { name: false } });

    expect(await screen.findByText(localization.settings.avatar)).toBeTruthy();
    expect(screen.queryByRole('button', { name: localization.settings.saveChanges })).toBeNull();
  });
});

describe('ChangeEmail', () => {
  it('prefills the current email and requests a change', async () => {
    const user = userEvent.setup();
    const client = makeClient();
    renderWithAuth(<ChangeEmail />, client, { baseURL: 'https://app.example.test' });

    const email = (await screen.findByLabelText(localization.auth.email)) as HTMLInputElement;
    await waitFor(() => expect(email.value).toBe('test.user@example.test'));
    await user.clear(email);
    await user.type(email, 'bad');
    expect(await screen.findByText(localization.auth.invalidEmail)).toBeTruthy();
    await user.clear(email);
    await user.type(email, 'changed.user@example.test');
    await user.click(screen.getByRole('button', { name: localization.settings.updateEmail }));

    await waitFor(() =>
      expect(toastMock.success).toHaveBeenCalledWith(localization.settings.changeEmailSuccess),
    );
    expect(client.changeEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        newEmail: 'changed.user@example.test',
        callbackURL: 'https://app.example.test/settings/account',
      }),
    );
  });

  it('shows a skeleton and a disabled button before the session loads', () => {
    const client = makeClient({ getSession: vi.fn(() => new Promise(() => undefined)) });
    const { view } = renderWithAuth(<ChangeEmail className="email-card" />, client);

    expect(view.container.querySelector('[data-slot="skeleton"]')).toBeTruthy();
    expect(view.container.querySelector('.email-card')).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: localization.settings.updateEmail }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });
});

describe('AccountSettings', () => {
  it('renders the profile and change-email cards', async () => {
    renderWithAuth(<AccountSettings className="account" />);

    expect(screen.getByText(localization.settings.userProfile)).toBeTruthy();
    expect(screen.getByText(localization.settings.changeEmail)).toBeTruthy();
  });

  it('hides change-email without password or magic-link auth', () => {
    renderWithAuth(<AccountSettings />, makeClient(), { emailAndPassword: { enabled: false } });
    expect(screen.queryByText(localization.settings.changeEmail)).toBeNull();
  });

  it('keeps change-email for magic-link and uses plugin overrides and cards', () => {
    const { view } = renderWithAuth(<AccountSettings />, makeClient(), {
      emailAndPassword: { enabled: false },
      plugins: [{ id: 'magicLink' }],
    });
    expect(screen.getByText(localization.settings.changeEmail)).toBeTruthy();
    view.unmount();

    renderWithAuth(<AccountSettings />, makeClient(), {
      emailAndPassword: { enabled: false },
      plugins: [
        {
          id: 'fake-otp',
          cardOverrides: { account: { changeEmail: () => <p>OTP email change</p> } },
        },
        { id: 'fake-cards', accountCards: [() => <p>Extra card</p>] },
      ],
    });
    expect(screen.getByText('OTP email change')).toBeTruthy();
    expect(screen.getByText('Extra card')).toBeTruthy();
  });
});

describe('Settings', () => {
  it('requires a view or path and rejects unknown paths', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => renderWithAuth(<Settings />)).toThrow('Either `view` or `path` must be provided');
    expect(() => renderWithAuth(<Settings path="nope" />)).toThrow('Unknown settings path "nope"');
    consoleSpy.mockRestore();
  });

  it('renders the account view and navigates between tabs', async () => {
    const user = userEvent.setup();
    const { navigate } = renderWithAuth(<Settings view="account" />, makeClient(), {
      plugins: [
        {
          id: 'fake-tab',
          viewPaths: { settings: { billing: 'billing' } },
          settingsTabs: [
            { view: 'billing', label: 'Billing', component: () => <p>Billing panel</p> },
          ],
        },
      ],
    });

    expect(screen.getByRole('tablist', { name: localization.settings.settings })).toBeTruthy();
    expect(screen.getByText(localization.settings.userProfile)).toBeTruthy();

    await user.click(screen.getByRole('tab', { name: localization.settings.security }));
    expect(navigate).toHaveBeenCalledWith({ to: '/settings/security' });
    await user.click(screen.getByRole('tab', { name: localization.settings.account }));
    expect(navigate).toHaveBeenCalledWith({ to: '/settings/account' });
    await user.click(screen.getByRole('tab', { name: 'Billing' }));
    expect(navigate).toHaveBeenCalledWith({ to: '/settings/billing' });
  });

  it('resolves plugin and security paths', async () => {
    const plugins = [
      {
        id: 'fake-tab',
        viewPaths: { settings: { billing: 'billing' } },
        settingsTabs: [
          { view: 'billing', label: 'Billing', component: () => <p>Billing panel</p> },
        ],
      },
    ];
    const { view } = renderWithAuth(<Settings path="billing" hideNav />, makeClient(), { plugins });
    expect(screen.getByText('Billing panel')).toBeTruthy();
    expect(view.container.querySelector('.hidden [role="tablist"]')).toBeTruthy();
    view.unmount();

    renderWithAuth(<Settings path="security" />);
    expect(await screen.findByText(localization.settings.activeSessions)).toBeTruthy();
  });

  it('sends a signed-out visitor to sign-in', async () => {
    window.history.replaceState(null, '', '/settings/account');
    const { navigate } = renderWithAuth(<Settings view="account" />, makeClient({}, null));

    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith({
        to: '/auth/sign-in?redirectTo=%2Fsettings%2Faccount',
        replace: true,
      }),
    );
  });
});
