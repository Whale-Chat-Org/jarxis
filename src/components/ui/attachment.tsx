import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';
import { Slot } from 'radix-ui';

import { Button } from '@/components/ui/button';

const attachmentVariants = cva(
  'group/attachment relative flex w-fit max-w-full min-w-none shrink-0 flex-wrap rounded-xl border bg-card text-card-foreground transition-colors focus-within:ring-1 focus-within:ring-ring/50 has-[>a,>button]:hover:bg-muted/50 data-[state=error]:border-destructive/30 data-[state=idle]:border-dashed',
  {
    variants: {
      size: {
        default:
          'gap-sm text-body-sm has-data-[slot=attachment-content]:px-sm-plus has-data-[slot=attachment-content]:py-sm has-data-[slot=attachment-media]:p-sm',
        sm: 'gap-sm-plus text-caption has-data-[slot=attachment-content]:px-sm has-data-[slot=attachment-content]:py-xs has-data-[slot=attachment-media]:p-xs',
        xs: 'gap-xs rounded-lg text-caption has-data-[slot=attachment-content]:px-xs has-data-[slot=attachment-content]:py-2xs has-data-[slot=attachment-media]:p-2xs',
      },
      orientation: {
        horizontal: 'min-w-menu-sm items-center',
        vertical: 'w-bar-md flex-col has-data-[slot=attachment-content]:w-attachment',
      },
    },
  },
);

function Attachment({
  className,
  state = 'done',
  size = 'default',
  orientation = 'horizontal',
  ...props
}: React.ComponentProps<'div'> &
  VariantProps<typeof attachmentVariants> & {
    state?: 'idle' | 'uploading' | 'processing' | 'error' | 'done';
  }) {
  return (
    <div
      data-slot="attachment"
      data-state={state}
      data-size={size}
      data-orientation={orientation}
      className={cn(attachmentVariants({ size, orientation }), className)}
      {...props}
    />
  );
}

const attachmentMediaVariants = cva(
  "relative flex aspect-square w-control-lg shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted text-foreground group-data-[orientation=vertical]/attachment:w-full group-data-[size=sm]/attachment:w-2xl group-data-[size=xs]/attachment:w-xl-plus group-data-[size=xs]/attachment:rounded-md group-data-[state=error]/attachment:bg-destructive/10 group-data-[state=error]/attachment:text-destructive group-data-[orientation=vertical]/attachment:*:data-[slot=spinner]:size-xl! [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-icon group-data-[orientation=vertical]/attachment:[&_svg:not([class*='size-'])]:size-xl group-data-[size=xs]/attachment:[&_svg:not([class*='size-'])]:size-icon-sm",
  {
    variants: {
      variant: {
        icon: '',
        image:
          'opacity-60 group-data-[state=done]/attachment:opacity-100 group-data-[state=idle]/attachment:opacity-100 *:[img]:aspect-square *:[img]:w-full *:[img]:object-cover',
      },
    },
    defaultVariants: {
      variant: 'icon',
    },
  },
);

function AttachmentMedia({
  className,
  variant = 'icon',
  ...props
}: React.ComponentProps<'div'> & VariantProps<typeof attachmentMediaVariants>) {
  return (
    <div
      data-slot="attachment-media"
      data-variant={variant}
      className={cn(attachmentMediaVariants({ variant }), className)}
      {...props}
    />
  );
}

function AttachmentContent({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="attachment-content"
      className={cn(
        'max-w-full min-w-none flex-1 leading-tight group-data-[orientation=vertical]/attachment:px-2xs',
        className,
      )}
      {...props}
    />
  );
}

function AttachmentTitle({ className, ...props }: React.ComponentProps<'span'>) {
  return (
    <span
      data-slot="attachment-title"
      className={cn(
        'block max-w-full min-w-none truncate font-medium group-data-[state=processing]/attachment:shimmer group-data-[state=uploading]/attachment:shimmer',
        className,
      )}
      {...props}
    />
  );
}

function AttachmentDescription({ className, ...props }: React.ComponentProps<'span'>) {
  return (
    <span
      data-slot="attachment-description"
      className={cn(
        'mt-3xs block min-w-none truncate text-caption text-muted-foreground group-data-[state=error]/attachment:text-destructive/80',
        'max-w-full',
        className,
      )}
      {...props}
    />
  );
}

function AttachmentActions({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="attachment-actions"
      className={cn(
        'relative z-20 flex shrink-0 items-center group-data-[orientation=vertical]/attachment:absolute group-data-[orientation=vertical]/attachment:top-md group-data-[orientation=vertical]/attachment:right-md group-data-[orientation=vertical]/attachment:gap-2xs',
        className,
      )}
      {...props}
    />
  );
}

function AttachmentAction({
  className,
  variant,
  size = 'icon-xs',
  ...props
}: React.ComponentProps<typeof Button>) {
  return (
    <Button
      data-slot="attachment-action"
      variant={variant ?? 'ghost'}
      size={size}
      className={cn(className)}
      {...props}
    />
  );
}

function AttachmentTrigger({
  className,
  asChild = false,
  type,
  ...props
}: React.ComponentProps<'button'> & {
  asChild?: boolean;
}) {
  const Comp = asChild ? Slot.Root : 'button';

  return (
    <Comp
      data-slot="attachment-trigger"
      type={asChild ? undefined : (type ?? 'button')}
      className={cn('absolute inset-none z-10 outline-none', className)}
      {...props}
    />
  );
}

function AttachmentGroup({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="attachment-group"
      className={cn(
        'flex min-w-none scroll-fade-x snap-x snap-mandatory scroll-px-2xs scrollbar-none gap-md overflow-x-auto overscroll-x-contain py-2xs *:data-[slot=attachment]:flex-none *:data-[slot=attachment]:snap-start',
        className,
      )}
      {...props}
    />
  );
}

export {
  Attachment,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentContent,
  AttachmentTitle,
  AttachmentDescription,
  AttachmentActions,
  AttachmentAction,
  AttachmentTrigger,
};
