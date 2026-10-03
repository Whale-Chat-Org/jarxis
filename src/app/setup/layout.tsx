import { PublicFooter, PublicHeader } from '@/components/public-chrome';

/**
 * Frames the first-owner setup route with the same public chrome as `/auth/*`.
 *
 * The route is reachable before any account exists, so the layout must not require a session:
 * `PublicHeader` already tolerates anonymous visitors. Availability itself is decided in
 * `page.tsx`, which reads the server-side setup status per request.
 */
export default function SetupLayout({ children }: { children: React.ReactNode }) {
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
