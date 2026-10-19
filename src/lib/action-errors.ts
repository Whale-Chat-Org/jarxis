/**
 * Safe, user-facing messages for failed client actions (auth and admin mutations).
 *
 * Server responses can carry attacker-influenced strings (reflected input, raw provider text,
 * validation detail for fields the user never saw). Surfacing `error.message`, `statusText` or a
 * server `fieldErrors` map directly would leak that content into the UI. This module instead maps a
 * small allowlist of error codes and HTTP statuses onto fixed copy and otherwise returns the
 * caller's fallback. It never reads or returns the raw server message or field errors.
 *
 * It also tracks which error objects a global handler has already surfaced (e.g. the toaster), so a
 * second catch site can avoid showing the same failure twice.
 */

type ErrorRecord = Record<string, unknown>;

/** Allowlisted error codes → safe copy. Codes are compared upper-cased. */
const CODE_MESSAGES: Record<string, string> = {
  TARGET_PERMISSIONS_EXCEED_ACTOR: 'You cannot act on a user with permissions you do not hold.',
  OWNER_PROTECTED: 'Only an owner can change another owner account.',
  LAST_OWNER: 'Keep at least one active, verified owner before making this change.',
  INACTIVE_OWNER: 'An owner account must be active and email verified.',
  EMAIL_CONFLICT: 'An account with this email already exists. Use another email address.',
  CODE_INVALID: 'That code is not valid. Check the email and try again.',
  CODE_EXPIRED: 'That code has expired. Request a new code.',
  CODE_ATTEMPTS_EXHAUSTED: 'Too many incorrect codes. Request a new code.',
  RESEND_COOLDOWN: 'Please wait for the countdown before requesting another code.',
  SETUP_REQUEST_NOT_FOUND: 'This setup request is no longer available. Start again.',
  UNAVAILABLE: 'The service is temporarily unavailable. Try again shortly.',
  USER_ALREADY_EXISTS: 'An account with this email already exists.',
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: 'An account with this email already exists.',
  INVALID_EMAIL: 'Enter a valid email address.',
  INVALID_EMAIL_OR_PASSWORD: 'The sign-in details are incorrect. Try again.',
  INVALID_PASSWORD: 'The sign-in details are incorrect. Try again.',
  PASSWORD_TOO_SHORT: 'This password is too short.',
  PASSWORD_TOO_LONG: 'This password is too long.',
  PASSWORD_COMPROMISED: 'This password has appeared in a data breach. Choose another one.',
  SESSION_EXPIRED: 'Your session has expired. Sign in again to continue.',
  SESSION_NOT_FRESH: 'Please sign in again to continue.',
  UNAUTHORIZED: 'Please sign in again to continue.',
  FORBIDDEN: "You don't have permission to do this.",
  TOO_MANY_ATTEMPTS: 'Too many attempts. Wait a moment and try again.',
  TOO_MANY_REQUESTS: 'Too many attempts. Wait a moment and try again.',
  API_KEY_REVOKED: 'This API key has been revoked. Its name can no longer be changed.',
  ROLE_IN_USE: 'This role still has members assigned to it.',
  ROLE_NAME_TAKEN: 'This role name is already in use.',
  SYSTEM_ROLE: 'This system role cannot be changed.',
  INVALID_PERMISSION: 'This role contains an unavailable permission.',
  INVALID_PASSWORD_LENGTH: 'Password must be 12–128 characters.',
  BANNED_USER: 'This account is banned.',
};

/** Allowlisted HTTP statuses → safe copy, used when no code matched. */
const STATUS_MESSAGES: Record<number, string> = {
  400: 'That request was invalid. Check the details and try again.',
  401: 'Please sign in again to continue.',
  403: "You don't have permission to do this.",
  404: 'We could not find what you were looking for.',
  409: 'That conflicts with data that already exists.',
  413: 'That request was too large.',
  422: 'That request was invalid. Check the details and try again.',
  429: 'Too many attempts. Wait a moment and try again.',
};

function asRecord(value: unknown): ErrorRecord | undefined {
  return value && typeof value === 'object' ? (value as ErrorRecord) : undefined;
}

/** Walk the common Better Fetch / Better Auth wrappers without following cycles. */
function* errorChain(error: unknown): Generator<ErrorRecord> {
  const seen = new Set<ErrorRecord>();
  let node = asRecord(error);
  while (node && !seen.has(node)) {
    seen.add(node);
    yield node;
    node = asRecord(node.error) ?? asRecord(node.body) ?? asRecord(node.cause);
  }
}

function actionErrorCode(error: unknown): string | undefined {
  for (const node of errorChain(error)) {
    if (typeof node.code === 'string' && node.code) return node.code.toUpperCase();
  }
  return undefined;
}

function readErrorStatus(error: unknown): number | undefined {
  for (const node of errorChain(error)) {
    for (const key of ['status', 'statusCode'] as const) {
      const value = node[key];
      if (typeof value === 'number' && Number.isFinite(value)) return value;
    }
  }
  return undefined;
}

/**
 * Resolve a safe, user-facing message for a failed action.
 *
 * Returns allowlisted copy for a known error code (preferred) or HTTP status, and the provided
 * `fallback` otherwise. The server-provided message, `statusText` and any `fieldErrors`/`fields`
 * map are never read or returned.
 */
export function safeActionErrorMessage(error: unknown, fallback: string): string {
  const code = actionErrorCode(error);
  if (code === 'ROLE_IN_USE') {
    for (const node of errorChain(error)) {
      const count = node.userCount;
      if (typeof count === 'number' && Number.isSafeInteger(count) && count > 0)
        return `${count} user${count === 1 ? '' : 's'} still ${count === 1 ? 'has' : 'have'} this role. Assign ${count === 1 ? 'them' : 'these users'} another role before deleting it.`;
    }
  }
  if (code && Object.hasOwn(CODE_MESSAGES, code)) return CODE_MESSAGES[code];

  const status = readErrorStatus(error);
  if (status !== undefined && Object.hasOwn(STATUS_MESSAGES, status))
    return STATUS_MESSAGES[status];

  return fallback;
}

const handledActionErrors = new WeakSet<object>();

/** Record that an error has already been surfaced to the user (e.g. by the global toaster). */
export function markActionErrorHandled(error: unknown): void {
  if (error && typeof error === 'object') handledActionErrors.add(error as object);
}

/** Report whether an error was already surfaced, so a later catch can skip duplicating it. */
export function isActionErrorHandled(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && handledActionErrors.has(error as object));
}
