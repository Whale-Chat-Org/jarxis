import { viewPaths } from '@better-auth-ui/core';
import { notFound, redirect } from 'next/navigation';
import { connection } from 'next/server';
import { Suspense } from 'react';

import { Auth } from '@/components/auth/auth';
import { AuthCardSkeleton } from '@/components/skeletons';
import { ensureInitialOwnerSetupStatus } from '@/lib/initial-owner-setup';

export function generateStaticParams() {
  return Object.values(viewPaths.auth).map((path) => ({ path }));
}

export default async function AuthPage({ params }: { params: Promise<{ path: string }> }) {
  const { path } = await params;
  if (!Object.values(viewPaths.auth).includes(path)) notFound();

  if (path === viewPaths.auth.signIn) {
    await connection();
    if ((await ensureInitialOwnerSetupStatus()) === 'available') redirect('/setup');
  }

  return (
    <Suspense fallback={<AuthCardSkeleton />}>
      <Auth path={path} />
    </Suspense>
  );
}
