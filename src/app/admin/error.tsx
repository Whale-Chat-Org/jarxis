'use client';
import { Button } from '@/components/ui/button';
export default function AdminError({ reset }: { reset: () => void }) {
  return (
    <section className="rounded-xl border p-2xl" role="alert">
      <h2 className="text-heading font-semibold">This page couldn’t be loaded</h2>
      <p className="my-md text-body-sm text-muted-foreground">
        Check your connection and try again. If the problem continues, contact your administrator.
      </p>
      <Button onClick={reset}>Try again</Button>
    </section>
  );
}
