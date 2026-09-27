import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { PublicFooter, PublicHeader } from '@/components/public-chrome';
import { HttpError } from '@/lib/errors';
import { pageGrants } from '@/lib/rbac';

/**
 * Frames the Better Auth UI settings views with the public chrome, and keeps the account
 * area behind the same server-side authorization the rest of the app uses — the client-side
 * `useAuthenticate` guard inside `<Settings>` is a redirect convenience, not the boundary.
 */
export default async function SettingsLayout({ children }: { children: ReactNode }) {
  try {
    await pageGrants();
  } catch (error) {
    if (error instanceof HttpError && error.status === 401) redirect('/auth/sign-in');
    if (error instanceof HttpError && error.status === 403) redirect('/access-denied');
    throw error;
  }

  return (
    <div className="flex min-h-svh flex-col bg-background text-foreground">
      <PublicHeader />
      <main className="flex flex-1 flex-col items-center bg-muted/30 p-page md:p-3xl">
        <div className="w-full max-w-content">{children}</div>
      </main>
      <PublicFooter />
    </div>
  );
}
