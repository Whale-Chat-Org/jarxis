import type { ReactNode, RefObject } from 'react';

export type AdminActionPanelHeader = {
  title: ReactNode;
  description?: ReactNode;
  leading?: ReactNode;
  trailing?: ReactNode;
};
export type AdminPanelAction = {
  id: string;
  label: ReactNode;
  pendingLabel?: ReactNode;
  variant?: 'default' | 'outline' | 'destructive' | 'secondary' | 'ghost';
  disabled?: boolean;
} & (
  | { type: 'submit'; formId: string; onClick?: never }
  | { type?: 'button'; onClick: () => void; formId?: never }
);
export type AdminActionPanelProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  header: AdminActionPanelHeader;
  state?: {
    loading?: boolean;
    pending?: boolean;
    pendingRef?: RefObject<boolean>;
    error?: ReactNode;
  };
  actions: readonly AdminPanelAction[];
  tabs?: {
    value: string;
    onValueChange: (value: string) => void;
    items: readonly {
      value: string;
      label: ReactNode;
      icon?: ReactNode;
      disabled?: boolean;
      content: ReactNode;
    }[];
  };
  children?: ReactNode;
};
