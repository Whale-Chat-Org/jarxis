import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useNavigationPermissions } from '@/components/admin/use-navigation-permissions';

const nav = vi.hoisted(() => ({ pathname: '/admin', replace: vi.fn() }));
const router = { replace: nav.replace };
vi.mock('next/navigation', () => ({ usePathname: () => nav.pathname, useRouter: () => router }));
const fetchMock = vi.fn();

beforeEach(() => {
  nav.pathname = '/admin';
  nav.replace.mockReset();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

function mount() {
  const client = new QueryClient();
  return renderHook(() => useNavigationPermissions(['dashboard:read']), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
}
const reply = (permissions: string[]) => Response.json({ permissions });

describe('navigation permissions', () => {
  it('uses initial grants, refreshes on navigation and refreshes again on a return visit', async () => {
    const hook = mount();
    expect(hook.result.current).toEqual(['dashboard:read']);
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockResolvedValueOnce(reply(['audit:read']));
    nav.pathname = '/admin/audit';
    hook.rerender();
    expect(hook.result.current).toEqual([]);
    await waitFor(() => expect(hook.result.current).toEqual(['audit:read']));
    fetchMock.mockResolvedValueOnce(reply([]));
    nav.pathname = '/admin';
    hook.rerender();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(hook.result.current).toEqual([]));
  });

  it('ignores a previous navigation response when requests finish out of order', async () => {
    let finishOld!: (value: Response) => void;
    fetchMock.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          finishOld = resolve;
        }),
    );
    const hook = mount();
    nav.pathname = '/admin/users';
    hook.rerender();
    fetchMock.mockResolvedValueOnce(reply(['roles:read']));
    nav.pathname = '/admin/roles';
    hook.rerender();
    await waitFor(() => expect(hook.result.current).toEqual(['roles:read']));
    await act(async () => finishOld(reply(['users:read', 'user:list'])));
    expect(hook.result.current).toEqual(['roles:read']);
  });

  it.each([401, 403, 503])('hides protected links after a %s refresh failure', async (status) => {
    fetchMock.mockResolvedValueOnce(Response.json({ error: { code: 'UNAVAILABLE' } }, { status }));
    const hook = mount();
    nav.pathname = '/admin/audit';
    hook.rerender();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(hook.result.current).toEqual([]);
    if (status === 401)
      await waitFor(() => expect(nav.replace).toHaveBeenCalledWith('/auth/sign-in'));
    else expect(nav.replace).not.toHaveBeenCalled();
  });
});
