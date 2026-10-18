'use client';

import { getFormFieldErrors } from '@better-auth-ui/core';

import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { Slider } from '@/components/ui/slider';
import { getFractionStep } from '@/lib/auth/additional-field-values';
import type { AdditionalFieldProps } from './additional-field';

/**
 * Slider field. Radix Slider doesn't render the current value, so we render
 * it next to the label and control the state to keep the displayed value in
 * sync. The selected value is submitted via the underlying Radix `name` prop.
 */
export function SliderField({
  name,
  field,
  value,
  onBlur,
  onChange,
  isInvalid,
  errors,
  isPending,
}: AdditionalFieldProps) {
  const min = field.min ?? 0;
  const max = field.max ?? 100;
  const step = field.step ?? getFractionStep(field) ?? 1;
  const numericValue = typeof value === 'number' ? value : min;
  const formatter = new Intl.NumberFormat(undefined, field.formatOptions);

  return (
    <Field data-invalid={isInvalid}>
      <div className="flex items-center justify-between gap-sm">
        <FieldLabel htmlFor={name}>{field.label}</FieldLabel>
        <span className="text-body-sm text-muted-foreground tabular-nums">
          {formatter.format(numericValue)}
        </span>
      </div>

      <Slider
        id={name}
        name={name}
        value={[numericValue]}
        onBlur={onBlur}
        onValueChange={(nextValue) =>
          onChange((Array.isArray(nextValue) ? nextValue[0] : nextValue) ?? min)
        }
        min={min}
        max={max}
        step={step}
        disabled={isPending || field.readOnly}
        aria-invalid={isInvalid}
      />

      <FieldError errors={getFormFieldErrors(errors ?? [])} />
    </Field>
  );
}
