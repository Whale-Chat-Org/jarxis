import { redirect } from 'next/navigation';
import { connection } from 'next/server';

import { LandingPage } from '@/components/landing/landing-page';
import { ensureInitialOwnerSetupStatus } from '@/lib/initial-owner-setup';

export default async function HomePage() {
  await connection();
  if ((await ensureInitialOwnerSetupStatus()) === 'available') redirect('/setup');

  return <LandingPage />;
}
