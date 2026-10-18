import { safeActionErrorMessage } from '@/lib/action-errors';
import { ApiRequestError, responseErrorCode } from '@/lib/api-client';
export { ApiRequestError as ProviderRequestError } from '@/lib/api-client';

/**
 * Safe copy for the Provider management API's own error codes. Like the shared helper, this only
 * maps allowlisted codes and never reads the server message, so provider text cannot reach the UI.
 */
const PROVIDER_CODE_MESSAGES: Record<string, string> = {
  INVALID_ENDPOINT:
    'Use a public HTTPS base URL. Private, local and redirecting endpoints are blocked.',
  NOT_FOUND: 'This item no longer exists. Reload to see the latest providers.',
  MODEL_CATALOG_CHANGED:
    'Models changed since you opened this panel. Reload models and review your choices before saving.',
  VALIDATION_ERROR: 'Some details are invalid. Check the form and try again.',
  INVALID_JSON: 'That request was invalid. Reload the page and try again.',
  TOO_LARGE: 'That request was too large. Shorten the input and try again.',
  SESSION_REQUIRED: 'Your owner session has ended. Sign in again to continue.',
  UNAUTHENTICATED: 'Your owner session has ended. Sign in again to continue.',
  FORBIDDEN: 'Only owners can manage Providers.',
  ORIGIN_REJECTED: 'This request came from an untrusted page. Reload and try again.',
  ORIGIN_REQUIRED: 'This request came from an untrusted page. Reload and try again.',
  RATE_LIMITED: 'Too many requests. Wait a minute and try again.',
};

/** Error thrown by the panel's fetch helper: status and code only, never the response text. */
export function providerErrorMessage(error: unknown, fallback: string): string {
  if (
    error instanceof ApiRequestError &&
    error.code &&
    Object.hasOwn(PROVIDER_CODE_MESSAGES, error.code)
  )
    return PROVIDER_CODE_MESSAGES[error.code];
  return safeActionErrorMessage(error, fallback);
}

/** Read just the error code from a JSON error body; anything unexpected yields undefined. */
export { responseErrorCode };

/** Why a model catalog could not be read. Codes only; the copy below is fixed and safe. */
const discoveryFailureReasons = [
  'auth',
  'credential',
  'unavailable',
  'rate_limited',
  'provider_error',
  'timeout',
  'unreachable',
  'endpoint_rejected',
  'invalid_catalog',
] as const;
export type DiscoveryFailureReason = (typeof discoveryFailureReasons)[number];

export function isDiscoveryFailureReason(value: unknown): value is DiscoveryFailureReason {
  return (discoveryFailureReasons as readonly unknown[]).includes(value);
}

function waitText(seconds: number) {
  if (seconds < 60) return `${seconds} second${seconds === 1 ? '' : 's'}`;
  const minutes = Math.ceil(seconds / 60);
  return `${minutes} minute${minutes === 1 ? '' : 's'}`;
}

/** Owner-facing explanation for a discovery failure. Only integers and fixed copy are used. */
export function discoveryFailureMessage(
  reason: DiscoveryFailureReason,
  httpStatus?: number | null,
  retryAfterSeconds?: number | null,
): string {
  const status = httpStatus ? ` (HTTP ${httpStatus})` : '';
  switch (reason) {
    case 'auth':
      return `The provider rejected this API key${status}. Check that the key is valid and allowed to list models.`;
    case 'unavailable':
      return 'Discovery could not be saved. Try again shortly.';
    case 'credential':
      return 'The saved credential could not be used. Replace the API key.';
    case 'rate_limited':
      return `The provider is rate limiting this key${status}. ${
        retryAfterSeconds
          ? `Try again in ${waitText(retryAfterSeconds)}.`
          : 'Wait a moment, then retry.'
      }`;
    case 'provider_error':
      return `The provider returned an error${status}. Try again later.`;
    case 'timeout':
      return 'The provider did not respond within 15 seconds. Try again.';
    case 'unreachable':
      return 'The provider could not be reached. Check the host name in the base URL.';
    case 'endpoint_rejected':
      return PROVIDER_CODE_MESSAGES.INVALID_ENDPOINT;
    case 'invalid_catalog':
      return 'The endpoint responded, but not with a model list this provider type understands. Check the base URL path, or add model IDs manually.';
  }
}

/** Compact form stored in `discovery_error`, e.g. `rate_limited:429`. */
export function encodeDiscoveryFailure(reason: DiscoveryFailureReason, httpStatus?: number | null) {
  return httpStatus ? `${reason}:${httpStatus}` : reason;
}

/** Turn a stored value back into copy; anything unrecognised (including old rows) is generic. */
export function storedDiscoveryFailureMessage(value: string): string {
  const [reason, status] = value.split(':');
  const httpStatus = status && /^[1-5]\d\d$/.test(status) ? Number(status) : null;
  return isDiscoveryFailureReason(reason)
    ? discoveryFailureMessage(reason, httpStatus)
    : 'Model discovery failed. Check the connection and retry.';
}
