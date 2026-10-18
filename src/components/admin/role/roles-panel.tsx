'use client';
import { Button } from '@/components/ui/button';
import type { RolesManagerProps } from '@/types/admin-roles';

import { RoleDeleteConfirmation } from './action-panel/confirm/role-delete-confirmation';
import { RoleActionPanel } from './action-panel/shared/role-action-panel';
import { RolesTable } from './table/roles-table';
import { useRolesManagement } from './use-roles-management';
export type { RoleView } from '@/lib/admin-contracts';
export function RolesPanel(props: RolesManagerProps) {
  const state = useRolesManagement(props);
  const { canManage, open, deleteError, deleteRole } = state;
  return (
    <div className="flex flex-col gap-section">
      <div className="flex flex-wrap items-start justify-between gap-md">
        <div>
          <h2 className="text-heading font-semibold">Roles</h2>
          <p className="text-body-sm text-muted-foreground">
            Owner and User are locked. Changes to other roles apply on the next request.
          </p>
        </div>
        {canManage && <Button onClick={() => open()}>Create role</Button>}
      </div>
      {deleteError && !deleteRole && (
        <p role="alert" className="text-body-sm text-destructive">
          {deleteError}
        </p>
      )}
      <RolesTable state={state} />
      <RoleActionPanel state={state} />
      <RoleDeleteConfirmation state={state} />
    </div>
  );
}
