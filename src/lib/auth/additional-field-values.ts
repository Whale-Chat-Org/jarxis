import type { AdditionalField, AdditionalFieldFormValue } from '@better-auth-ui/core';

export function valueToString(value: AdditionalFieldFormValue) {
  if (value == null) return '';
  return value instanceof Date ? value.toISOString() : String(value);
}

/** Convert a `defaultValue` into a `Date` for the calendar. */
export function toDate(value: unknown): Date | undefined {
  if (value instanceof Date) return value;
  if (typeof value === 'string') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
  }
  return undefined;
}

/** Format a Date as `HH:mm:ss` for an `<input type="time">`. */
export function formatTime(date: Date) {
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/** Copy of `date` with its clock set from an `HH:mm[:ss]` string; an empty string means midnight. */
export function withTime(date: Date, time: string) {
  const [hours = '0', minutes = '0', seconds = '0'] = time.trim() ? time.split(':') : [];
  const next = new Date(date);
  next.setHours(Number(hours), Number(minutes), Number(seconds), 0);
  return next;
}

/** Native `step` that allows the configured number of decimal places. */
export function getFractionStep(field: AdditionalField) {
  const maxFractionDigits = field.formatOptions?.maximumFractionDigits;
  return maxFractionDigits ? 1 / 10 ** maxFractionDigits : undefined;
}

export function getNumericInputMode(field: AdditionalField) {
  return field.formatOptions?.maximumFractionDigits ? ('decimal' as const) : ('numeric' as const);
}
