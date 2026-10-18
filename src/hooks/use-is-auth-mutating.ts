'use client';

import { authMutationKeys } from '@better-auth-ui/core';
import { useIsMutating } from '@tanstack/react-query';

/** Whether any sign-in or sign-up request is in flight, so both forms lock together. */
export function useIsAuthMutating() {
  const signInMutating = useIsMutating({ mutationKey: authMutationKeys.signIn.all });
  const signUpMutating = useIsMutating({ mutationKey: authMutationKeys.signUp.all });
  return signInMutating + signUpMutating > 0;
}
