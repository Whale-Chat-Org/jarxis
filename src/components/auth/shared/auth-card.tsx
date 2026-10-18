import type { ReactNode } from 'react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

type AuthCardProps = {
  title: ReactNode;
  className?: string;
  /** Rendered above the title, e.g. `AuthPrompts` or a notice. */
  header?: ReactNode;
  /** Centred links under the content, e.g. switching between sign-in and sign-up. */
  footer?: ReactNode;
  children?: ReactNode;
};

/** Narrow card shell shared by every auth form view. */
export function AuthCard({ title, className, header, footer, children }: AuthCardProps) {
  return (
    <Card className={cn('w-full max-w-narrow', className)}>
      {header}
      <CardHeader>
        <CardTitle className="text-title font-semibold">{title}</CardTitle>
      </CardHeader>

      <CardContent>
        {children}

        {footer ? (
          <div className="mt-lg flex w-full flex-col items-center gap-md">{footer}</div>
        ) : null}
      </CardContent>
    </Card>
  );
}
