import { viewPaths } from '@better-auth-ui/core';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';

import { Settings } from '@/components/settings/settings';
import { SettingsSkeleton } from '@/components/skeletons';

export default async function SettingsPage({ params }: { params: Promise<{ path: string }> }) {
  const { path } = await params;
  if (!Object.values(viewPaths.settings).includes(path)) notFound();

  return (
    <Suspense fallback={<SettingsSkeleton />}>
      <Settings path={path} />
    </Suspense>
  );
}
