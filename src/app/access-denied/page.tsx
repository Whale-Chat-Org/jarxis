import { ShieldXIcon } from 'lucide-react';
import Link from 'next/link';

import { Button } from '@/components/ui/button';

export default function AccessDeniedPage() {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-xl p-xl text-center">
      <div className="flex size-hero-icon items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <ShieldXIcon className="size-control-sm" />
      </div>

      <div className="flex flex-col gap-sm">
        <h1 className="text-headline font-semibold tracking-tight">
          You don&apos;t have access to this page
        </h1>
        <p className="max-w-narrow text-body-sm text-muted-foreground">
          Your account doesn&apos;t have the permissions required to view this. If you believe this
          is a mistake, ask an administrator to update your role.
        </p>
      </div>

      <div className="flex items-center gap-md">
        <Button asChild variant="outline">
          <Link href="/">Go home</Link>
        </Button>
        <Button asChild variant="ghost">
          <Link href="/auth/sign-out">Sign out</Link>
        </Button>
      </div>
    </main>
  );
}
