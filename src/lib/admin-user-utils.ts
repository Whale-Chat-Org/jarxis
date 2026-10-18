import { safeActionErrorMessage } from '@/lib/action-errors';
import { parseRoleKeys, sameRoleKeys } from '@/lib/role-keys';
export const formatDate = (value: Date | string | undefined | null) =>
  value ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value)) : '–';

export const asAdminRoles = (roles: string[]) => roles as ('user' | 'admin')[];

export const parseAdminRoles = (
  role: string | undefined,
  fallback: string,
  allowMultipleRoles: boolean,
) => {
  const resolved = role === undefined ? [fallback] : parseRoleKeys(role);
  return allowMultipleRoles ? resolved : resolved.slice(0, 1);
};

export const sameRoles = (left: string[], right: string[]) => sameRoleKeys(left, right);

export const getBanDurationSeconds = (value: string) => {
  if (!value) return undefined;
  const days = Number(value);
  if (!Number.isSafeInteger(days) || days <= 0) return null;
  const seconds = days * 86_400;
  return Number.isSafeInteger(seconds) ? seconds : null;
};

export const DEFAULT_ADMIN_ERROR_MESSAGE = 'That action could not be completed. Try again.';

// Admin mutations can echo attacker-influenced input or raw provider text, so only ever render
// allowlisted, safe copy next to the form — never the server's message.
export const getAdminErrorMessage = (error: unknown) =>
  error ? safeActionErrorMessage(error, DEFAULT_ADMIN_ERROR_MESSAGE) : undefined;

// Mutations that render their failure inline (next to the form) opt out of the global error toast
// so the same failure is not reported twice. Any existing `meta` (e.g. the registry's `awaits`) is
// preserved.
export function withInlineErrors<T extends object>(options: T): T {
  const existingMeta = (options as { meta?: Record<string, unknown> }).meta;
  return { ...options, meta: { ...existingMeta, errorPresentation: 'inline' } };
}
