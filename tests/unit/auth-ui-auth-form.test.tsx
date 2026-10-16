import type { AdditionalField } from '@better-auth-ui/core';
import { QueryClient } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  focusFirstInvalidAuthFormControl,
  getAuthAdditionalFieldValidators,
  isAuthFormFieldInvalid,
  runAuthFormAction,
  useAuthForm,
} from '@/components/auth/auth-form';
import { AuthProvider } from '@/components/auth/auth-provider';
import { markActionErrorHandled } from '@/lib/action-errors';

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }));
vi.mock('sonner', () => ({ toast: toastMock }));

function TestLink({ href, children }: { href: string; children?: ReactNode }) {
  return <a href={href}>{children}</a>;
}

function withAuth(ui: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <AuthProvider
      authClient={{ getSession: vi.fn(async () => null) } as never}
      navigate={vi.fn()}
      Link={TestLink}
      queryClient={queryClient}
    >
      {ui}
    </AuthProvider>,
  );
}

type HarnessProps = {
  onSubmit?: (value: { title: string; extra: string | null }) => unknown;
  action?: () => Promise<unknown>;
  onActionResult?: (ok: boolean) => void;
  onBeforeSubmit?: () => void;
  onInput?: () => void;
  extraField?: AdditionalField;
  isPending?: boolean;
};

function Harness({
  onSubmit = () => undefined,
  action = async () => undefined,
  onActionResult = () => undefined,
  onBeforeSubmit,
  onInput,
  extraField = { name: 'extra', type: 'string', label: 'Extra' },
  isPending,
}: HarnessProps) {
  const form = useAuthForm({
    defaultValues: { title: '', extra: null as string | null },
    onSubmit: async ({ value }) => {
      await onSubmit(value);
    },
  });

  return (
    <form.AppForm>
      <form.AuthFormRoot
        aria-label="harness"
        serverErrorMessage="Fallback failure"
        onBeforeSubmit={onBeforeSubmit}
        onInput={onInput}
      >
        <form.AppField
          name="title"
          validators={{ onChange: ({ value }) => (value ? undefined : 'Title needed') }}
        >
          {(field) => <field.AuthFormTextField label="Title" description="Shown to everyone" />}
        </form.AppField>
        <form.AppField
          name="extra"
          validators={getAuthAdditionalFieldValidators(extraField, 'Required!')}
        >
          {(field) => <field.AuthFormAdditionalField field={extraField} />}
        </form.AppField>
        <select aria-label="picker" name="picker" defaultValue="a">
          <option value="a">A</option>
          <option value="b">B</option>
        </select>
        <form.AuthFormServerError />
        <form.AuthFormSubmitButton isPending={isPending}>Save</form.AuthFormSubmitButton>
        <button
          type="button"
          onClick={async () =>
            onActionResult(await runAuthFormAction(form, action, 'Action failed'))
          }
        >
          Run action
        </button>
      </form.AuthFormRoot>
    </form.AppForm>
  );
}

