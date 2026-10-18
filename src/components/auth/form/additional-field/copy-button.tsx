'use client';

import { useAuth, useCopyToClipboard } from '@better-auth-ui/react';
import { Check, Copy } from 'lucide-react';
import { toast } from 'sonner';

import { InputGroupButton } from '@/components/ui/input-group';

type CopyButtonProps = {
  getValue: () => string | undefined;
  isDisabled?: boolean;
};

/**
 * Icon-only copy button used as an `InputGroupAddon`. `getValue` is invoked
 * lazily on click so the button copies the input's *live* value rather than a
 * stale snapshot — important when paired with editable inputs.
 */
export function CopyButton({ getValue, isDisabled }: CopyButtonProps) {
  const { localization } = useAuth();
  const { copied, copy } = useCopyToClipboard({
    onError: () => {
      toast.error(localization.errors.copyFailed);
    },
  });
  const label = copied
    ? localization.settings.copiedToClipboard
    : localization.settings.copyToClipboard;

  async function handleCopy() {
    const value = getValue();
    if (!value) return;

    await copy(value);
  }

  return (
    <InputGroupButton aria-label={label} title={label} onClick={handleCopy} disabled={isDisabled}>
      {copied ? <Check /> : <Copy />}
    </InputGroupButton>
  );
}
