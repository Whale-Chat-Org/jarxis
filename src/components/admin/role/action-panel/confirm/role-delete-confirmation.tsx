'use client';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import type { RolesManagementState } from '@/types/admin-roles';
export function RoleDeleteConfirmation({ state }: { state: RolesManagementState }) {
  const { deleteRole, setDeleteRole, saving, deleteError, remove } = state;
  return (
    <AlertDialog
      open={deleteRole !== null}
      onOpenChange={(value) => !value && !saving && setDeleteRole(null)}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete role?</AlertDialogTitle>
          <AlertDialogDescription>
            Delete {deleteRole?.name}? Users assigned to it must be moved first.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {deleteError && (
          <p role="alert" className="text-body-sm text-destructive">
            {deleteError}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={saving}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={saving}
            onClick={(event) => {
              event.preventDefault();
              if (deleteRole) void remove(deleteRole);
            }}
          >
            {saving ? 'Deleting…' : 'Delete role'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
