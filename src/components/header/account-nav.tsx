'use client';

import { useAuth, useSession } from '@better-auth-ui/react';
import { LayoutDashboardIcon } from 'lucide-react';
import Link from 'next/link';

import { UserButton } from '@/components/header/user/user-button';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useIsMobile } from '@/hooks/use-mobile';

export function AccountNav({ canAccessAdmin }: { canAccessAdmin: boolean }) {
  const { authClient } = useAuth();
  const { data: session, isPending } = useSession(authClient);
  const isMobile = useIsMobile();

  if (isPending) return <Skeleton className="h-control w-menu-xs" />;

  if (!session) {
    return (
      <>
        <Button asChild variant="ghost">
          <Link href="/auth/sign-in">Sign in</Link>
        </Button>
        <Button asChild>
          <Link href="/auth/sign-up">Sign up</Link>
        </Button>
      </>
    );
  }

  return (
    <UserButton
      align="end"
      className="max-w-menu-xs"
      size={isMobile ? 'icon' : 'default'}
      links={
        canAccessAdmin
          ? [
              {
                label: 'Administration',
                href: '/admin',
                icon: <LayoutDashboardIcon className="text-muted-foreground" />,
                visibility: 'authenticated',
              },
            ]
          : undefined
      }
    />
  );
}
