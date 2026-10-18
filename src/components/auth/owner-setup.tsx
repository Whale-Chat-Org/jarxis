'use client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { FieldDescription, FieldGroup } from '@/components/ui/field';
import { passwordPolicy } from '@/lib/password-policy';
import { validateEmailAddress, validateStringLength } from '@better-auth-ui/core';
import {
  formatCountdown,
  secondsUntil,
  useOwnerSetup,
  type OwnerSetupState,
} from './owner-setup-state';
import { SetupCompleted } from './setup-completed';
export function OwnerSetup() {
  const flow = useOwnerSetup();
  if (flow.isClosed) return <SetupCompleted />;
  return flow.request ? <OwnerSetupCodeStep flow={flow} /> : <OwnerSetupDetailsStep flow={flow} />;
}
function OwnerSetupCodeStep({ flow }: { flow: OwnerSetupState }) {
  const {
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
  } = flow;
  if (!request) return null;
  const expiresIn = isHydrated ? secondsUntil(request.expiresAt, clock) : 0;
  const cooldown = isHydrated ? secondsUntil(request.resendAvailableAt, clock) : 0;
  const isExpired = isHydrated && expiresIn <= 0;

  let shownHint = `This code expires in ${formatCountdown(expiresIn)}. Resending invalidates the previous code.`;
  if (isInitialSend)
    shownHint = `Code sent — check your email. It expires in ${formatCountdown(expiresIn)}.`;
  if (!deliverySent)
    shownHint =
      'Email delivery failed. Resend once the cooldown ends, or enter a code that arrived anyway.';
  if (isExpired) shownHint = 'That code has expired. Resend to get a new one.';
  shownHint = resendError ?? resendMessage ?? shownHint;
  if (isComplete) shownHint = 'Owner created. Redirecting to sign-in…';
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
                    }) ?? (/^\d{6}$/.test(value.trim()) ? undefined : 'The code is 6 digits, 0-9.'),
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
            {shownHint}
          </FieldDescription>
        </div>
      </CardContent>
    </Card>
  );
}
function OwnerSetupDetailsStep({ flow }: { flow: OwnerSetupState }) {
  const { detailsForm } = flow;
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
                      maxLength: passwordPolicy.maxLength,
                      maxLengthMessage: 'Password must be 128 characters or fewer.',
                      minLength: passwordPolicy.minLength,
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
