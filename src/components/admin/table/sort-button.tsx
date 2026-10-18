'use client';
import { Button } from '@/components/ui/button';
export function SortButton({
  children,
  onClick,
  sorted,
}: {
  children: React.ReactNode;
  onClick?: (event: unknown) => void;
  sorted: false | 'asc' | 'desc';
}) {
  return (
    <Button
      className="h-auto gap-2xs p-none font-medium"
      onClick={(event) => onClick?.(event)}
      type="button"
      variant="link"
    >
      {children}
      {sorted ? (sorted === 'asc' ? '↑' : '↓') : null}
    </Button>
  );
}
