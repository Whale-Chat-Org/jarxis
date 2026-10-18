'use client';

import { useAuth } from '@better-auth-ui/react';

import { cn } from '@/lib/utils';

/** The first captcha a registered plugin provides, or nothing. */
export function AuthCaptcha({ className }: { className?: string }) {
  const { plugins } = useAuth();
  const Captcha = plugins.find((plugin) => plugin.captchaComponent)?.captchaComponent;

  if (!Captcha) return null;

  return <div className={cn('flex justify-center', className)}>{Captcha}</div>;
}
