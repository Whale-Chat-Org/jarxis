import { render, screen } from '@testing-library/react';
import type * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type AuthProps = {
  navigate: (args: { to: string; replace?: boolean }) => void;
  plugins: unknown[];
  avatar: { upload: (file: File) => Promise<string>; delete: (url: string) => Promise<void> };
  children: React.ReactNode;
};

const mocks = vi.hoisted(() => ({
  authProps: null as unknown,
  router: { push: vi.fn(), replace: vi.fn() },
}));

vi.mock('next/link', () => ({ default: () => null }));
vi.mock('next/navigation', () => ({ useRouter: () => mocks.router }));
vi.mock('@/lib/auth-client', () => ({ authClient: { id: 'client' } }));
vi.mock('@/lib/auth/admin-plugin', () => ({
  adminPlugin: (options: unknown) => ({ id: 'admin', options }),
}));
vi.mock('@/lib/auth/theme-plugin', () => ({
  themePlugin: (options: unknown) => ({ id: 'theme', options }),
}));
vi.mock('@/lib/permissions', () => ({
  roleNames: ['user'],
  defaultRole: 'user',
  adminRoles: ['owner'],
}));
vi.mock('@/components/auth/provider/auth-provider', () => ({
  AuthProvider: (props: AuthProps) => {
    mocks.authProps = props;
    return <>{props.children}</>;
  },
}));

import { Providers } from '@/components/providers';

const auth = () => mocks.authProps as AuthProps;
const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  mocks.router.push.mockReset();
  mocks.router.replace.mockReset();
  render(
    <Providers>
      <p>App content</p>
    </Providers>,
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Providers', () => {
  it('renders children with theme and admin plugins', () => {
    expect(screen.getByText('App content')).toBeTruthy();
    expect(auth().plugins.map((plugin) => (plugin as { id: string }).id)).toEqual([
      'theme',
      'admin',
    ]);
  });

  it('navigates with push or replace', () => {
    auth().navigate({ to: '/a' });
    expect(mocks.router.push).toHaveBeenCalledWith('/a');
    auth().navigate({ to: '/b', replace: true });
    expect(mocks.router.replace).toHaveBeenCalledWith('/b');
  });

  it('uploads an avatar and returns its URL', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ url: '/api/x' }), { status: 200 }));
    const file = new File(['img'], 'a.png', { type: 'image/png' });
    await expect(auth().avatar.upload(file)).resolves.toBe('/api/x');
    expect(fetchMock).toHaveBeenCalledWith('/api/profile/avatar', {
      method: 'POST',
      headers: { 'Content-Type': 'image/png' },
      body: file,
    });
  });

  it('rejects failed or malformed uploads', async () => {
    const file = new File(['img'], 'a.png', { type: 'image/png' });
    fetchMock.mockResolvedValueOnce(new Response('no', { status: 500 }));
    await expect(auth().avatar.upload(file)).rejects.toThrow('Avatar upload failed');
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ url: 1 }), { status: 200 }));
    await expect(auth().avatar.upload(file)).rejects.toThrow('invalid URL');
  });

  it('deletes only same-origin avatar URLs', async () => {
    const id = '0f8fad5b-d9cb-469f-a165-70867728950e';
    await auth().avatar.delete('https://evil.example/api/profile/avatar/u/' + id);
    await auth().avatar.delete('/api/other/path');
    expect(fetchMock).not.toHaveBeenCalled();

    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await auth().avatar.delete(`/api/profile/avatar/user-1/${id}`);
    expect(fetchMock).toHaveBeenCalledWith(`/api/profile/avatar/user-1/${id}`, {
      method: 'DELETE',
    });

    fetchMock.mockResolvedValueOnce(new Response(null, { status: 500 }));
    await expect(auth().avatar.delete(`/api/profile/avatar/user-1/${id}`)).rejects.toThrow(
      'Avatar deletion failed',
    );
  });
});
