'use client';

import { createFormHook } from '@tanstack/react-form';

import { AuthFormAdditionalField } from './auth-form-additional-field';
import { AuthFormCheckboxField } from './auth-form-checkbox-field';
import { fieldContext, formContext } from './auth-form-context';
import { AuthFormFieldError } from './auth-form-field-error';
import { AuthFormPasswordField } from './auth-form-password-field';
import { AuthFormRoot } from './auth-form-root';
import { AuthFormServerError } from './auth-form-server-error';
import { AuthFormSubmitButton } from './auth-form-submit-button';
import { AuthFormTextField } from './auth-form-text-field';

/**
 * TanStack Form hook preloaded with the auth field and form components, so
 * every auth and settings form renders fields and errors the same way.
 */
export const { useAppForm: useAuthForm, withFieldGroup: withAuthFieldGroup } = createFormHook({
  fieldComponents: {
    AuthFormAdditionalField,
    AuthFormCheckboxField,
    AuthFormFieldError,
    AuthFormPasswordField,
    AuthFormTextField,
  },
  fieldContext,
  formComponents: {
    AuthFormRoot,
    AuthFormServerError,
    AuthFormSubmitButton,
  },
  formContext,
});
