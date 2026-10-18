'use client';

import { useAuth } from '@better-auth-ui/react';
import type { ReactNode } from 'react';

import { FieldDescription } from '@/components/ui/field';

type AuthFooterLinkProps = {
  /** Lead-in text, e.g. "Already have an account?". */
  prompt: ReactNode;
  label: ReactNode;
  href: string;
};

/** "Prompt + link" line under an auth card, e.g. "Remember your password? Sign in". */
export function AuthFooterLink({ prompt, label, href }: AuthFooterLinkProps) {
  const { Link } = useAuth();

  return (
    <FieldDescription className="text-center">
      {prompt}{' '}
      <Link href={href} className="underline underline-offset-4">
        {label}
      </Link>
    </FieldDescription>
  );
}
