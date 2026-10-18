import type { ReactNode } from 'react';

/** Centred, tinted `<main>` shared by the auth and setup layouts; the header and footer come from `src/app/(public)/layout.tsx`. */
export function AuthFrame({ children }: { children: ReactNode }) {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-xl bg-muted/30 p-xl md:p-3xl">
      {children}
    </main>
  );
}
