'use client';

import { validateEmailAddress, validateStringLength } from '@better-auth-ui/core';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { FieldDescription, FieldGroup } from '@/components/ui/field';
import { safeActionErrorMessage } from '@/lib/action-errors';
import { setAuthFormServerError, useAuthForm } from './auth-form';
import { useIsHydrated } from './use-is-hydrated';

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
function secondsUntil(timestamp: string) {
  const target = new Date(timestamp).getTime();
  if (Number.isNaN(target)) return 0;
  return Math.max(0, Math.ceil((target - Date.now()) / 1000));
}

function formatCountdown(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return minutes > 0 ? `${minutes}m ${String(rest).padStart(2, '0')}s` : `${rest}s`;
}

export function OwnerSetup() {
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
  // Re-rendered every second so the cooldown and expiry countdowns stay live.
  const [, setTick] = useState(0);

  // Resume the code step after a refresh. Only the handle survives, so the visitor re-enters the
  // code (or resends) without ever having a password or code read back out of storage.
  useEffect(() => {
    const stored = readStoredRequest();
    if (!stored) return;
    setRequest(stored);
    setDeliverySent(stored.deliverySent ?? true);
    setIsInitialSend(false);
  }, []);

  useEffect(() => {
    if (!request || isComplete) return;
    const interval = setInterval(() => setTick((current) => current + 1), 1000);
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
        detailsForm.setFieldValue('password', '');
        setAuthFormServerError(detailsForm, undefined, 'Setup could not be reached. Try again.');
        return;
      }

      if (!response.ok) {
        // Never keep the password in form state after a rejected attempt.
        detailsForm.setFieldValue('password', '');
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
        detailsForm.setFieldValue('password', '');
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

  if (isClosed) {
    return (
      <Card className="w-full max-w-narrow">
        <CardHeader>
          <CardTitle role="heading" aria-level={1} className="text-title font-semibold">
            Setup already completed
          </CardTitle>
          <CardDescription>
            This deployment already has an owner, so the first-run form is closed permanently.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild className="w-full">
            <Link href="/auth/sign-in">Go to sign-in</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (request) {
    const expiresIn = isHydrated ? secondsUntil(request.expiresAt) : 0;
    const cooldown = isHydrated ? secondsUntil(request.resendAvailableAt) : 0;
    const isExpired = isHydrated && expiresIn <= 0;

    return (
      <Card className="w-full max-w-narrow">
        <CardHeader>
          <CardTitle role="heading" aria-level={1} className="text-title font-semibold">
            Enter your owner code
          </CardTitle>
          <CardDescription>
            {deliverySent
              ? `We emailed a six-digit code to ${request.email}. Check your inbox, including spam.`
              : `We could not deliver the email to ${request.email}. If a code did arrive, you can still enter it; otherwise resend.`}
          </CardDescription>
        </CardHeader>

        <CardContent>
          <codeForm.AppForm>
            <codeForm.AuthFormRoot
              aria-busy={isComplete || undefined}
              serverErrorMessage="That code was not accepted. Request a new one and try again."
            >
              <FieldGroup>
                <codeForm.AppField
                  name="code"
                  validators={{
                    onChange: ({ value }) =>
                      validateStringLength(value, {
                        maxLength: 6,
                        maxLengthMessage: 'The code is exactly 6 digits.',
                        minLength: 6,
                        minLengthMessage: 'The code is exactly 6 digits.',
                        requiredMessage: 'Enter the 6-digit code from the email.',
                        trim: true,
                      }) ??
                      (/^\d{6}$/.test(value.trim()) ? undefined : 'The code is 6 digits, 0-9.'),
                  }}
                >
                  {(field) => (
                    <field.AuthFormTextField
                      autoComplete="one-time-code"
                      description="Six digits, valid for 10 minutes, five attempts."
                      inputMode="numeric"
                      label="Owner code"
                      maxLength={6}
                      required
                      spellCheck={false}
                      type="text"
                    />
                  )}
                </codeForm.AppField>

                <codeForm.AuthFormServerError />

                <codeForm.AuthFormSubmitButton disabled={isComplete} isPending={isComplete}>
                  Verify and create owner
                </codeForm.AuthFormSubmitButton>
              </FieldGroup>
            </codeForm.AuthFormRoot>
          </codeForm.AppForm>

          <div className="mt-lg flex flex-col gap-md">
            <Button
              disabled={isResending || cooldown > 0 || isComplete}
              onClick={resend}
              type="button"
              variant="outline"
            >
              {isResending
                ? 'Sending a new code…'
                : cooldown > 0
                  ? `Resend code in ${formatCountdown(cooldown)}`
                  : 'Resend code'}
            </Button>

            <FieldDescription aria-live="polite" className="text-center">
              {isComplete
                ? 'Owner created. Redirecting to sign-in…'
                : (resendError ??
                  resendMessage ??
                  (isExpired
                    ? 'That code has expired. Resend to get a new one.'
                    : !deliverySent
                      ? 'Email delivery failed. Resend once the cooldown ends, or enter a code that arrived anyway.'
                      : isInitialSend
                        ? `Code sent — check your email. It expires in ${formatCountdown(expiresIn)}.`
                        : `This code expires in ${formatCountdown(expiresIn)}. Resending invalidates the previous code.`))}
            </FieldDescription>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-narrow">
      <CardHeader>
        <CardTitle role="heading" aria-level={1} className="text-title font-semibold">
          Create the first owner
        </CardTitle>
        <CardDescription>
          This one-time form creates the initial owner account. We email a six-digit code to confirm
          the address, and the form closes permanently once an owner exists.
        </CardDescription>
      </CardHeader>

      <CardContent>
        <detailsForm.AppForm>
          <detailsForm.AuthFormRoot serverErrorMessage="Setup failed. Check the details and try again.">
            <FieldGroup>
              <detailsForm.AppField
                name="name"
                validators={{
                  onChange: ({ value }) =>
                    validateStringLength(value, {
                      maxLength: 100,
                      maxLengthMessage: 'Name must be 100 characters or fewer.',
                      minLength: 1,
                      minLengthMessage: 'Name is required.',
                      requiredMessage: 'Name is required.',
                      trim: true,
                    }),
                }}
              >
                {(field) => (
                  <field.AuthFormTextField
                    autoComplete="name"
                    label="Name"
                    maxLength={100}
                    required
                    type="text"
                  />
                )}
              </detailsForm.AppField>

              <detailsForm.AppField
                name="email"
                validators={{
                  onChange: ({ value }) =>
                    validateStringLength(value, {
                      maxLength: 254,
                      maxLengthMessage: 'Email must be 254 characters or fewer.',
                      trim: true,
                    }) ??
                    validateEmailAddress(value, {
                      invalidMessage: 'Enter a valid email address.',
                      requiredMessage: 'Email is required.',
                    }),
                }}
              >
                {(field) => (
                  <field.AuthFormTextField
                    autoComplete="email"
                    description="The code is sent here, so use an inbox you can open now."
                    label="Email"
                    maxLength={254}
                    required
                    type="email"
                  />
                )}
              </detailsForm.AppField>

              <detailsForm.AppField
                name="password"
                validators={{
                  onChange: ({ value }) =>
                    validateStringLength(value, {
                      maxLength: 128,
                      maxLengthMessage: 'Password must be 128 characters or fewer.',
                      minLength: 12,
                      minLengthMessage: 'Password must be at least 12 characters.',
                      requiredMessage: 'Password is required.',
                    }),
                }}
              >
                {(field) => (
                  <field.AuthFormTextField
                    autoComplete="new-password"
                    description="At least 12 characters."
                    label="Password"
                    maxLength={128}
                    minLength={12}
                    required
                    type="password"
                  />
                )}
              </detailsForm.AppField>

              <detailsForm.AuthFormServerError />

              <detailsForm.AuthFormSubmitButton>Email me a code</detailsForm.AuthFormSubmitButton>

              <FieldDescription className="text-center">
                Owner access is enabled only after the emailed code is verified.
              </FieldDescription>
            </FieldGroup>
          </detailsForm.AuthFormRoot>
        </detailsForm.AppForm>
      </CardContent>
    </Card>
  );
}
