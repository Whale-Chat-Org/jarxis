'use client';
import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { RoleView } from '@/lib/admin-contracts';

export function RolePicker({
  roles,
  value,
  onChange,
  multiple = false,
  disabled = false,
  label = 'Role',
  display,
  idPrefix = 'role',
  radio = false,
}: {
  roles: readonly RoleView[];
  value: readonly string[];
  onChange: (keys: string[]) => void;
  multiple?: boolean;
  disabled?: boolean;
  label?: string;
  display?: string;
  idPrefix?: string;
  radio?: boolean;
}) {
  if (multiple)
    return (
      <FieldGroup data-slot="checkbox-group">
        {roles.map((role) => (
          <Field key={role.key} orientation="horizontal">
            <Checkbox
              id={`${idPrefix}-${role.key}`}
              checked={value.includes(role.key)}
              disabled={disabled}
              onCheckedChange={(checked) =>
                onChange(checked ? [...value, role.key] : value.filter((key) => key !== role.key))
              }
            />
            <FieldLabel htmlFor={`${idPrefix}-${role.key}`}>{role.name}</FieldLabel>
          </Field>
        ))}
      </FieldGroup>
    );
  if (radio)
    return (
      <RadioGroup
        value={value[0] ?? ''}
        disabled={disabled}
        onValueChange={(key) => {
          if (key) onChange([key]);
        }}
      >
        {roles.map((role) => (
          <Field key={role.key} orientation="horizontal">
            <RadioGroupItem id={`${idPrefix}-${role.key}`} value={role.key} />
            <FieldLabel htmlFor={`${idPrefix}-${role.key}`}>{role.name}</FieldLabel>
          </Field>
        ))}
      </RadioGroup>
    );
  return (
    <Select
      value={value.length === 1 ? value[0] : ''}
      disabled={disabled}
      onValueChange={(key) => {
        if (key) onChange([key]);
      }}
    >
      <SelectTrigger aria-label={label} className="max-w-full">
        <SelectValue placeholder={display ?? 'No role'}>{display}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {roles.map((role) => (
          <SelectItem key={role.key} value={role.key}>
            {role.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
