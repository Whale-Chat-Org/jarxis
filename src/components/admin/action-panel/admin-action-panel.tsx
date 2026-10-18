'use client';
import { Dialog, DialogContent } from '@/components/ui/admin-panel';
import { FieldError } from '@/components/ui/field';
import type { AdminActionPanelProps } from '@/types/admin-action-panel';

import { ActionPanelBody } from './action-panel-body';
import { AdminActionPanelFooter } from './action-panel-footer';
import { AdminActionPanelHeader } from './action-panel-header';
import { ActionPanelTabs } from './action-panel-tabs';

/** The only business-facing entry point for every administration side panel. */
export function AdminActionPanel({
  open,
  onOpenChange,
  header,
  state = {},
  actions,
  tabs,
  children,
}: AdminActionPanelProps) {
  const isPending = () => state.pending === true || state.pendingRef?.current === true;
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (value || !isPending()) onOpenChange(value);
      }}
    >
      <DialogContent
        layout="inspector"
        onKeyDown={(event) => {
          if (
            event.key !== 'Enter' ||
            event.defaultPrevented ||
            event.nativeEvent.isComposing ||
            event.shiftKey ||
            event.ctrlKey ||
            event.altKey ||
            event.metaKey
          )
            return;
          const input = event.target;
          if (
            !(input instanceof HTMLInputElement) ||
            !['text', 'email', 'password', 'number', 'search', 'url', 'tel'].includes(input.type)
          )
            return;
          const action = actions.find(
            (item) => item.type === 'submit' && item.formId === input.form?.id,
          );
          if (!action) return;
          event.preventDefault();
          if (!action.disabled && !isPending()) input.form?.requestSubmit();
        }}
        onEscapeKeyDown={(event) => {
          if (isPending()) event.preventDefault();
        }}
        onInteractOutside={(event) => {
          if (isPending()) event.preventDefault();
        }}
      >
        <AdminActionPanelHeader {...header} />
        {tabs && !state.loading ? (
          <ActionPanelTabs tabs={tabs} />
        ) : (
          <ActionPanelBody loading={state.loading}>{children}</ActionPanelBody>
        )}
        {state.error && (
          <div className="shrink-0 px-xl py-sm">
            <FieldError>{state.error}</FieldError>
          </div>
        )}
        <AdminActionPanelFooter
          actions={actions}
          pending={state.pending === true}
          isPending={isPending}
        />
      </DialogContent>
    </Dialog>
  );
}
