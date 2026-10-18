'use client';

import {
  type AuthResult,
  type AuthResultAction,
  getAuthResultMessage,
  parseAuthResult,
} from '@better-auth-ui/core';
import { useAuth } from '@better-auth-ui/react';
import { CircleCheckIcon, CircleXIcon, type LucideIcon, TriangleAlertIcon } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuthViewPath } from '@/hooks/use-auth-view-path';
import { cn } from '@/lib/utils';

type AuthResultProps = {
  className?: string;
  fallbackIntent: 'danger' | 'success';
};

const INTENT_STYLES: Record<AuthResult['intent'], { Icon: LucideIcon; className: string }> = {
  success: { Icon: CircleCheckIcon, className: 'text-primary' },
  warning: { Icon: TriangleAlertIcon, className: 'text-warning' },
  danger: { Icon: CircleXIcon, className: 'text-destructive' },
};

function useResultAction(result: AuthResult) {
  const { basePaths, localization, viewPaths } = useAuth();
  const authViewPath = useAuthViewPath();

  const actions: Record<AuthResultAction, { label: string; to: string }> = {
    accountSettings: {
      label: localization.auth.callbackViewAccountSettings,
      to: `${basePaths.settings}/${viewPaths.settings.security}`,
    },
    continue: { label: localization.auth.callbackContinue, to: result.redirectTo ?? '/' },
    forgotPassword: { label: localization.auth.forgotPassword, to: authViewPath('forgotPassword') },
    signIn: { label: localization.auth.signIn, to: authViewPath('signIn') },
    signUp: { label: localization.auth.signUp, to: authViewPath('signUp') },
    verifyEmail: { label: localization.auth.verifyEmail, to: authViewPath('verifyEmail') },
  };

  return actions[result.action] ?? actions.signIn;
}

function AuthResultView({ className, fallbackIntent }: AuthResultProps) {
  const { localization, navigate } = useAuth();
  const [result, setResult] = useState<AuthResult>(() => parseAuthResult('', fallbackIntent));

  useEffect(() => {
    setResult(parseAuthResult(window.location.search, fallbackIntent));
  }, [fallbackIntent]);

  const message = getAuthResultMessage(result, localization);
  const action = useResultAction(result);
  const { Icon, className: iconClassName } = INTENT_STYLES[result.intent];

  return (
    <Card className={cn('w-full max-w-narrow', className)}>
      <CardHeader className="justify-items-center text-center">
        <Icon aria-hidden="true" className={cn('mb-2xs size-control-lg', iconClassName)} />
        <CardTitle className="text-title">{message.title}</CardTitle>
        <CardDescription>{message.description}</CardDescription>
      </CardHeader>
      <CardContent>
        <Button className="w-full" onClick={() => navigate({ to: action.to })}>
          {action.label}
        </Button>
      </CardContent>
    </Card>
  );
}

export function AuthCallback(props: Omit<AuthResultProps, 'fallbackIntent'>) {
  return <AuthResultView {...props} fallbackIntent="success" />;
}

export function AuthError(props: Omit<AuthResultProps, 'fallbackIntent'>) {
  return <AuthResultView {...props} fallbackIntent="danger" />;
}
