import { CheckCircle2Icon } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { connection } from 'next/server';

import { OwnerSetup } from '@/components/auth/owner-setup';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
// Resolves 'available' | 'completed' from the persistent installation marker and any existing
// owner. There is no configuration switch: the route is public until an owner exists.
import { getInitialOwnerSetupStatus } from '@/lib/initial-owner-setup';

export const metadata: Metadata = {
  title: 'First owner setup',
  robots: { index: false, follow: false },
};

/**
 * `/setup` — the public first-run owner bootstrap.
 *
 * Availability is decided per request on the server. `connection()` keeps the page out of the
 * prerendered shell, because the status depends on live database state and must never be cached
 * into a static response: a stale "available" shell would advertise a closed route, and a stale
 * "completed" shell would hide a legitimate first run.
 *
 * Anyone may open the form, but Owner access is granted only after the six-digit code emailed
 * to the submitted address is verified.
 */
export default async function SetupPage() {
  await connection();
  const status = await getInitialOwnerSetupStatus();

  if (status !== 'completed') return <OwnerSetup />;

  return (
    <Card className="w-full max-w-narrow">
      <CardHeader>
        <div
          aria-hidden="true"
          className="flex size-control-lg items-center justify-center rounded-full bg-muted text-muted-foreground"
        >
          <CheckCircle2Icon className="size-icon-lg" />
        </div>
        <CardTitle role="heading" aria-level={1} className="text-title font-semibold">
          Setup already completed
        </CardTitle>
        <CardDescription>
          This deployment already has an owner, so the first-run form is closed permanently.
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-lg">
        <Button asChild>
          <Link href="/auth/sign-in">Go to sign-in</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
