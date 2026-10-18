import type { AdminPanelAction } from '@/types/admin-action-panel';
import type { InspectorFooterState } from '@/types/admin-users';
export function userProfileActions(
  state: InspectorFooterState,
  formId: string,
  name: string,
  email: string,
  canSubmit: boolean,
): AdminPanelAction[] {
  const { config, recordMode, canUpdate, canSetRole, isSelf, setRecordMode, onOpenChange } = state;
  return [
    ...(canUpdate.data?.success
      ? [
          {
            id: 'mode',
            label: recordMode === 'edit' ? 'View profile' : 'Edit profile',
            variant: 'outline' as const,
            onClick: () => setRecordMode((mode) => (mode === 'edit' ? 'view' : 'edit')),
          },
        ]
      : []),
    {
      id: 'cancel',
      label: config.localization.cancel,
      variant: 'outline',
      onClick: () => onOpenChange(false),
    },
    {
      id: 'save',
      label: config.localization.saveChanges,
      type: 'submit',
      formId,
      disabled:
        recordMode === 'view' ||
        !name.trim() ||
        !email.trim() ||
        !canSubmit ||
        canUpdate.isPending ||
        canSetRole.isPending ||
        (!canUpdate.data?.success && (!canSetRole.data?.success || isSelf)),
    },
  ];
}
