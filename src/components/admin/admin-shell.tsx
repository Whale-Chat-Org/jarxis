import { cookies } from 'next/headers';
import type { ReactNode } from 'react';

import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';

import { AppSidebar } from './app-sidebar';
import { SiteHeader } from './site-header';

/**
 * Administration frame built on the shadcn `Sidebar` composition
 * (SidebarProvider → Sidebar/SidebarInset), so the collapsible desktop rail and the
 * mobile Sheet come from the registry primitive instead of local markup.
 */
export async function AdminShell({
  permissions,
  children,
}: {
  permissions: string[];
  children: ReactNode;
}) {
  // The primitive writes this cookie; reading it back avoids a collapsed-state flash.
  const defaultOpen = (await cookies()).get('sidebar_state')?.value !== 'false';

  return (
    <SidebarProvider defaultOpen={defaultOpen}>
      <AppSidebar permissions={permissions} />
      <SidebarInset>
        <SiteHeader />
        <div className="flex flex-1 flex-col p-page md:p-page-lg">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}
