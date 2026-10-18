'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { useIsHydrated } from '@/hooks/use-is-hydrated';
import { safeActionErrorMessage } from '@/lib/action-errors';
import { useAuthForm } from '@/components/auth/form/auth-form';
import { setAuthFormServerError } from '@/lib/auth/auth-form-utils';

/**
 * First-owner bootstrap form for `/setup`.
 *
 * Deliberately local rather than a registry copy: the `@better-auth-ui` registry has no
 * protected-bootstrap view (its items cover sign-in/sign-up, recovery, settings and admin only).
 * It still composes the registry form layer — `useAuthForm` from `auth-form.tsx` for fields,
 * submission, pending state and the server-error slot — plus the shadcn `Card`, `FieldGroup` and
 * `Field` primitives, so validation, focus management and error rendering match every other
 * auth view.
 *
 * The flow has two steps and no operator secret:
 *
 * 1. Name, email and password are posted to `/api/setup`, which accepts any address and emails a
 *    six-digit code to it. The reply is `202` with the request handle.
 * 2. The code is posted to `/api/setup/verify`. The first verification wins; success clears the
 *    stored handle and sends the new owner to sign-in.
 *
 * Only the handle (`requestId`, `email` and the two timestamps) is persisted, in `sessionStorage`,
 * so a refresh resumes the code step. The password and the code are never stored and the password
 * is dropped from form state as soon as the first step is accepted.
 */

/** `sessionStorage` key holding the in-flight setup request handle. */
const STORAGE_KEY = 'jarxis.owner-setup.request';

type SetupRequest = {
  requestId: string;
  email: string;
  /** ISO timestamp after which the emailed code is rejected. */
  expiresAt: string;
  /** ISO timestamp before which a resend is refused. */
  resendAvailableAt: string;
  deliverySent?: boolean;
};

type SetupRequestResponse = SetupRequest & {
  /** `false` when the provider rejected the mail; the code may still have been delivered. */
  deliverySent: boolean;
};

function isSetupRequestResponse(value: unknown): value is SetupRequestResponse {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.requestId === 'string' &&
    typeof candidate.email === 'string' &&
    typeof candidate.expiresAt === 'string' &&
    typeof candidate.resendAvailableAt === 'string' &&
    typeof candidate.deliverySent === 'boolean'
  );
}

function readStoredRequest(): SetupRequest | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const candidate = parsed as Record<string, unknown>;
    if (
      typeof candidate.requestId !== 'string' ||
      typeof candidate.email !== 'string' ||
      typeof candidate.expiresAt !== 'string' ||
      typeof candidate.resendAvailableAt !== 'string'
    )
      return null;
    return {
      requestId: candidate.requestId,
      email: candidate.email,
      expiresAt: candidate.expiresAt,
      resendAvailableAt: candidate.resendAvailableAt,
      deliverySent:
        typeof candidate.deliverySent === 'boolean' ? candidate.deliverySent : undefined,
    };
  } catch {
    return null;
  }
}

function writeStoredRequest(request: SetupRequest) {
  try {
    // Only the handle: never the password and never the code.
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(request));
  } catch {
    // A blocked storage quota only costs refresh recovery; the flow still works in this tab.
  }
}

function clearStoredRequest() {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to recover from: the in-memory state is already cleared by the caller.
  }
}

/** `src/lib/http.ts` answers errors as `{ error: { code, message } }`. */
async function readError(response: Response) {
  const payload: unknown = await response.json().catch(() => undefined);
  const error =
    payload && typeof payload === 'object' && 'error' in payload
      ? (payload as { error: unknown }).error
      : payload;
  const code =
    error && typeof error === 'object' && typeof (error as { code?: unknown }).code === 'string'
      ? (error as { code: string }).code
      : undefined;
  return { code, error };
}

/** Whole seconds left until `timestamp`, clamped at zero. */
export function secondsUntil(timestamp: string, now = Date.now()) {
  const target = new Date(timestamp).getTime();
  if (Number.isNaN(target)) return 0;
  return Math.max(0, Math.ceil((target - now) / 1000));
}

export function formatCountdown(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return minutes > 0 ? `${minutes}m ${String(rest).padStart(2, '0')}s` : `${rest}s`;
}

