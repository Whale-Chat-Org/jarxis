'use client';

import { usePathname } from 'next/navigation';

import { ThemeToggle } from '@/components/header/theme-toggle';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import { Separator } from '@/components/ui/separator';
import { SidebarTrigger } from '@/components/ui/sidebar';

import { NAV_GROUPS } from './nav-items';

/** Resolve the current route to its nav group and item title. */
function useCurrentNavItem() {
  const pathname = usePathname();
  const items = NAV_GROUPS.flatMap((group) => group.items.map((item) => ({ group, item })));
  const match = items
    .sort((a, b) => b.item.href.length - a.item.href.length)
    .find(({ item }) => pathname === item.href || pathname.startsWith(`${item.href}/`));

  return { group: match?.group.label ?? 'Admin', title: match?.item.title ?? 'Admin' };
}

export function SiteHeader() {
  const { group, title } = useCurrentNavItem();

  return (
    <header className="sticky top-none z-30 flex h-header shrink-0 items-center gap-md border-b bg-background/95 px-page backdrop-blur-panel transition-sidebar-header group-has-data-[collapsible=icon]/sidebar-wrapper:h-4xl supports-backdrop-filter:bg-background/60 md:px-page-lg">
      <SidebarTrigger className="-ml-2xs" />
      <Separator orientation="vertical" className="hidden h-control-xs md:block" />

      <Breadcrumb className="flex-1">
        <BreadcrumbList>
          <BreadcrumbItem className="hidden md:block">{group}</BreadcrumbItem>
          <BreadcrumbSeparator className="hidden md:block" />
          <BreadcrumbItem>
            <BreadcrumbPage>{title}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <ThemeToggle />
    </header>
  );
}
