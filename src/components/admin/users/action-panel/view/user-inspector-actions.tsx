'use client';
import { EllipsisIcon, LogInIcon } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { InspectorHeaderState } from '@/types/admin-users';
export function UserInspectorActions({ state }: { state: InspectorHeaderState }) {
  const {
    user,
    config,
    canImpersonate,
    targetIsAdmin,
    canImpersonateAdmins,
    isSelf,
    setDangerousAction,
  } = state;
  if (!user) return null;
  return (
    <>
      {' '}
      <Badge variant={user.banned ? 'destructive' : 'secondary'}>
        {user.banned ? config.localization.banned : config.localization.active}
      </Badge>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button aria-label={config.localization.moreActions} size="icon-sm" variant="ghost">
            <EllipsisIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-menu-xs">
          <DropdownMenuGroup>
            <DropdownMenuItem
              disabled={
                canImpersonate.isPending ||
                !canImpersonate.data?.success ||
                (targetIsAdmin &&
                  (canImpersonateAdmins.isPending || !canImpersonateAdmins.data?.success)) ||
                isSelf
              }
              onSelect={() => setDangerousAction('impersonate')}
            >
              <LogInIcon />
              {config.localization.impersonateUser}
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
