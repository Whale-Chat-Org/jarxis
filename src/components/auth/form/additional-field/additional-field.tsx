'use client';

import {
  type AdditionalField as AdditionalFieldConfig,
  type AdditionalFieldFormValue,
  type AdditionalFieldInputType,
  resolveInputType,
} from '@better-auth-ui/core';
import type { ComponentType } from 'react';

import { Input } from '@/components/ui/input';
import { valueToString } from '@/lib/auth/additional-field-values';
import { ComboboxField } from './combobox-field';
import { DateField } from './date-field';
import { NumberField } from './number-field';
import { SelectField } from './select-field';
import { SliderField } from './slider-field';
import { TextInputField } from './text-input-field';
import { TextareaField } from './textarea-field';
import { ToggleField } from './toggle-field';

export type AdditionalFieldProps = {
  name: string;
  field: AdditionalFieldConfig;
  value: AdditionalFieldFormValue;
  onBlur: () => void;
  onChange: (value: AdditionalFieldFormValue) => void;
  isInvalid?: boolean;
  errors?: unknown[];
  isPending?: boolean;
  /** Complete suffix appended to labels for fields that are not required. */
  optionalLabel?: string;
};

/** Built-in renderer per resolved input type; anything unlisted is a text input. */
const FIELD_RENDERERS: Partial<
  Record<AdditionalFieldInputType, ComponentType<AdditionalFieldProps>>
> = {
  textarea: TextareaField,
  number: NumberField,
  slider: SliderField,
  switch: ToggleField,
  checkbox: ToggleField,
  select: SelectField,
  combobox: ComboboxField,
  date: DateField,
  datetime: DateField,
};

function withOptionalLabel(field: AdditionalFieldConfig, optionalLabel?: string) {
  if (!optionalLabel || field.required) return field;

  return {
    ...field,
    label: (
      <>
        {field.label}
        {optionalLabel}
      </>
    ),
  };
}

/** Renders a single additional user field via shadcn primitives. */
export function AdditionalField(props: AdditionalFieldProps) {
  const field = withOptionalLabel(props.field, props.optionalLabel);
  const fieldProps = { ...props, field };

  if (field.render) {
    const FieldRenderer = field.render as ComponentType<AdditionalFieldProps>;
    return <FieldRenderer {...fieldProps} />;
  }

  const inputType = resolveInputType(field);

  if (inputType === 'hidden') {
    return <Input type="hidden" name={props.name} value={valueToString(props.value)} readOnly />;
  }

  const FieldRenderer = FIELD_RENDERERS[inputType] ?? TextInputField;
  return <FieldRenderer {...fieldProps} />;
}
