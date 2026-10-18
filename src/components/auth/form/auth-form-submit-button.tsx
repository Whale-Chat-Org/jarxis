'use client';

import type { ComponentProps } from 'react';

import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { useFormContext } from './auth-form-context';

type AuthFormSubmitButtonProps = ComponentProps<typeof Button> & { isPending?: boolean };

/** Submit button that locks and shows a spinner while the form submits or validates. */
export function AuthFormSubmitButton({
  children,
  disabled,
  isPending,
  ...props
}: AuthFormSubmitButtonProps) {
  const form = useFormContext();

  return (
    <form.Subscribe selector={(state) => [state.isSubmitting, state.isValidating] as const}>
      {([isSubmitting, isValidating]) => (
        <Button
          {...props}
          aria-busy={isPending || isSubmitting || undefined}
          aria-disabled={disabled || isPending || isSubmitting || isValidating || undefined}
          disabled={disabled || isPending || isSubmitting || isValidating}
          type="submit"
        >
          {isPending || isSubmitting ? <Spinner data-icon="inline-start" /> : null}
          {children}
        </Button>
      )}
    </form.Subscribe>
  );
}
