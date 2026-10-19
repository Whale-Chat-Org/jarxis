'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ComponentProps } from 'react';

import { UserButton } from '@/components/header/user/user-button';
import { BrandMark } from '@/components/brand';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from '@/components/ui/sidebar';

import { useNavigationPermissions } from './use-navigation-permissions';
import { isNavItemActive, visibleNavGroups } from './nav-items';

/**
 * Administration navigation, following the shadcn `AppSidebar` composition:
 * `SidebarHeader` → `SidebarContent` (one `SidebarGroup` per section) → `SidebarFooter`, with
 * `SidebarRail` for the resize affordance. The route → permission data lives in `nav-items.ts`;
 * this file only renders it.
 */
export function AppSidebar({
  permissions,
  ...props
}: ComponentProps<typeof Sidebar> & { permissions: string[] }) {
  const pathname = usePathname();
  const { isMobile, state } = useSidebar();
  const groups = visibleNavGroups(useNavigationPermissions(permissions));
  // The registry UserButton ships its own trigger, so the collapsed rail switches to its icon
  // size instead of restyling the component.
  const accountSize = !isMobile && state === 'collapsed' ? 'icon' : 'default';

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            {/*
              Collapsed to the icon rail the wordmark is hidden, so the link carries its own
              accessible name and a tooltip — matching how every nav item behaves. The mark is
              centred because the button loses its text column at that width.
             */}
            <SidebarMenuButton size="lg" asChild tooltip="Jarxis Admin">
              <Link
                href="/admin"
                aria-label="Jarxis Admin"
                className="group-data-[collapsible=icon]:justify-center"
              >
                <BrandMark />
                <span className="text-body-sm font-semibold group-data-[collapsible=icon]:hidden">
                  Jarxis Admin
                </span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        {groups.map((group) => (
          <SidebarGroup key={group.id}>
            <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            <SidebarMenu>
              {group.items.map((item) => (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton
                    asChild
                    isActive={isNavItemActive(pathname, item.href)}
                    tooltip={item.title}
                  >
                    <Link href={item.href}>
                      <item.icon />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <UserButton
              align={isMobile ? 'start' : 'end'}
              className="w-full"
              side={isMobile ? 'bottom' : 'right'}
              size={accountSize}
            />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  );
}
