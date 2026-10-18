import { DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/admin-panel';
import type { AdminActionPanelHeader as HeaderProps } from '@/types/admin-action-panel';

export function AdminActionPanelHeader({ title, description, leading, trailing }: HeaderProps) {
  return (
    <DialogHeader>
      <div className="flex min-w-none flex-wrap items-center justify-between gap-md">
        <div className="flex min-w-none flex-1 items-center gap-md">
          {leading}
          <div className="min-w-none">
            <DialogTitle className="truncate">{title}</DialogTitle>
            {description && (
              <DialogDescription className="wrap-break-word">{description}</DialogDescription>
            )}
          </div>
        </div>
        {trailing && <div className="flex shrink-0 items-center gap-sm">{trailing}</div>}
      </div>
    </DialogHeader>
  );
}
