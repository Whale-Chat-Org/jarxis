import type {
  AdditionalField as AdditionalFieldConfig,
  AdditionalFieldFormValue,
} from '@better-auth-ui/core';
import { localization } from '@better-auth-ui/core';
import { QueryClient } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type ReactNode, useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AdditionalField,
  type AdditionalFieldProps,
} from '@/components/auth/form/additional-field/additional-field';
import { AuthProvider } from '@/components/auth/provider/auth-provider';

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }));
vi.mock('sonner', () => ({ toast: toastMock }));

function TestLink({ href, children }: { href: string; children?: ReactNode }) {
  return <a href={href}>{children}</a>;
}

type ControlledProps = Partial<Omit<AdditionalFieldProps, 'field' | 'value' | 'onChange'>> & {
  field: AdditionalFieldConfig;
  initial?: AdditionalFieldFormValue;
  onChange?: (value: AdditionalFieldFormValue) => void;
};

function Controlled({
  field,
  initial = null,
  onChange = () => undefined,
  onBlur = () => undefined,
  ...rest
}: ControlledProps) {
  const [value, setValue] = useState<AdditionalFieldFormValue>(initial);
  return (
    <AdditionalField
      name={field.name}
      field={field}
      value={value}
      onBlur={onBlur}
      onChange={(next) => {
        onChange(next);
        setValue(next);
      }}
      {...rest}
    />
  );
}

function renderField(props: ControlledProps) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onChange = props.onChange ?? vi.fn();
  const view = render(
    <AuthProvider
      authClient={{ getSession: vi.fn(async () => null) } as never}
      navigate={vi.fn()}
      Link={TestLink}
      queryClient={queryClient}
    >
      <Controlled {...props} onChange={onChange} />
    </AuthProvider>,
  );
  return { onChange: onChange as ReturnType<typeof vi.fn>, view };
}

const lastValue = (fn: ReturnType<typeof vi.fn>) => fn.mock.calls.at(-1)?.[0];

beforeEach(() => {
  vi.clearAllMocks();
});

