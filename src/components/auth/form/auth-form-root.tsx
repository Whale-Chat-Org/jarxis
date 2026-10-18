'use client';

import { type ComponentProps, type FormEvent, useRef } from 'react';

import {
  clearAuthFormFieldServerError,
  DEFAULT_AUTH_FORM_SERVER_ERROR,
  focusFirstInvalidAuthFormControl,
  submitAuthForm,
} from '@/lib/auth/auth-form-utils';
import { useFormContext } from './auth-form-context';

type AuthFormRootProps = Omit<ComponentProps<'form'>, 'onSubmit'> & {
  onBeforeSubmit?: () => void;
  serverErrorMessage?: string;
};

function getInputName(target: EventTarget) {
  return target instanceof HTMLInputElement ||
    target instanceof HTMLSelectElement ||
    target instanceof HTMLTextAreaElement
    ? target.name
    : '';
}

/** `<form>` that submits once at a time, focuses the first invalid control and clears stale server errors on input. */
export function AuthFormRoot({
  children,
  onBeforeSubmit,
  onInput,
  serverErrorMessage = DEFAULT_AUTH_FORM_SERVER_ERROR,
  ...props
}: AuthFormRootProps) {
  const form = useFormContext();
  const submittingRef = useRef(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submittingRef.current || form.state.isSubmitting) return;

    const formElement = event.currentTarget;
    onBeforeSubmit?.();
    submittingRef.current = true;
    try {
      const isValid = await submitAuthForm(form, serverErrorMessage);
      if (!isValid) focusFirstInvalidAuthFormControl(formElement);
    } finally {
      submittingRef.current = false;
    }
  }

  return (
    <form
      {...props}
      onInvalid={(event) => focusFirstInvalidAuthFormControl(event.currentTarget)}
      onInput={(event) => {
        clearAuthFormFieldServerError(form, getInputName(event.target));
        onInput?.(event);
      }}
      onSubmit={submit}
    >
      {children}
    </form>
  );
}
