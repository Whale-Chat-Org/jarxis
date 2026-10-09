import Link from 'next/link';

import { BrandMark } from '@/components/brand';
import { PublicAccountNav } from '@/components/public-account-nav';
import { ThemeToggle } from '@/components/theme-toggle';
import { HttpError } from '@/lib/errors';
import { pageGrants } from '@/lib/rbac';

/**
 * Header and footer for the public surfaces (the landing page and every `/auth/*` view).
 *
 * Extracted from the landing page so the auth routes reuse the exact same chrome rather than
 * duplicating the markup. Keep the two in one module: they are always used together.
 */

function Brand() {
  return (
    <Link href="/" className="flex items-center gap-sm" aria-label="Jarxis home">
      {/* The link is already labelled, so the mark stays decorative. */}
      <BrandMark />
      <span className="text-body-sm font-semibold">Jarxis</span>
    </Link>
  );
}

export async function PublicHeader() {
  let canAccessAdmin = false;
  try {
    canAccessAdmin = (await pageGrants()).permissions.has('dashboard:read');
  } catch (error) {
    if (!(error instanceof HttpError && [401, 403].includes(error.status))) throw error;
  }

  return (
    <header className="border-b">
      <div className="mx-auto flex h-header max-w-content items-center justify-between gap-lg px-page">
        <Brand />
        <nav aria-label="Account" className="flex items-center gap-sm">
          <ThemeToggle />
          <PublicAccountNav canAccessAdmin={canAccessAdmin} />
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
