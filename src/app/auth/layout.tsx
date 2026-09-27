import { PublicFooter, PublicHeader } from '@/components/public-chrome';

/**
 * Frames every `/auth/*` view with the public header and footer.
 *
 * This layout sits above the `[path]` segment, so it cannot branch on the auth view; all ten
 * views (sign-in, sign-up, sign-out, forgot/reset password, reset-link-sent, verify-email,
 * callback, error, redirect) share the same chrome. `[path]/loading.tsx` is nested inside this
 * layout, so it renders only the card skeleton — the chrome here is real and renders instantly.
 *
 * The centring and `bg-muted/30` tint are unchanged from the previous page-level wrapper; only
 * the header and footer bands are new.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
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
