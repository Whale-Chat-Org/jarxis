import Link from 'next/link';

import { BrandMark } from '@/components/brand';
import { AccountNav } from '@/components/header/account-nav';
import { ThemeToggle } from '@/components/header/theme-toggle';
import { HttpError } from '@/lib/errors';
import { pageGrants } from '@/lib/rbac';

/** Header for the public surfaces (the landing page, every `/auth/*` view and `/settings`). */

function Brand() {
  return (
    <Link href="/" className="flex items-center gap-sm" aria-label="Jarxis home">
      {/* The link is already labelled, so the mark stays decorative. */}
      <BrandMark />
      <span className="text-body-sm font-semibold">Jarxis</span>
    </Link>
  );
}

export async function Header() {
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
          <AccountNav canAccessAdmin={canAccessAdmin} />
        </nav>
      </div>
    </header>
  );
}
