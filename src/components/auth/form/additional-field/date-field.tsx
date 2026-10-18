'use client';

import { getFormFieldErrors, resolveInputType } from '@better-auth-ui/core';
import { useAuth } from '@better-auth-ui/react';
import { format } from 'date-fns';
import { CalendarIcon, ChevronDownIcon } from 'lucide-react';
import { useState } from 'react';

import { buttonVariants } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { formatTime, toDate, withTime } from '@/lib/auth/additional-field-values';
import { cn } from '@/lib/utils';
import type { AdditionalFieldProps } from './additional-field';

/**
 * Date / datetime input. Composes `Popover` + `Calendar` for the date and
 * (optionally) `<input type="time">` for the time; the combined value is
 * reported as a `Date` (midnight for a date-only field).
 */
export function DateField({
  name,
  field,
  value,
  onBlur,
  onChange,
  isInvalid,
  errors,
  isPending,
}: AdditionalFieldProps) {
  const { localization } = useAuth();
  const isDateTime = resolveInputType(field) === 'datetime';
  const isDisabled = isPending || field.readOnly;

  const date = toDate(value);
  const [time, setTime] = useState<string>(isDateTime && date ? formatTime(date) : '');
  const [open, setOpen] = useState(false);

  return (
    <Field data-invalid={isInvalid}>
      <FieldLabel htmlFor={`${name}-date`}>{field.label}</FieldLabel>

      <div className="relative flex gap-sm">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger
            type="button"
            id={`${name}-date`}
            data-empty={!date}
            aria-invalid={isInvalid}
            aria-required={field.required}
            onBlur={onBlur}
            disabled={isDisabled}
            className={cn(
              buttonVariants({ variant: 'outline' }),
              'flex-1 justify-between font-normal',
              'data-[empty=true]:text-muted-foreground',
            )}
          >
            {date ? format(date, 'PPP') : <span>{field.placeholder}</span>}

            {isDateTime ? <ChevronDownIcon /> : <CalendarIcon />}
          </PopoverTrigger>

          <PopoverContent className="w-auto overflow-hidden p-none" align="start">
            <Calendar
              mode="single"
              selected={date}
              defaultMonth={date}
              captionLayout="dropdown"
              onSelect={(selected) => {
                onChange(selected ? withTime(selected, isDateTime ? time : '') : null);
                if (!isDateTime) setOpen(false);
              }}
            />
          </PopoverContent>
        </Popover>

        {isDateTime && (
          <Field className="w-select-sm">
            <FieldLabel htmlFor={`${name}-time`} className="sr-only">
              {localization.settings.time}
            </FieldLabel>

            <Input
              type="time"
              id={`${name}-time`}
              step="1"
              value={time}
              onChange={(event) => {
                const nextTime = event.target.value;
                setTime(nextTime);
                if (date) onChange(withTime(date, nextTime));
              }}
              disabled={isDisabled}
              className="appearance-none bg-background [&::-webkit-calendar-picker-indicator]:hidden [&::-webkit-calendar-picker-indicator]:appearance-none"
            />
          </Field>
        )}
      </div>

      <FieldError errors={getFormFieldErrors(errors ?? [])} />
    </Field>
  );
}
