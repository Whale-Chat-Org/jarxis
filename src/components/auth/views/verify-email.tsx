'use client';

import { useAuth, useSendVerificationEmail } from '@better-auth-ui/react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { AuthCard } from '@/components/auth/shared/auth-card';
import { AuthFooterLink } from '@/components/auth/shared/auth-footer-link';
import { OpenEmailButton } from '@/components/auth/shared/open-email-button';
import { Button } from '@/components/ui/button';
import { FieldDescription } from '@/components/ui/field';
import { Spinner } from '@/components/ui/spinner';
import { useAuthViewPath } from '@/hooks/use-auth-view-path';
import { useStoredEmail } from '@/hooks/use-stored-email';
import { VERIFY_EMAIL_STORAGE_KEY } from '@/lib/auth/auth-storage';

export type VerifyEmailProps = {
  className?: string;
};

/** Seconds the resend button stays disabled to prevent spamming the endpoint. */
const RESEND_COOLDOWN_SECONDS = 60;

/**
 * Render a card prompting the user to verify their email, with a resend button
 * that is rate-limited by a cooldown timer.
 *
 * The target email is read from `sessionStorage` (set when sign-up or sign-in
 * redirects here); the OpenEmail/Resend controls are only shown when an email
 * is stored. The resend button is disabled while a cooldown is active and shows
 * the remaining seconds.
 *
 * @param className - Additional CSS classes applied to the card
 * @returns The verify-email card React element
 */
export function VerifyEmail({ className }: VerifyEmailProps) {
  const { authClient, baseURL, localization, redirectTo } = useAuth();
  const authViewPath = useAuthViewPath();
  const email = useStoredEmail(VERIFY_EMAIL_STORAGE_KEY);
  const [cooldown, setCooldown] = useState(RESEND_COOLDOWN_SECONDS);

  useEffect(() => {
    if (cooldown <= 0 || !email) return;

    const interval = setInterval(() => {
      setCooldown((current) => (current > 0 ? current - 1 : 0));
    }, 1000);

    return () => clearInterval(interval);
  }, [cooldown, email]);

  const { mutate: sendVerificationEmail, isPending } = useSendVerificationEmail(authClient, {
    onSuccess: () => {
      toast.success(localization.auth.verificationEmailSent);
      setCooldown(RESEND_COOLDOWN_SECONDS);
    },
  });

  const isCoolingDown = cooldown > 0;

  return (
    <AuthCard
      className={className}
      title={localization.auth.verifyEmail}
      footer={
        <AuthFooterLink
          prompt={localization.auth.alreadyVerifiedYourEmail}
          label={localization.auth.signIn}
          href={authViewPath('signIn')}
        />
      }
    >
      <div className="flex flex-col gap-lg">
        <FieldDescription>{localization.auth.checkYourEmail}</FieldDescription>

        {email && (
          <div className="flex flex-col gap-md">
            <OpenEmailButton email={email} />

            <Button
              type="button"
              variant="outline"
              disabled={isCoolingDown || isPending}
              onClick={() =>
                sendVerificationEmail({ email, callbackURL: `${baseURL}${redirectTo}` })
              }
            >
              {isPending && <Spinner />}

              {isCoolingDown
                ? localization.auth.resendIn.replace('{{seconds}}', String(cooldown))
                : localization.auth.resend}
            </Button>
          </div>
        )}
      </div>
    </AuthCard>
  );
}
