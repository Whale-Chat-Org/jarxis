'use client';

import {
  getAdditionalFieldDefaultValues,
  getAdditionalFieldSubmitValues,
  getAuthLinkURL,
} from '@better-auth-ui/core';
import { useAuth, useFetchOptions, useSignUpEmail } from '@better-auth-ui/react';
import { useMemo } from 'react';

import { useAuthForm } from '@/components/auth/form/auth-form';
import { useAuthViewPath } from '@/hooks/use-auth-view-path';
import { useCompromisedPassword } from '@/hooks/use-compromised-password';
import { inlineFormErrors } from '@/lib/api-client';
import { VERIFY_EMAIL_STORAGE_KEY } from '@/lib/auth/auth-storage';

/**
 * Email/password sign-up form state. Email verification takes priority over
 * `onSignUpSuccess`, which in turn replaces the default redirect.
 */
export function useSignUpForm(onSignUpSuccess?: () => void) {
  const { additionalFields, authClient, emailAndPassword, navigate, redirectTo } = useAuth();
  const authViewPath = useAuthViewPath();
  const { fetchOptions, resetFetchOptions } = useFetchOptions();
  const compromised = useCompromisedPassword();

  const signUpFields = useMemo(
    () => additionalFields?.filter((field) => field.signUp) ?? [],
    [additionalFields],
  );

  const { mutateAsync: signUpEmail } = useSignUpEmail(authClient, {
    ...inlineFormErrors,
    onError: (error) => {
      compromised.flag(error);
      resetFetchOptions();
    },
    onSuccess: (_data, { email }) => {
      if (emailAndPassword?.requireEmailVerification) {
        sessionStorage.setItem(VERIFY_EMAIL_STORAGE_KEY, email);
        navigate({ to: getAuthLinkURL(authViewPath('verifyEmail'), redirectTo) });
      } else if (onSignUpSuccess) {
        onSignUpSuccess();
      } else {
        navigate({ to: redirectTo });
      }
    },
  });

  const form = useAuthForm({
    defaultValues: {
      additionalFields: getAdditionalFieldDefaultValues(signUpFields),
      confirmPassword: '',
      email: '',
      name: '',
      password: '',
    },
    onSubmit: async ({ value }) =>
      await signUpEmail({
        name: emailAndPassword?.name === false ? '' : value.name,
        email: value.email.trim(),
        password: value.password,
        ...getAdditionalFieldSubmitValues(signUpFields, value.additionalFields),
        fetchOptions,
      }),
  });

  return { form, signUpFields, compromised };
}
