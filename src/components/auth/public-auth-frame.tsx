import { PublicFooter, PublicHeader } from '@/components/public-chrome';
import type { ReactNode } from 'react';

export function PublicAuthFrame({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-svh flex-col bg-background text-foreground">
      <PublicHeader />
      <main className="flex flex-1 flex-col items-center justify-center gap-xl bg-muted/30 p-xl md:p-3xl">
        {children}
      </main>
      <PublicFooter />
    </div>
  );
}