export function useOwnerSetup() {
  const router = useRouter();
  const isHydrated = useIsHydrated();
  const [request, setRequest] = useState<SetupRequest | null>(null);
  const [deliverySent, setDeliverySent] = useState(true);
  const [isInitialSend, setIsInitialSend] = useState(true);
  const [isComplete, setIsComplete] = useState(false);
  const [isClosed, setIsClosed] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [resendMessage, setResendMessage] = useState<string | null>(null);
  const [resendError, setResendError] = useState<string | null>(null);
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => {
    const stored = readStoredRequest();
    if (!stored) return;
    setRequest(stored);
    setDeliverySent(stored.deliverySent ?? true);
    setIsInitialSend(false);
  }, []);
  useEffect(() => {
    if (!request || isComplete) return;
    const interval = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [request, isComplete]);
  const accept = useCallback((response: SetupRequestResponse) => {
    const { deliverySent: sent, ...handle } = response;
    setRequest(handle);
    setDeliverySent(sent);
    writeStoredRequest({ ...handle, deliverySent: sent });
  }, []);
  const detailsForm = useAuthForm({
    defaultValues: { name: '', email: '', password: '' },
    onSubmit: async ({ value }) => {
      let response: Response;
      try {
        response = await fetch('/api/setup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: value.name.trim(),
            email: value.email.trim(),
            password: value.password,
          }),
        });
      } catch {
        setAuthFormServerError(detailsForm, undefined, 'Setup could not be reached. Try again.');
        return;
      }

      if (!response.ok) {
        // Preserve the draft for correction; only an accepted request clears the password.
        const { code, error } = await readError(response);
        if (code === 'SETUP_COMPLETED') {
          clearStoredRequest();
          setIsClosed(true);
          return;
        }
        setAuthFormServerError(
          detailsForm,
          error,
          'Setup failed. Check the details and try again.',
        );
        return;
      }

      const payload: unknown = await response.json().catch(() => undefined);
      if (!isSetupRequestResponse(payload)) {
        setAuthFormServerError(detailsForm, undefined, 'Setup returned an unexpected response.');
        return;
      }

      detailsForm.setFieldValue('password', '');
      setIsInitialSend(true);
      setResendMessage(null);
      setResendError(null);
      accept(payload);
    },
  });
  const codeForm = useAuthForm({
    defaultValues: { code: '' },
    onSubmit: async ({ value }) => {
      if (!request) return;
      const code = value.code.trim();

      let response: Response;
      try {
        response = await fetch('/api/setup/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ requestId: request.requestId, code }),
        });
      } catch {
        setAuthFormServerError(
          codeForm,
          undefined,
          'Verification could not be reached. Try again.',
        );
        return;
      }

      if (!response.ok) {
        codeForm.setFieldValue('code', '');
        const { code: errorCode, error } = await readError(response);
        if (errorCode === 'SETUP_COMPLETED') {
          clearStoredRequest();
          setRequest(null);
          setIsClosed(true);
          return;
        }
        setAuthFormServerError(
          codeForm,
          error,
          'That code was not accepted. Request a new one and try again.',
        );
        return;
      }

      codeForm.setFieldValue('code', '');
      clearStoredRequest();
      setIsComplete(true);
      router.replace('/auth/sign-in');
    },
  });
  async function resend() {
    if (!request || isResending) return;
    setIsResending(true);
    setResendMessage(null);
    setResendError(null);
    try {
      let response: Response;
      try {
        response = await fetch('/api/setup/resend', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ requestId: request.requestId }),
        });
      } catch {
        setResendError('The resend could not be reached. Try again.');
        return;
      }

      if (!response.ok) {
        const { code, error } = await readError(response);
        if (code === 'SETUP_COMPLETED') {
          clearStoredRequest();
          setRequest(null);
          setIsClosed(true);
          return;
        }
        setResendError(
          safeActionErrorMessage(error, 'The code could not be resent. Try again shortly.'),
        );
        return;
      }

      const payload: unknown = await response.json().catch(() => undefined);
      if (!isSetupRequestResponse(payload)) {
        setResendError('The resend returned an unexpected response.');
        return;
      }

      codeForm.setFieldValue('code', '');
      setIsInitialSend(false);
      accept(payload);
      setResendMessage(
        payload.deliverySent
          ? 'A new code is on its way. The previous code no longer works.'
          : 'A new code was issued, but the email provider rejected it. The previous code no longer works.',
      );
    } finally {
      setIsResending(false);
    }
  }
  return {
    clock,
    request,
    isHydrated,
    deliverySent,
    codeForm,
    isComplete,
    isResending,
    resend,
    resendError,
    resendMessage,
    isInitialSend,
    detailsForm,
    isClosed,
  };
}
export type OwnerSetupState = ReturnType<typeof useOwnerSetup>;
