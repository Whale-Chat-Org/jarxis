'use client';

import { getAuthLinkURL } from '@better-auth-ui/core';
import { useAuth } from '@better-auth-ui/react';

import { AuthCard } from '@/components/auth/shared/auth-card';
import { AuthFooterLink } from '@/components/auth/shared/auth-footer-link';
import { OpenEmailButton } from '@/components/auth/shared/open-email-button';
import { FieldDescription } from '@/components/ui/field';
import { useAuthViewPath } from '@/hooks/use-auth-view-path';
import { useStoredEmail } from '@/hooks/use-stored-email';
import { RESET_LINK_SENT_STORAGE_KEY } from '@/lib/auth/auth-storage';

export type ResetLinkSentProps = {
  className?: string;
};

/**
 * Render a card confirming that a password-reset email was sent, with a
 * button to open the user's email provider.
 *
 * The target email is read from `sessionStorage` (set when the forgot-password
 * form redirects here); the OpenEmail button is only shown when an email is
 * stored and resolves to a known provider.
 *
 * @param className - Additional CSS classes applied to the card
 * @returns The reset-link-sent card React element
 */
export function ResetLinkSent({ className }: ResetLinkSentProps) {
  const { localization, redirectTo } = useAuth();
  const authViewPath = useAuthViewPath();
  const email = useStoredEmail(RESET_LINK_SENT_STORAGE_KEY);

  return (
    <AuthCard
      className={className}
      title={localization.auth.checkYourEmailTitle}
      footer={
        <AuthFooterLink
          prompt={localization.auth.rememberYourPassword}
          label={localization.auth.signIn}
          href={getAuthLinkURL(authViewPath('signIn'), redirectTo)}
        />
      }
    >
      <div className="flex flex-col gap-lg">
        <FieldDescription>
          {email
            ? localization.auth.resetLinkSentTo.replace('{{email}}', email)
            : localization.auth.passwordResetEmailSent}
        </FieldDescription>

        {email && <OpenEmailButton email={email} />}
      </div>
    </AuthCard>
  );
}
