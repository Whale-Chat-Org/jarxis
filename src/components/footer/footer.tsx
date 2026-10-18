import Link from 'next/link';

/** Footer for the public surfaces; pairs with `Header` from `@/components/header/header`. */
export function Footer() {
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
