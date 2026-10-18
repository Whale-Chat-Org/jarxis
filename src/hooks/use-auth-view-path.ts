'use client';

import { useAuth } from '@better-auth-ui/react';
import { useCallback } from 'react';

type AuthViewKey = keyof ReturnType<typeof useAuth>['viewPaths']['auth'];

/** Returns a resolver from an auth view key to its full path, e.g. `signIn` → `/auth/sign-in`. */
export function useAuthViewPath() {
  const { basePaths, viewPaths } = useAuth();

  return useCallback(
    (view: AuthViewKey) => `${basePaths.auth}/${viewPaths.auth[view]}`,
    [basePaths.auth, viewPaths.auth],
  );
}
