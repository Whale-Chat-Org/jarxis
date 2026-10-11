import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';
import { Slot } from 'radix-ui';

const markerVariants = cva(
  "group/marker relative flex min-h-lg w-full items-center gap-sm text-left text-body-sm text-muted-foreground [&_svg:not([class*='size-'])]:size-icon [a]:underline [a]:underline-offset-3 [a]:hover:text-foreground",
  {
    variants: {
      variant: {
        default: '',
        separator:
          'before:mr-2xs before:h-hairline before:min-w-none before:flex-1 before:bg-border after:ml-2xs after:h-hairline after:min-w-none after:flex-1 after:bg-border',
        border: 'border-b border-border pb-sm',
      },
    },
  },
);

function Marker({
  className,
  variant = 'default',
  asChild = false,
  ...props
}: React.ComponentProps<'div'> &
  VariantProps<typeof markerVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot.Root : 'div';

  return (
    <Comp
      data-slot="marker"
      data-variant={variant}
      className={cn(markerVariants({ variant, className }))}
      {...props}
    />
  );
}

function MarkerIcon({ className, ...props }: React.ComponentProps<'span'>) {
  return (
    <span
      data-slot="marker-icon"
      aria-hidden="true"
      className={cn("size-icon shrink-0 [&_svg:not([class*='size-'])]:size-icon", className)}
      {...props}
    />
  );
}

function MarkerContent({ className, ...props }: React.ComponentProps<'span'>) {
  return (
    <span
      data-slot="marker-content"
      className={cn(
        'min-w-none wrap-break-word group-data-[variant=separator]/marker:flex-none group-data-[variant=separator]/marker:text-center *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground',
        className,
      )}
      {...props}
    />
  );
}

export { Marker, MarkerIcon, MarkerContent, markerVariants };
