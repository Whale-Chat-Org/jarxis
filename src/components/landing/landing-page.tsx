import { PublicFooter, PublicHeader } from '@/components/public-chrome';

export function LandingPage() {
  return (
    <div className="flex min-h-svh flex-col bg-background text-foreground">
      <PublicHeader />
      <main className="flex flex-1 flex-col items-center justify-center gap-sm px-page text-center">
        <h1 className="text-display font-semibold tracking-tight">Jarxis</h1>
        <p className="text-body-sm text-muted-foreground">Content coming soon.</p>
      </main>
      <PublicFooter />
    </div>
  );
}
