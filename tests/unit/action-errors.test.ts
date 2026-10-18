import {
  isActionErrorHandled,
  markActionErrorHandled,
  safeActionErrorMessage,
} from '@/lib/action-errors';
import { describe, expect, it } from 'vitest';

const FALLBACK = 'Something went wrong.';

describe('safeActionErrorMessage', () => {
  it('explains owner protection and code recovery without reflecting server detail', () => {
    expect(
      safeActionErrorMessage({ error: { code: 'LAST_OWNER', message: 'SECRET' } }, FALLBACK),
    ).toBe('Keep at least one active, verified owner before making this change.');
    expect(safeActionErrorMessage({ code: 'CODE_EXPIRED', message: 'SECRET' }, FALLBACK)).toBe(
      'That code has expired. Request a new code.',
    );
    expect(safeActionErrorMessage({ code: 'RESEND_COOLDOWN', message: 'SECRET' }, FALLBACK)).toBe(
      'Please wait for the countdown before requesting another code.',
    );
  });
  it('never reflects a raw server message, statusText, or field errors', () => {
    const malicious = {
      message: '<script>alert(document.cookie)</script> leaked internal detail',
      statusText: 'raw provider failure: duplicate key value violates constraint users_email_key',
      fieldErrors: { email: 'this email <b>belongs</b> to user id 42' },
      fields: { password: 'reflected-attacker-input' },
    };
    const result = safeActionErrorMessage(malicious, FALLBACK);
    expect(result).toBe(FALLBACK);
    expect(result).not.toContain('script');
    expect(result).not.toContain('leaked');
    expect(result).not.toContain('constraint');
    expect(result).not.toContain('belongs');
    expect(result).not.toContain('attacker');
  });

  it('does not leak a raw message that happens to accompany a known code', () => {
    const error = {
      code: 'USER_ALREADY_EXISTS',
      message: 'duplicate key value: alice@example.com already registered as admin',
    };
    const result = safeActionErrorMessage(error, FALLBACK);
    expect(result).toBe('An account with this email already exists.');
    expect(result).not.toContain('alice@example.com');
    expect(result).not.toContain('admin');
  });

  it('maps allowlisted codes to fixed copy, case-insensitively', () => {
    expect(safeActionErrorMessage({ code: 'FORBIDDEN' }, FALLBACK)).toBe(
      "You don't have permission to do this.",
    );
    expect(safeActionErrorMessage({ code: 'forbidden' }, FALLBACK)).toBe(
      "You don't have permission to do this.",
    );
    expect(safeActionErrorMessage({ code: 'TOO_MANY_REQUESTS' }, FALLBACK)).toBe(
      'Too many attempts. Wait a moment and try again.',
    );
  });

  it('reads codes nested in Better Fetch wrappers (error/body/cause)', () => {
    expect(safeActionErrorMessage({ error: { code: 'SESSION_EXPIRED' } }, FALLBACK)).toBe(
      'Your session has expired. Sign in again to continue.',
    );
    expect(safeActionErrorMessage({ body: { code: 'ROLE_IN_USE' } }, FALLBACK)).toBe(
      'This role still has members assigned to it.',
    );
    expect(safeActionErrorMessage({ cause: { code: 'INVALID_EMAIL' } }, FALLBACK)).toBe(
      'Enter a valid email address.',
    );
  });

  it('falls back to allowlisted HTTP status copy when no code matches', () => {
    expect(safeActionErrorMessage({ status: 429 }, FALLBACK)).toBe(
      'Too many attempts. Wait a moment and try again.',
    );
    expect(safeActionErrorMessage({ statusCode: 403 }, FALLBACK)).toBe(
      "You don't have permission to do this.",
    );
    expect(safeActionErrorMessage({ error: { status: 409 } }, FALLBACK)).toBe(
      'That conflicts with data that already exists.',
    );
  });

  it('prefers a known code over a status', () => {
    expect(safeActionErrorMessage({ code: 'FORBIDDEN', status: 500 }, FALLBACK)).toBe(
      "You don't have permission to do this.",
    );
  });

  it('returns the fallback for unknown codes, unknown statuses, and non-objects', () => {
    expect(safeActionErrorMessage({ code: 'SOME_INTERNAL_CODE' }, FALLBACK)).toBe(FALLBACK);
    expect(safeActionErrorMessage({ status: 500 }, FALLBACK)).toBe(FALLBACK);
    expect(safeActionErrorMessage('a raw string error', FALLBACK)).toBe(FALLBACK);
    expect(safeActionErrorMessage(null, FALLBACK)).toBe(FALLBACK);
    expect(safeActionErrorMessage(undefined, FALLBACK)).toBe(FALLBACK);
  });

  it('does not loop on cyclic error chains', () => {
    const error: Record<string, unknown> = { status: 400 };
    error.error = error;
    expect(safeActionErrorMessage(error, FALLBACK)).toBe(
      'That request was invalid. Check the details and try again.',
    );
  });
});

describe('action error handled tracking', () => {
  it('tracks individual error objects without affecting others', () => {
    const handled = { code: 'FORBIDDEN' };
    const other = { code: 'FORBIDDEN' };
    expect(isActionErrorHandled(handled)).toBe(false);
    markActionErrorHandled(handled);
    expect(isActionErrorHandled(handled)).toBe(true);
    expect(isActionErrorHandled(other)).toBe(false);
  });

  it('ignores non-object values safely', () => {
    expect(() => markActionErrorHandled('nope')).not.toThrow();
    expect(() => markActionErrorHandled(null)).not.toThrow();
    expect(isActionErrorHandled('nope')).toBe(false);
    expect(isActionErrorHandled(null)).toBe(false);
    expect(isActionErrorHandled(undefined)).toBe(false);
  });
});
