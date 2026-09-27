'use client';

import { fileToAvatarDataUrl } from '@better-auth-ui/core';
import { useAuth, useSession, useUpdateUser } from '@better-auth-ui/react';
import { Trash2, Upload } from 'lucide-react';
import { type ChangeEvent, useRef, useState } from 'react';
import { toast } from 'sonner';
import { UserAvatar } from '@/components/auth/user/user-avatar';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';

export type ChangeAvatarProps = {
  className?: string;
};

export function ChangeAvatar({ className }: ChangeAvatarProps) {
  const { authClient, localization, avatar } = useAuth();
  const { data: session } = useSession(authClient);

  const { mutateAsync: updateUser, isPending: updatePending } = useUpdateUser(authClient);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const isPending = updatePending || isUploading || isDeleting;

  async function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    e.target.value = '';

    setIsUploading(true);

    try {
      const resized = (await avatar.resize?.(file, avatar.size, avatar.extension)) || file;

      const image = (await avatar.upload?.(resized)) || (await fileToAvatarDataUrl(resized));

      const previousImage = session?.user.image;
      try {
        await updateUser({ image });
      } catch (error) {
        await avatar.delete?.(image).catch(() => undefined);
        throw error;
      }

      if (previousImage && previousImage !== image) {
        try {
          await avatar.delete?.(previousImage);
        } catch {
          console.error('[Better Auth UI] Previous avatar cleanup failed');
        }
      }

      toast.success(localization.settings.avatarChangedSuccess);
    } catch (error) {
      console.error('[Better Auth UI] Image operation failed', error);
      toast.error(localization.errors.imageUploadFailed);
    }

    setIsUploading(false);
  }

  async function handleDelete() {
    const currentImage = session?.user.image;
    setIsDeleting(true);
    try {
      await updateUser({ image: null });
      if (currentImage) await avatar.delete?.(currentImage);
      toast.success(localization.settings.avatarDeletedSuccess);
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <Field className={className}>
      <FieldLabel>{localization.settings.avatar}</FieldLabel>

      <Input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileChange}
      />

      <div className="flex items-center gap-lg">
        <Button
          type="button"
          variant="ghost"
          className="h-auto w-auto rounded-full p-none"
          disabled={isPending}
          onClick={() => fileInputRef.current?.click()}
        >
          <UserAvatar className="size-4xl" isPending={isPending} />
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger
            className={cn(buttonVariants({ variant: 'secondary', size: 'sm' }))}
            disabled={!session || isPending}
          >
            {isPending && <Spinner />}

            {localization.settings.changeAvatar}
          </DropdownMenuTrigger>

          <DropdownMenuContent className="min-w-fit">
            <DropdownMenuItem onClick={() => fileInputRef.current?.click()}>
              <Upload className="text-muted-foreground" />

              {localization.settings.uploadAvatar}
            </DropdownMenuItem>

            <DropdownMenuItem
              variant="destructive"
              disabled={!session?.user.image}
              onClick={handleDelete}
            >
              <Trash2 />

              {localization.settings.deleteAvatar}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </Field>
  );
}
