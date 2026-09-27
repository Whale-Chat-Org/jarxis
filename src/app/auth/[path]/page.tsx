import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { viewPaths } from '@better-auth-ui/core';

import { Auth } from '@/components/auth/auth';
import { AuthCardSkeleton } from '@/components/skeletons';

export function generateStaticParams() {
  return Object.values(viewPaths.auth).map((path) => ({ path }));
}

export default async function AuthPage({ params }: { params: Promise<{ path: string }> }) {
  const { path } = await params;
  if (!Object.values(viewPaths.auth).includes(path)) notFound();

  return (
    <Suspense fallback={<AuthCardSkeleton />}>
      <Auth path={path} />
    </Suspense>
  );
}
