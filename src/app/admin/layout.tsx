import { Suspense, type ReactNode } from 'react';
import { redirect } from 'next/navigation';

import { AdminShell } from '@/components/admin/admin-shell';
import { AdminShellSkeleton } from '@/components/skeletons';
import { HttpError } from '@/lib/errors';
import { pageGrants } from '@/lib/rbac';

async function AdminFrame({ children }: { children: ReactNode }) {
  let permissions: Set<string>;

  try {
    permissions = (await pageGrants()).permissions as Set<string>;
  } catch (e) {
    if (e instanceof HttpError && e.status === 401) redirect('/auth/sign-in');
    throw e;
  }

  return <AdminShell permissions={[...permissions]}>{children}</AdminShell>;
}

// loading.tsx never wraps its own segment's layout, so the grants lookup gets its own boundary.
export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<AdminShellSkeleton />}>
      <AdminFrame>{children}</AdminFrame>
    </Suspense>
  );
}
