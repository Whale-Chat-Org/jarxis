import Link from 'next/link';

import { Button } from '@/components/ui/button';

/** Controlled state for browser tables; href mapping for server-rendered URL tables. */
export function AdminTablePagination({
  pageIndex,
  pageSize,
  total,
  fetching = false,
  rangeText,
  previousLabel = 'Previous',
  nextLabel = 'Next',
  onPageChange,
  href,
}: {
  pageIndex: number;
  pageSize: number;
  total: number;
  fetching?: boolean;
  rangeText?: string;
  previousLabel?: string;
  nextLabel?: string;
  onPageChange?: (index: number) => void;
  href?: (index: number) => string;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="flex items-center justify-between gap-md text-body-sm text-muted-foreground">
      <span>{rangeText ?? `Page ${pageIndex + 1} of ${pages}`}</span>
      <div className="flex gap-2xs">
        {(
          [
            { delta: -1, label: previousLabel },
            { delta: 1, label: nextLabel },
          ] as const
        ).map(({ delta, label }) => {
          const index = pageIndex + delta;
          const disabled = fetching || index < 0 || index >= pages;
          return href && !disabled ? (
            <Button key={delta} asChild variant="outline" size="sm">
              <Link href={href(index)}>{label}</Link>
            </Button>
          ) : (
            <Button
              key={delta}
              aria-label={label}
              variant="outline"
              size="sm"
              disabled={disabled}
              onClick={onPageChange ? () => onPageChange(index) : undefined}
            >
              {label}
            </Button>
          );
        })}
      </div>
    </div>
  );
}
