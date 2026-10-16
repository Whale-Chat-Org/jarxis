import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  useAuth: vi.fn(),
  createAuthClient: vi.fn((options: unknown) => ({ options })),
  adminClient: vi.fn(() => 'admin-client-plugin'),
}));
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  useCallback: <T>(fn: T) => fn,
}));
vi.mock('@better-auth-ui/react', () => ({ useAuth: m.useAuth }));
vi.mock('better-auth/react', () => ({ createAuthClient: m.createAuthClient }));
vi.mock('better-auth/client/plugins', () => ({ adminClient: m.adminClient }));
vi.mock('@/components/auth/admin/stop-impersonating', () => ({
  StopImpersonating: 'StopImpersonating',
}));
vi.mock('@/components/auth/theme/appearance', () => ({ Appearance: 'Appearance' }));
vi.mock('@/components/auth/theme/theme-toggle-item', () => ({
  ThemeToggleItem: 'ThemeToggleItem',
}));

const twoFactor = await import('@/lib/auth/two-factor-methods');
const { useSignInContinuation } = await import('@/lib/auth/use-sign-in-continuation');
const { themePlugin } = await import('@/lib/auth/theme-plugin');
const { adminPlugin } = await import('@/lib/auth/admin-plugin');
const { authClient } = await import('@/lib/auth-client');

function fakeStorage() {
  const store = new Map<string, string>();
  return {
    store,
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => void store.set(key, value)),
    removeItem: vi.fn((key: string) => void store.delete(key)),
  };
}
const KEY = twoFactor.TWO_FACTOR_METHODS_STORAGE_KEY;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('two-factor method helpers', () => {
  it('detects only an explicit two-factor redirect', () => {
    expect(twoFactor.isTwoFactorRedirect({ twoFactorRedirect: true })).toBe(true);
    expect(twoFactor.isTwoFactorRedirect({ twoFactorRedirect: 'true' })).toBe(false);
    expect(twoFactor.isTwoFactorRedirect(null)).toBe(false);
    expect(twoFactor.isTwoFactorRedirect('x')).toBe(false);
  });

  it('narrows methods to supported names', () => {
    expect(twoFactor.parseTwoFactorMethods(['otp', 'sms', 'totp'])).toEqual(['totp', 'otp']);
    expect(twoFactor.parseTwoFactorMethods('totp')).toEqual([]);
    expect(twoFactor.parseTwoFactorMethods()).toEqual([]);
  });

  it('is a no-op without sessionStorage and falls back to every method', () => {
    vi.stubGlobal('sessionStorage', undefined);
    expect(() => twoFactor.storeTwoFactorMethods(['totp'])).not.toThrow();
    expect(twoFactor.readTwoFactorMethods()).toEqual(['totp', 'otp']);
    expect(() => twoFactor.clearTwoFactorMethods()).not.toThrow();
  });

  it('stores only method names and reads them back', () => {
    const storage = fakeStorage();
    vi.stubGlobal('sessionStorage', storage);
    twoFactor.storeTwoFactorMethods(['otp', 'secret-code-123']);
    expect(storage.store.get(KEY)).toBe('["otp"]');
    expect(twoFactor.readTwoFactorMethods()).toEqual(['otp']);
    twoFactor.clearTwoFactorMethods();
    expect(storage.store.has(KEY)).toBe(false);
    expect(twoFactor.readTwoFactorMethods()).toEqual(['totp', 'otp']);
  });

  it('falls back to every method for empty or corrupt storage', () => {
    const storage = fakeStorage();
    vi.stubGlobal('sessionStorage', storage);
    storage.store.set(KEY, '[]');
    expect(twoFactor.readTwoFactorMethods()).toEqual(['totp', 'otp']);
    storage.store.set(KEY, '{not json');
    expect(twoFactor.readTwoFactorMethods()).toEqual(['totp', 'otp']);
  });

  it('swallows storage errors', () => {
    const fail = () => {
      throw new Error('quota');
    };
    vi.stubGlobal('sessionStorage', { getItem: fail, setItem: fail, removeItem: fail });
    expect(() => twoFactor.storeTwoFactorMethods(['totp'])).not.toThrow();
    expect(twoFactor.readTwoFactorMethods()).toEqual(['totp', 'otp']);
    expect(() => twoFactor.clearTwoFactorMethods()).not.toThrow();
  });
});

describe('useSignInContinuation', () => {
  const navigate = vi.fn();
  const auth = (plugins: unknown[]) =>
    m.useAuth.mockReturnValue({
      basePaths: { auth: '/auth' },
      navigate,
      plugins,
      redirectTo: '/admin?tab=1',
    });

  beforeEach(() => {
    navigate.mockReset();
    vi.stubGlobal('sessionStorage', fakeStorage());
  });

  it('routes a two-factor redirect to the challenge with the original destination', () => {
    auth([{ id: 'twoFactor', viewPaths: { auth: { twoFactor: 'two-factor' } } }]);
    useSignInContinuation()({ twoFactorRedirect: true, twoFactorMethods: ['totp'] });
    expect(navigate).toHaveBeenCalledWith({ to: '/auth/two-factor?redirectTo=%2Fadmin%3Ftab%3D1' });
    expect(sessionStorage.getItem(KEY)).toBe('["totp"]');
  });

  it('navigates to the destination for a completed sign-in', () => {
    auth([{ id: 'twoFactor', viewPaths: { auth: { twoFactor: 'two-factor' } } }]);
    useSignInContinuation()({ user: { id: 'u1' } });
    expect(navigate).toHaveBeenCalledWith({ to: '/admin?tab=1' });
  });

  it('does not route to a challenge when the two-factor plugin is absent', () => {
    auth([{ id: 'other' }, { id: 'twoFactor' }]);
    useSignInContinuation()({ twoFactorRedirect: true });
    expect(navigate).toHaveBeenCalledWith({ to: '/admin?tab=1' });
  });
});

describe('Better Auth UI plugins and client', () => {
  it('wraps the core theme plugin with a static theme', () => {
    const setTheme = vi.fn();
    const plugin = themePlugin({ theme: 'dark', setTheme });
    expect(plugin.id).toBe(themePlugin.id);
    expect(plugin.userMenuItems).toEqual(['ThemeToggleItem']);
    expect(plugin.accountCards).toEqual(['Appearance']);
    const live = plugin.useTheme();
    expect(live.theme).toBe('dark');
    live.setTheme('light');
    expect(setTheme).toHaveBeenCalledWith('light');
  });

  it('uses a supplied theme hook as-is', () => {
    const useTheme = () => ({ theme: 'light', setTheme: () => {} });
    const plugin = themePlugin({ useTheme });
    expect(plugin.useTheme).toBe(useTheme);
    // The no-op baseline setter keeps the core plugin satisfied.
    expect(() => plugin.setTheme('dark')).not.toThrow();
  });

  it('adds the stop-impersonating menu item to the admin plugin', () => {
    const plugin = adminPlugin();
    expect(plugin.id).toBe(adminPlugin.id);
    expect(plugin.userMenuItems).toEqual(['StopImpersonating']);
    expect(adminPlugin({}).userMenuItems).toEqual(['StopImpersonating']);
  });

  it('creates the auth client with the admin plugin', () => {
    expect(authClient).toEqual({ options: { plugins: ['admin-client-plugin'] } });
  });
});
