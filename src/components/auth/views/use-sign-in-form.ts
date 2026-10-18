'use client';

import { useAuth, useFetchOptions, useSignInEmail } from '@better-auth-ui/react';

import { useAuthForm } from '@/components/auth/form/auth-form';
import { useAuthViewPath } from '@/hooks/use-auth-view-path';
import { inlineFormErrors } from '@/lib/api-client';
import { VERIFY_EMAIL_STORAGE_KEY } from '@/lib/auth/auth-storage';
import { useSignInContinuation } from '@/lib/auth/use-sign-in-continuation';

/**
 * Email/password sign-in form state. An unverified address is stored for the
 * verify-email view and redirected there; success continues the sign-in flow.
 */
export function useSignInForm() {
  const { authClient, emailAndPassword, navigate } = useAuth();
  const authViewPath = useAuthViewPath();
  const { fetchOptions, resetFetchOptions } = useFetchOptions();
  const continueSignIn = useSignInContinuation();

  const { mutateAsync: signInEmail, isPending } = useSignInEmail(authClient, {
    ...inlineFormErrors,
    onError: (error, { email }) => {
      if (error.error?.code === 'EMAIL_NOT_VERIFIED') {
        sessionStorage.setItem(VERIFY_EMAIL_STORAGE_KEY, email);
        navigate({ to: authViewPath('verifyEmail') });
      }

      resetFetchOptions();
    },
    onSuccess: (data) => continueSignIn(data),
  });

  const form = useAuthForm({
    defaultValues: { email: '', password: '', rememberMe: false },
    onSubmit: async ({ value }) =>
      await signInEmail({
        email: value.email,
        password: value.password,
        ...(emailAndPassword?.rememberMe ? { rememberMe: value.rememberMe } : {}),
        fetchOptions,
      }),
  });

  return { form, isSigningIn: isPending };
}
