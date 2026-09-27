'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { Avatar as AvatarPrimitive } from 'radix-ui';

function Avatar({
  className,
  size = 'default',
  ...props
}: React.ComponentProps<typeof AvatarPrimitive.Root> & {
  size?: 'default' | 'sm' | 'lg';
}) {
  return (
    <AvatarPrimitive.Root
      data-slot="avatar"
      data-size={size}
      className={cn(
        'group/avatar relative flex size-2xl shrink-0 overflow-hidden rounded-full select-none data-[size=lg]:size-control-lg data-[size=sm]:size-xl',
        className,
      )}
      {...props}
    />
  );
}

function AvatarImage({ className, ...props }: React.ComponentProps<typeof AvatarPrimitive.Image>) {
  return (
    <AvatarPrimitive.Image
      data-slot="avatar-image"
      className={cn('aspect-square size-full', className)}
      {...props}
    />
  );
}

function AvatarFallback({
  className,
  ...props
}: React.ComponentProps<typeof AvatarPrimitive.Fallback>) {
  return (
    <AvatarPrimitive.Fallback
      data-slot="avatar-fallback"
      className={cn(
        'flex size-full items-center justify-center rounded-full bg-muted text-body-sm text-muted-foreground group-data-[size=sm]/avatar:text-caption',
        className,
      )}
      {...props}
    />
  );
}

function AvatarBadge({ className, ...props }: React.ComponentProps<'span'>) {
  return (
    <span
      data-slot="avatar-badge"
      className={cn(
        'absolute right-none bottom-none z-10 inline-flex items-center justify-center rounded-full bg-primary text-primary-foreground ring-2 ring-background select-none',
        'group-data-[size=sm]/avatar:size-sm group-data-[size=sm]/avatar:[&>svg]:hidden',
        'group-data-[size=default]/avatar:size-sm-plus group-data-[size=default]/avatar:[&>svg]:size-sm',
        'group-data-[size=lg]/avatar:size-icon-xs group-data-[size=lg]/avatar:[&>svg]:size-sm',
        className,
      )}
      {...props}
    />
  );
}

function AvatarGroup({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="avatar-group"
      className={cn(
        'group/avatar-group flex -space-x-sm *:data-[slot=avatar]:ring-2 *:data-[slot=avatar]:ring-background',
        className,
      )}
      {...props}
    />
  );
}

function AvatarGroupCount({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="avatar-group-count"
      className={cn(
        'relative flex size-2xl shrink-0 items-center justify-center rounded-full bg-muted text-body-sm text-muted-foreground ring-2 ring-background group-has-data-[size=lg]/avatar-group:size-control-lg group-has-data-[size=sm]/avatar-group:size-xl [&>svg]:size-icon group-has-data-[size=lg]/avatar-group:[&>svg]:size-icon-lg group-has-data-[size=sm]/avatar-group:[&>svg]:size-icon-xs',
        className,
      )}
      {...props}
    />
  );
}

export { Avatar, AvatarImage, AvatarFallback, AvatarBadge, AvatarGroup, AvatarGroupCount };
