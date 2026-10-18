import type { ReactNode } from 'react';

import { Header } from '@/components/header/header';
import { Footer } from '@/components/footer/footer';

/**
 * Chrome for the public surfaces (`/`, `/auth/*`, `/setup`, `/settings`). Nested layouts and
 * pages render only their own `<main>`; the header and footer live here, once.
 */
export default function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-svh flex-col bg-background text-foreground">
      <Header />
      {children}
      <Footer />
    </div>
  );
}
