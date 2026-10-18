'use client';

import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from '@/components/ui/combobox';
import { valueToString } from '@/lib/auth/additional-field-values';
import type { AdditionalFieldProps } from './additional-field';
import { AdditionalFieldFrame } from './additional-field-frame';

export function ComboboxField({
  name,
  field,
  value,
  onBlur,
  onChange,
  isInvalid,
  errors,
  isPending,
}: AdditionalFieldProps) {
  const selectedOption = field.options?.find((option) => option.value === valueToString(value));

  return (
    <AdditionalFieldFrame htmlFor={name} label={field.label} isInvalid={isInvalid} errors={errors}>
      <Combobox
        items={field.options ?? []}
        name={name}
        value={selectedOption ?? null}
        onValueChange={(option) => onChange(option?.value ?? null)}
        required={field.required}
        disabled={isPending || field.readOnly}
      >
        <ComboboxInput
          placeholder={field.placeholder}
          id={name}
          onBlur={onBlur}
          aria-invalid={isInvalid}
        />

        <ComboboxContent>
          <ComboboxEmpty>No items found.</ComboboxEmpty>

          <ComboboxList>
            {(option) => (
              <ComboboxItem key={option.value} value={option}>
                {option.label}
              </ComboboxItem>
            )}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
    </AdditionalFieldFrame>
  );
}
