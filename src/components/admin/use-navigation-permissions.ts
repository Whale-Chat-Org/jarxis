'use client';

import { useQuery } from '@tanstack/react-query';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useId, useState } from 'react';

import { grantsResponseSchema } from '@/lib/admin-contracts';
import { ApiRequestError, apiRequest } from '@/lib/api-client';

export function useNavigationPermissions(initialPermissions: string[]) {
  const pathname = usePathname();
  const router = useRouter();
  const scope = useId();
  const [navigation, setNavigation] = useState({ pathname, revision: 0 });
  // Each visit gets its own query, including a return to an already visited path.
  const current =
    navigation.pathname === pathname ? navigation : { pathname, revision: navigation.revision + 1 };
  if (current !== navigation) setNavigation(current);

  const query = useQuery({
    queryKey: ['admin-navigation-grants', scope, pathname, current.revision],
    queryFn: ({ signal }) => apiRequest('/api/admin/grants', grantsResponseSchema, { signal }),
    initialData: current.revision === 0 ? { permissions: initialPermissions } : undefined,
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
  });
  useEffect(() => {
    if (query.error instanceof ApiRequestError && query.error.status === 401)
      router.replace('/auth/sign-in');
  }, [query.error, router]);

  return query.isError || query.isFetching ? [] : (query.data?.permissions ?? []);
}
