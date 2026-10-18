'use client';

import { type ComponentProps, useRef } from 'react';

import { Input } from '@/components/ui/input';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import {
  getFractionStep,
  getNumericInputMode,
  valueToString,
} from '@/lib/auth/additional-field-values';
import type { AdditionalFieldProps } from './additional-field';
import { AdditionalFieldFrame } from './additional-field-frame';
import { CopyButton } from './copy-button';

/** Single-line input; wrapped in an input group when it has a prefix, suffix or copy button. */
export function TextInputField({
  name,
  field,
  value,
  onBlur,
  onChange,
  isInvalid,
  errors,
  isPending,
}: AdditionalFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  const hasPrefix = field.prefix != null;
  const hasSuffix = field.suffix != null || field.copyable;
  const isNumeric = field.type === 'number';

  const inputProps = {
    id: name,
    name,
    type: isNumeric ? 'number' : undefined,
    inputMode: isNumeric ? getNumericInputMode(field) : undefined,
    step: getFractionStep(field),
    value: valueToString(value),
    onBlur,
    onChange: (event) => onChange(event.target.value || null),
    placeholder: field.placeholder,
    required: field.required,
    readOnly: field.readOnly,
    disabled: isPending,
    'aria-invalid': isInvalid,
  } satisfies ComponentProps<'input'>;

  return (
    <AdditionalFieldFrame htmlFor={name} label={field.label} isInvalid={isInvalid} errors={errors}>
      {hasPrefix || hasSuffix ? (
        <InputGroup>
          {hasPrefix && <InputGroupAddon align="inline-start">{field.prefix}</InputGroupAddon>}

          <InputGroupInput ref={inputRef} {...inputProps} />

          {field.copyable ? (
            <InputGroupAddon align="inline-end">
              <CopyButton getValue={() => inputRef.current?.value} isDisabled={isPending} />
            </InputGroupAddon>
          ) : (
            field.suffix != null && (
              <InputGroupAddon align="inline-end">{field.suffix}</InputGroupAddon>
            )
          )}
        </InputGroup>
      ) : (
        <Input {...inputProps} />
      )}
    </AdditionalFieldFrame>
  );
}
