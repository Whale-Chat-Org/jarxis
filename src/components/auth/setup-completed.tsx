import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { CheckCircle2Icon } from 'lucide-react';
import Link from 'next/link';

export function SetupCompleted() {
  return (
    <Card className="w-full max-w-narrow">
      <CardHeader>
        <div
          aria-hidden="true"
          className="flex size-control-lg items-center justify-center rounded-full bg-muted text-muted-foreground"
        >
          <CheckCircle2Icon className="size-icon-lg" />
        </div>
        <CardTitle role="heading" aria-level={1} className="text-title font-semibold">
          Setup already completed
        </CardTitle>
        <CardDescription>
          This deployment already has an owner, so the first-run form is closed permanently.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-lg">
        <Button asChild>
          <Link href="/auth/sign-in">Go to sign-in</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
