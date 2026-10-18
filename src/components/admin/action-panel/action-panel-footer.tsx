import { DialogFooter } from '@/components/ui/admin-panel';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import type { AdminPanelAction } from '@/types/admin-action-panel';

export function AdminActionPanelFooter({
  actions,
  pending,
  isPending,
}: {
  actions: readonly AdminPanelAction[];
  pending: boolean;
  isPending: () => boolean;
}) {
  if (!actions.length) return null;
  return (
    <DialogFooter>
      {actions.map((action) => (
        <Button
          key={action.id}
          type={action.type ?? 'button'}
          form={action.formId}
          variant={action.variant}
          disabled={pending || action.disabled}
          onClick={(event) => {
            if (isPending()) {
              event.preventDefault();
              return;
            }
            if (action.type !== 'submit') action.onClick();
          }}
        >
          {pending && action.variant !== 'outline' && <Spinner />}
          {pending ? (action.pendingLabel ?? action.label) : action.label}
        </Button>
      ))}
    </DialogFooter>
  );
}
