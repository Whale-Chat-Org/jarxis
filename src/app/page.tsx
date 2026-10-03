import { redirect } from 'next/navigation';
import { connection } from 'next/server';

import { LandingPage } from '@/components/landing/landing-page';
import { getInitialOwnerSetupStatus } from '@/lib/initial-owner-setup';

export default async function HomePage() {
  await connection();
  if ((await getInitialOwnerSetupStatus()) === 'available') redirect('/setup');

  return <LandingPage />;
}
