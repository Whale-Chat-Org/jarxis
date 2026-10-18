import {
  type AdditionalField,
  type AdditionalFieldFormValue,
  DEFAULT_ADDITIONAL_FIELD_VALIDATION_DEBOUNCE_MS,
  getAuthErrorCode,
  isPasswordCompromisedError,
  validateAdditionalFieldRequired,
  validateAdditionalFieldValue,
} from '@better-auth-ui/core';
import type { AnyFormApi } from '@tanstack/react-form';

import { isActionErrorHandled, safeActionErrorMessage } from '@/lib/action-errors';

export const DEFAULT_AUTH_FORM_SERVER_ERROR = 'Unable to submit this form. Try again.';

export function isAuthFormFieldInvalid({
  isTouched,
  isValid,
}: {
  isTouched: boolean;
  isValid: boolean;
}) {
  return isTouched && !isValid;
}

export function focusFirstInvalidAuthFormControl(form: HTMLFormElement) {
  requestAnimationFrame(() => {
    form
      .querySelector<HTMLElement>('[aria-invalid="true"]:not([disabled]), :invalid:not([disabled])')
      ?.focus();
  });
}

export function setAuthFormServerError(form: AnyFormApi, error: unknown, fallbackMessage: string) {
  // Only surface allowlisted, safe copy at the form level. The server message and any
  // server-provided field errors are never reflected back into the UI; per-field validation stays
  // the responsibility of the form's own client-side validators.
  form.setErrorMap({
    onServer: {
      fields: {},
      form: safeActionErrorMessage(error, fallbackMessage),
    },
  });
}

export function clearAuthFormFieldServerError(form: AnyFormApi, fieldName: string) {
  form.setErrorMap({ onServer: undefined });
  if (!fieldName) return;

  const fieldMeta = form.getFieldMeta(fieldName as never);
  if (!fieldMeta?.errorMap.onServer) return;

  form.setFieldMeta(fieldName as never, (current = fieldMeta) => ({
    ...current,
    errorMap: { ...current.errorMap, onServer: undefined },
    errorSourceMap: { ...current.errorSourceMap, onServer: undefined },
  }));
}

/**
 * Errors that another surface already owns, so adding an inline form error would duplicate them:
 * failures the global toaster has flagged as handled, compromised-password errors (rendered against
 * the password field), and unverified-email errors (handled by the verification flow).
 */
function shouldSuppressInlineAuthError(error: unknown) {
  return (
    isActionErrorHandled(error) ||
    isPasswordCompromisedError(error) ||
    getAuthErrorCode(error) === 'EMAIL_NOT_VERIFIED'
  );
}

/** Submits the form and maps an unexpected failure to safe form-level copy. Resolves validity. */
export async function submitAuthForm(form: AnyFormApi, serverErrorMessage: string) {
  form.setErrorMap({ onServer: { fields: {} } });
  try {
    await form.handleSubmit();
    return form.state.isValid;
  } catch (error) {
    if (!form.state.errorMap.onServer && !shouldSuppressInlineAuthError(error)) {
      setAuthFormServerError(form, error, serverErrorMessage);
    }
    return false;
  }
}

export function getAuthAdditionalFieldValidators(field: AdditionalField, requiredMessage: string) {
  return {
    onChange: ({ value }: { value: AdditionalFieldFormValue }) =>
      validateAdditionalFieldRequired(field, value, requiredMessage),
    onChangeAsync: field.validate
      ? ({ value }: { value: AdditionalFieldFormValue }) =>
          validateAdditionalFieldValue(field, value)
      : undefined,
    onChangeAsyncDebounceMs: field.validate
      ? (field.validateDebounceMs ?? DEFAULT_ADDITIONAL_FIELD_VALIDATION_DEBOUNCE_MS)
      : undefined,
  };
}
