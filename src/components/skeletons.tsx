import type { ReactNode } from 'react';

import { Card, CardContent, CardHeader } from '@/components/ui/card';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuSkeleton,
  SidebarProvider,
} from '@/components/ui/sidebar';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';

// Announces loading once to assistive tech; the skeleton shapes themselves are decorative.
export function LoadingRegion({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div role="status" aria-busy="true" className={className}>
      <span className="sr-only">{label}</span>
      <div aria-hidden="true" className="contents">
        {children}
      </div>
    </div>
  );
}

export function PageHeaderSkeleton({ action }: { action?: ReactNode }) {
  return (
    <div className="flex flex-col gap-md sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-col gap-sm">
        <Skeleton className="h-control-xs w-bar-xl" />
        <Skeleton className="h-lg w-bar-5xl" />
      </div>
      {action}
    </div>
  );
}

// Varied widths so rows don't look like a solid block.
const CELL_WIDTHS = ['w-3/4', 'w-1/2', 'w-2/3', 'w-5/12', 'w-7/12'];

function TableRowsSkeleton({ columns, rows }: { columns: number; rows: number }) {
  return Array.from({ length: rows }, (_, row) => (
    <TableRow key={row} className="hover:bg-transparent">
      {Array.from({ length: columns }, (_, col) => (
        <TableCell key={col}>
          <Skeleton className={cn('h-lg', CELL_WIDTHS[(row + col) % CELL_WIDTHS.length])} />
        </TableCell>
      ))}
    </TableRow>
  ));
}

export function TableSkeleton({ columns, rows }: { columns: number; rows: number }) {
  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            {Array.from({ length: columns }, (_, col) => (
              <TableHead key={col}>
                <Skeleton className="h-lg w-bar-xs" />
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRowsSkeleton columns={columns} rows={rows} />
        </TableBody>
      </Table>
    </div>
  );
}

export function PaginationSkeleton() {
  return (
    <div className="flex items-center justify-between">
      <Skeleton className="h-lg w-bar-md" />
      <div className="flex items-center gap-sm">
        <Skeleton className="h-control-sm w-bar-sm" />
        <Skeleton className="h-control-sm w-bar-xs" />
      </div>
    </div>
  );
}

export function StatCardsSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid gap-lg sm:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: count }, (_, i) => (
        <Card key={i}>
          <CardHeader className="gap-md">
            <div className="flex items-center justify-between">
              <Skeleton className="h-lg w-bar-sm" />
              <Skeleton className="size-icon" />
            </div>
            <Skeleton className="h-xl-plus w-bar-3xs" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-md w-bar-xl" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export function ListCardSkeleton({ lines = 5 }: { lines?: number }) {
  return (
    <Card>
      <CardHeader className="gap-sm">
        <Skeleton className="h-lg-plus w-bar-2xl" />
        <Skeleton className="h-lg w-bar-6xl max-w-full" />
      </CardHeader>
      <CardContent className="flex flex-col gap-md">
        {Array.from({ length: lines }, (_, i) => (
          <div key={i} className="flex items-center justify-between gap-lg">
            <Skeleton className={cn('h-lg', CELL_WIDTHS[i % CELL_WIDTHS.length])} />
            <Skeleton className="h-md w-bar-xs shrink-0" />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export function AuthCardSkeleton() {
  return (
    <LoadingRegion label="Loading…" className="w-full max-w-narrow">
      <Card className="w-full">
        <CardHeader className="gap-sm">
          <Skeleton className="h-control-xs w-bar-md" />
          <Skeleton className="h-lg w-bar-5xl" />
        </CardHeader>
        <CardContent className="flex flex-col gap-lg-plus">
          {Array.from({ length: 2 }, (_, i) => (
            <div key={i} className="flex flex-col gap-sm">
              <Skeleton className="h-lg w-bar-xs" />
              <Skeleton className="h-control w-full" />
            </div>
          ))}
          <Skeleton className="h-control w-full" />
          <Skeleton className="mx-auto h-lg w-bar-3xl" />
        </CardContent>
      </Card>
    </LoadingRegion>
  );
}

// Mirrors the Better Auth UI `<Settings>` layout: tab nav plus stacked settings cards.
export function SettingsSkeleton() {
  return (
    <LoadingRegion label="Loading settings…" className="flex w-full flex-col gap-lg">
      <div className="flex gap-2xs border-b pb-sm">
        <Skeleton className="h-control w-bar-xl" />
        <Skeleton className="h-control w-bar-xl" />
      </div>
      <ListCardSkeleton lines={3} />
      <ListCardSkeleton lines={2} />
    </LoadingRegion>
  );
}

// Mirrors AdminShell (shadcn Sidebar + SidebarInset + sticky header) while grants load.
export function AdminShellSkeleton() {
  return (
    <LoadingRegion label="Loading administration…" className="h-svh">
      <SidebarProvider>
        <Sidebar collapsible="icon">
          <SidebarHeader>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuSkeleton showIcon className="h-control-lg" />
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarHeader>
          <SidebarContent>
            {[2, 3, 1].map((count, group) => (
              <SidebarGroup key={group}>
                <SidebarGroupLabel>
                  <Skeleton className="h-md w-bar-xs" />
                </SidebarGroupLabel>
                <SidebarMenu>
                  {Array.from({ length: count }, (_, index) => (
                    <SidebarMenuItem key={index}>
                      <SidebarMenuSkeleton showIcon />
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroup>
            ))}
          </SidebarContent>
          <SidebarFooter>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuSkeleton showIcon className="h-control-lg" />
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarFooter>
        </Sidebar>

        <SidebarInset>
          <div className="flex h-header shrink-0 items-center gap-md border-b px-page md:px-page-lg">
            <Skeleton className="size-control-sm" />
            <Skeleton className="h-lg w-bar-md flex-1 sm:flex-none" />
            <div className="ml-auto flex items-center gap-sm">
              <Skeleton className="size-control-sm" />
              <Skeleton className="size-avatar rounded-full" />
            </div>
          </div>
          <div className="flex flex-1 flex-col gap-section p-page md:p-page-lg">
            <PageHeaderSkeleton />
            <StatCardsSkeleton />
          </div>
        </SidebarInset>
      </SidebarProvider>
    </LoadingRegion>
  );
}

// Mirrors LandingPage's <main>: centred title. The real header and footer come from the
// `(public)` layout, so this skeleton never draws its own.
export function LandingSkeleton() {
  return (
    <LoadingRegion
      label="Loading…"
      className="flex flex-1 flex-col items-center justify-center gap-md px-page"
    >
      <Skeleton className="h-control-sm w-bar-xl" />
      <Skeleton className="h-lg w-bar-3xl" />
    </LoadingRegion>
  );
}