const formElement = () => screen.getByRole('form', { name: 'harness' }) as HTMLFormElement;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('auth form primitives', () => {
  it('renders a labelled text field with its description and field errors', async () => {
    const onSubmit = vi.fn();
    withAuth(<Harness onSubmit={onSubmit} />);

    expect(screen.getByText('Shown to everyone')).toBeTruthy();
    fireEvent.submit(formElement());

    expect(await screen.findByText('Title needed')).toBeTruthy();
    expect(screen.getByLabelText('Title').getAttribute('aria-invalid')).toBe('true');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('submits valid values and calls onBeforeSubmit', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const onBeforeSubmit = vi.fn();
    withAuth(<Harness onSubmit={onSubmit} onBeforeSubmit={onBeforeSubmit} />);

    await user.type(screen.getByLabelText('Title'), 'Hello');
    await user.type(screen.getByLabelText('Extra'), 'More');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({ title: 'Hello', extra: 'More' }));
    expect(onBeforeSubmit).toHaveBeenCalledTimes(1);
  });

  it('shows the fallback inline server error for an unknown failure and clears it on input', async () => {
    const user = userEvent.setup();
    const onInput = vi.fn();
    withAuth(
      <Harness
        onInput={onInput}
        onSubmit={() => {
          throw new Error('raw server text that must not be shown');
        }}
      />,
    );

    await user.type(screen.getByLabelText('Title'), 'Hello');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Fallback failure')).toBeTruthy();
    expect(screen.queryByText('raw server text that must not be shown')).toBeNull();

    await user.type(screen.getByLabelText('Title'), '!');
    await waitFor(() => expect(screen.queryByText('Fallback failure')).toBeNull());
    expect(onInput).toHaveBeenCalled();
  });

  it('maps allowlisted statuses to safe copy', async () => {
    const user = userEvent.setup();
    withAuth(
      <Harness
        onSubmit={() => {
          throw Object.assign(new Error('nope'), { status: 429 });
        }}
      />,
    );

    await user.type(screen.getByLabelText('Title'), 'Hello');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Too many attempts. Wait a moment and try again.')).toBeTruthy();
  });

  it('does not add an inline error for failures already surfaced elsewhere', async () => {
    const user = userEvent.setup();
    const handled = new Error('handled');
    markActionErrorHandled(handled);
    const results: boolean[] = [];
    withAuth(
      <Harness
        onSubmit={() => {
          throw handled;
        }}
        action={async () => {
          throw Object.assign(new Error('x'), { error: { code: 'EMAIL_NOT_VERIFIED' } });
        }}
        onActionResult={(ok) => results.push(ok)}
      />,
    );

    await user.type(screen.getByLabelText('Title'), 'Hello');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await user.click(screen.getByRole('button', { name: 'Run action' }));

    await waitFor(() => expect(results).toEqual([false]));
    expect(screen.queryByText('Fallback failure')).toBeNull();
    expect(screen.queryByText('Action failed')).toBeNull();
  });

  it('runAuthFormAction reports success and failure', async () => {
    const user = userEvent.setup();
    const results: boolean[] = [];
    let shouldFail = false;
    withAuth(
      <Harness
        action={async () => {
          if (shouldFail) throw new Error('boom');
        }}
        onActionResult={(ok) => results.push(ok)}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Run action' }));
    shouldFail = true;
    await user.click(screen.getByRole('button', { name: 'Run action' }));

    await waitFor(() => expect(results).toEqual([true, false]));
    expect(await screen.findByText('Action failed')).toBeTruthy();

    // Changing a non-auth control clears the form-level server error too.
    fireEvent.input(screen.getByLabelText('picker'), { target: { value: 'b' } });
    await waitFor(() => expect(screen.queryByText('Action failed')).toBeNull());
  });

  it('disables the submit button and shows a spinner while pending', () => {
    withAuth(<Harness isPending />);

    const button = screen.getByRole('button', { name: /Save/ }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(button.querySelector('[data-icon="inline-start"]')).toBeTruthy();
  });

  it('runs required and async validators for additional fields', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      const validate = vi.fn(async (value: unknown) => {
        if (value === 'taken') throw new Error('Already taken');
      });
      withAuth(
        <Harness
          extraField={{
            name: 'extra',
            type: 'string',
            label: 'Extra',
            required: true,
            validate,
            validateDebounceMs: 10,
          }}
        />,
      );

      await user.type(screen.getByLabelText('Extra'), 'taken');
      await act(async () => {
        await vi.advanceTimersByTimeAsync(50);
      });
      expect(await screen.findByText('Already taken')).toBeTruthy();

      await user.clear(screen.getByLabelText('Extra'));
      expect(await screen.findByText('Required!')).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('auth form helpers', () => {
  it('isAuthFormFieldInvalid needs both touched and invalid', () => {
    expect(isAuthFormFieldInvalid({ isTouched: true, isValid: false })).toBe(true);
    expect(isAuthFormFieldInvalid({ isTouched: false, isValid: false })).toBe(false);
    expect(isAuthFormFieldInvalid({ isTouched: true, isValid: true })).toBe(false);
  });

  it('getAuthAdditionalFieldValidators uses the default debounce and skips async without validate', async () => {
    const plain = getAuthAdditionalFieldValidators(
      { name: 'a', type: 'string', label: 'A', required: true },
      'Req',
    );
    expect(plain.onChangeAsync).toBeUndefined();
    expect(plain.onChangeAsyncDebounceMs).toBeUndefined();
    expect(plain.onChange({ value: null })).toBe('Req');
    expect(plain.onChange({ value: 'x' })).toBeUndefined();

    const validated = getAuthAdditionalFieldValidators(
      { name: 'a', type: 'string', label: 'A', validate: () => undefined },
      'Req',
    );
    expect(validated.onChangeAsyncDebounceMs).toBe(300);
    await expect(validated.onChangeAsync?.({ value: 'x' })).resolves.toBeUndefined();
  });

  it('focusFirstInvalidAuthFormControl focuses the first invalid enabled control', () => {
    const rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0);
      return 0;
    });
    const form = document.createElement('form');
    form.innerHTML =
      '<input id="ok" /><input id="disabled" aria-invalid="true" disabled /><input id="bad" aria-invalid="true" />';
    document.body.append(form);

    focusFirstInvalidAuthFormControl(form);

    expect(document.activeElement?.id).toBe('bad');
    form.remove();
    rafSpy.mockRestore();
  });
});