describe('AdditionalField', () => {
  it('delegates to a custom renderer with the resolved props', () => {
    const renderer = vi.fn((props: { name: string; value: unknown }) => (
      <p>
        custom {props.name} {String(props.value)}
      </p>
    ));
    renderField({
      field: { name: 'custom', type: 'string', label: 'Custom', render: renderer as never },
      initial: 'abc',
      isPending: true,
    });

    expect(screen.getByText('custom custom abc')).toBeTruthy();
    expect(renderer.mock.calls[0][0]).toMatchObject({
      name: 'custom',
      value: 'abc',
      isPending: true,
    });
  });

  it('renders a hidden input with the stringified value', () => {
    const date = new Date(Date.UTC(2024, 0, 2));
    const { view } = renderField({
      field: { name: 'secret', type: 'date', label: 'Secret', inputType: 'hidden' },
      initial: date,
    });

    const input = view.container.querySelector('input[type="hidden"]') as HTMLInputElement;
    expect(input.name).toBe('secret');
    expect(input.value).toBe(date.toISOString());
  });

  it('renders a plain text input that reports null when cleared, with an optional suffix and errors', async () => {
    const user = userEvent.setup();
    const onBlur = vi.fn();
    const { onChange } = renderField({
      field: { name: 'nickname', type: 'string', label: 'Nickname', placeholder: 'Nick' },
      optionalLabel: ' (optional)',
      isInvalid: true,
      errors: ['Too silly', { message: 'Also too long' }],
      onBlur,
    });

    const input = screen.getByLabelText('Nickname (optional)') as HTMLInputElement;
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByText('Too silly')).toBeTruthy();
    expect(screen.getByText('Also too long')).toBeTruthy();

    await user.type(input, 'Al');
    expect(lastValue(onChange)).toBe('Al');
    await user.clear(input);
    expect(lastValue(onChange)).toBeNull();
    await user.tab();
    expect(onBlur).toHaveBeenCalled();
  });

  it('does not append the optional label to required fields', () => {
    renderField({
      field: { name: 'company', type: 'string', label: 'Company', required: true },
      optionalLabel: ' (optional)',
    });
    expect((screen.getByLabelText('Company') as HTMLInputElement).required).toBe(true);
  });

  it('uses a numeric native input for string-input number fields', () => {
    renderField({
      field: {
        name: 'rate',
        type: 'number',
        label: 'Rate',
        inputType: 'input',
        formatOptions: { maximumFractionDigits: 2 },
      },
    });
    const input = screen.getByLabelText('Rate') as HTMLInputElement;
    expect(input.type).toBe('number');
    expect(input.inputMode).toBe('decimal');
    expect(input.step).toBe('0.01');
  });

  it('renders prefix and suffix addons', () => {
    renderField({
      field: { name: 'site', type: 'string', label: 'Site', prefix: 'https://', suffix: '.test' },
      initial: 'fake',
    });

    expect(screen.getByText('https://')).toBeTruthy();
    expect(screen.getByText('.test')).toBeTruthy();
    expect((screen.getByLabelText('Site') as HTMLInputElement).value).toBe('fake');
  });

  it('copies the live value of a copyable field', async () => {
    const user = userEvent.setup();
    renderField({
      field: { name: 'code', type: 'string', label: 'Code', copyable: true, prefix: '#' },
      initial: 'fake-value',
    });

    await user.click(screen.getByRole('button', { name: localization.settings.copyToClipboard }));

    expect(
      await screen.findByRole('button', { name: localization.settings.copiedToClipboard }),
    ).toBeTruthy();
    await expect(navigator.clipboard.readText()).resolves.toBe('fake-value');
  });

  it('skips copying an empty value and toasts a clipboard failure', async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, 'writeText');
    const { view } = renderField({
      field: { name: 'code', type: 'string', label: 'Code', copyable: true },
    });

    await user.click(screen.getByRole('button', { name: localization.settings.copyToClipboard }));
    expect(writeText).not.toHaveBeenCalled();
    view.unmount();

    writeText.mockRejectedValueOnce(new Error('denied'));
    renderField({
      field: { name: 'code', type: 'string', label: 'Code', copyable: true },
      initial: 'abc',
    });
    await user.click(screen.getByRole('button', { name: localization.settings.copyToClipboard }));
    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith(localization.errors.copyFailed),
    );
  });

  it('renders a textarea', async () => {
    const user = userEvent.setup();
    const { onChange } = renderField({
      field: { name: 'bio', type: 'string', label: 'Bio', inputType: 'textarea' },
    });

    const textarea = screen.getByLabelText('Bio');
    expect(textarea.tagName).toBe('TEXTAREA');
    await user.type(textarea, 'Hi');
    expect(lastValue(onChange)).toBe('Hi');
    await user.clear(textarea);
    expect(lastValue(onChange)).toBeNull();
  });

  it('renders a number input that reports numbers or null', async () => {
    const user = userEvent.setup();
    const { onChange } = renderField({
      field: { name: 'age', type: 'number', label: 'Age', min: 1, max: 120 },
    });

    const input = screen.getByLabelText('Age') as HTMLInputElement;
    expect(input.inputMode).toBe('numeric');
    expect(input.min).toBe('1');
    await user.type(input, '42');
    expect(lastValue(onChange)).toBe(42);
    await user.clear(input);
    expect(lastValue(onChange)).toBeNull();
  });

  it('uses a decimal step for fractional number fields', () => {
    renderField({
      field: {
        name: 'price',
        type: 'number',
        label: 'Price',
        formatOptions: { maximumFractionDigits: 1 },
      },
      initial: 2.5,
    });
    const input = screen.getByLabelText('Price') as HTMLInputElement;
    expect(input.step).toBe('0.1');
    expect(input.value).toBe('2.5');
  });

  it('renders a slider with its formatted value and reports changes', async () => {
    const user = userEvent.setup();
    const { onChange } = renderField({
      field: {
        name: 'volume',
        type: 'number',
        label: 'Volume',
        inputType: 'slider',
        min: 0,
        max: 10,
      },
      initial: 3,
    });

    expect(screen.getByText('3')).toBeTruthy();
    const thumb = screen.getByRole('slider');
    thumb.focus();
    await user.keyboard('{ArrowRight}');
    expect(lastValue(onChange)).toBe(4);
    expect(screen.getByText('4')).toBeTruthy();
  });

  it('defaults the slider to its minimum', () => {
    renderField({
      field: {
        name: 'ratio',
        type: 'number',
        label: 'Ratio',
        inputType: 'slider',
        min: 5,
        formatOptions: { maximumFractionDigits: 1 },
      },
    });
    expect(screen.getByRole('slider').getAttribute('aria-valuenow')).toBe('5');
  });

  it('renders a switch for boolean fields', async () => {
    const user = userEvent.setup();
    const { onChange } = renderField({
      field: { name: 'news', type: 'boolean', label: 'Newsletter' },
    });

    await user.click(screen.getByRole('switch', { name: 'Newsletter' }));
    expect(lastValue(onChange)).toBe(true);
    expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('true');
  });

  it('renders a checkbox', async () => {
    const user = userEvent.setup();
    const { onChange } = renderField({
      field: {
        name: 'tos',
        type: 'boolean',
        label: 'Accept',
        inputType: 'checkbox',
        required: true,
      },
    });

    await user.click(screen.getByRole('checkbox', { name: 'Accept' }));
    expect(lastValue(onChange)).toBe(true);
    await user.click(screen.getByRole('checkbox', { name: 'Accept' }));
    expect(lastValue(onChange)).toBe(false);
  });

  it('renders a select and reports the chosen option', async () => {
    const user = userEvent.setup();
    const { onChange } = renderField({
      field: {
        name: 'plan',
        type: 'string',
        label: 'Plan',
        inputType: 'select',
        placeholder: 'Pick a plan',
        options: [
          { label: 'Free', value: 'free' },
          { label: 'Pro', value: 'pro' },
        ],
      },
    });

    expect(screen.getByText('Pick a plan')).toBeTruthy();
    await user.click(screen.getByRole('combobox'));
    await user.click(await screen.findByRole('option', { name: 'Pro' }));

    expect(lastValue(onChange)).toBe('pro');
  });

  it('renders a combobox and reports the chosen option', async () => {
    const user = userEvent.setup();
    const { onChange } = renderField({
      field: {
        name: 'country',
        type: 'string',
        label: 'Country',
        inputType: 'combobox',
        placeholder: 'Search',
        options: [
          { label: 'Atlantis', value: 'atl' },
          { label: 'Lemuria', value: 'lem' },
        ],
      },
    });

    const input = screen.getByLabelText('Country');
    await user.click(input);
    await user.type(input, 'Lem');
    await user.click(await screen.findByRole('option', { name: 'Lemuria' }));

    expect(lastValue(onChange)).toBe('lem');
  });

  it('shows the empty combobox state', async () => {
    const user = userEvent.setup();
    renderField({
      field: {
        name: 'country',
        type: 'string',
        label: 'Country',
        inputType: 'combobox',
        options: [{ label: 'Atlantis', value: 'atl' }],
      },
      initial: 'atl',
    });

    const input = screen.getByLabelText('Country') as HTMLInputElement;
    expect(input.value).toBe('Atlantis');
    await user.clear(input);
    await user.type(input, 'zzz');
    expect(await screen.findByText('No items found.')).toBeTruthy();
  });

  it('picks a date at midnight and closes the calendar', async () => {
    const user = userEvent.setup();
    const { onChange } = renderField({
      field: { name: 'birthday', type: 'date', label: 'Birthday', placeholder: 'Pick a day' },
      initial: '2024-03-05T10:00:00',
    });

    const trigger = screen.getByLabelText('Birthday');
    expect(trigger.textContent).toContain('March 5th, 2024');
    await user.click(trigger);
    const grid = await screen.findByRole('grid');
    await user.click(within(grid).getByText('12'));

    const picked = lastValue(onChange) as Date;
    expect(picked.getFullYear()).toBe(2024);
    expect(picked.getMonth()).toBe(2);
    expect(picked.getDate()).toBe(12);
    expect(picked.getHours()).toBe(0);
    await waitFor(() => expect(screen.queryByRole('grid')).toBeNull());
  });

  it('shows the placeholder for an invalid date and clears on deselect', async () => {
    const user = userEvent.setup();
    const { onChange, view } = renderField({
      field: { name: 'birthday', type: 'date', label: 'Birthday', placeholder: 'Pick a day' },
      initial: 'not a date',
    });
    expect(screen.getByLabelText('Birthday').textContent).toContain('Pick a day');
    view.unmount();

    const second = renderField({
      field: { name: 'day', type: 'date', label: 'Day' },
      initial: new Date(2024, 3, 9),
    });
    await user.click(screen.getByLabelText('Day'));
    await user.click(within(await screen.findByRole('grid')).getByText('9'));
    expect(lastValue(second.onChange)).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('combines date and time for datetime fields', async () => {
    const user = userEvent.setup();
    const { onChange } = renderField({
      field: { name: 'meeting', type: 'date', label: 'Meeting', inputType: 'datetime' },
      initial: new Date(2024, 0, 10, 8, 30, 15),
    });

    const time = screen.getByLabelText(localization.settings.time) as HTMLInputElement;
    expect(time.value).toBe('08:30:15');

    fireEvent.change(time, { target: { value: '09:15:00' } });
    const timed = lastValue(onChange) as Date;
    expect([timed.getDate(), timed.getHours(), timed.getMinutes()]).toEqual([10, 9, 15]);

    await user.click(screen.getByLabelText('Meeting'));
    await user.click(within(await screen.findByRole('grid')).getByText('12'));
    const picked = lastValue(onChange) as Date;
    expect([picked.getDate(), picked.getHours(), picked.getMinutes()]).toEqual([12, 9, 15]);
    // The datetime popover stays open so the time can still be adjusted.
    expect(screen.getByRole('grid')).toBeTruthy();
  });

  it('only stores the time until a datetime has a date', async () => {
    const user = userEvent.setup();
    const { onChange } = renderField({
      field: { name: 'meeting', type: 'date', label: 'Meeting', inputType: 'datetime' },
    });

    fireEvent.change(screen.getByLabelText(localization.settings.time), {
      target: { value: '07:00:00' },
    });
    expect(onChange).not.toHaveBeenCalled();

    await user.click(screen.getByLabelText('Meeting'));
    await user.click(
      within(await screen.findByRole('grid'))
        .getAllByRole('button')
        .find((b) => b.textContent === '15') as HTMLElement,
    );
    expect((lastValue(onChange) as Date).getHours()).toBe(7);
  });
});
