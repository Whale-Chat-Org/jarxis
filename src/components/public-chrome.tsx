import Link from 'next/link';

import { ThemeToggle } from '@/components/theme-toggle';
import { Button } from '@/components/ui/button';

/**
 * Header and footer for the public surfaces (the landing page and every `/auth/*` view).
 *
 * Extracted from the landing page so the auth routes reuse the exact same chrome rather than
 * duplicating the markup. Keep the two in one module: they are always used together.
 */

function Brand() {
  return (
    <Link href="/" className="flex items-center gap-sm" aria-label="Jarxis home">
      <span className="flex size-avatar items-center justify-center rounded-md bg-primary text-body-sm font-bold text-primary-foreground">
        J
      </span>
      <span className="text-body-sm font-semibold">Jarxis</span>
    </Link>
  );
}

export function PublicHeader() {
  return (
    <header className="border-b">
      <div className="mx-auto flex h-header max-w-content items-center justify-between gap-lg px-page">
        <Brand />
        <nav aria-label="Account" className="flex items-center gap-sm">
          <ThemeToggle />
          <Button asChild variant="ghost">
            <Link href="/auth/sign-in">Sign in</Link>
          </Button>
          <Button asChild>
            <Link href="/auth/sign-up">Sign up</Link>
          </Button>
        </nav>
      </div>
    </header>
  );
}

export function PublicFooter() {
  return (
    <footer className="border-t">
      <div className="mx-auto flex max-w-content flex-col items-center justify-between gap-sm px-page py-lg text-body-sm text-muted-foreground sm:h-header sm:flex-row sm:py-none">
        <p>© {new Date().getFullYear()} Jarxis</p>
        <nav aria-label="Footer" className="flex gap-lg">
          <Link href="/auth/sign-in" className="hover:text-foreground">
            Sign in
          </Link>
          <Link href="/auth/sign-up" className="hover:text-foreground">
            Sign up
          </Link>
        </nav>
      </div>
    </footer>
  );
}
