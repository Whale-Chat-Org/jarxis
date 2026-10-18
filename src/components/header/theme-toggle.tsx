'use client';

import { PaletteIcon } from 'lucide-react';

import { ThemeToggleItem } from '@/components/header/theme-toggle-item';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

/**
 * Standalone theme control for the public chrome.
 *
 * Better Auth UI ships the theme switcher as a dropdown *item* (`ThemeToggleItem`) and as a
 * settings *card* (`Appearance`), but not as a trigger. This file is the thin composition that
 * gives the public header a trigger; all behaviour stays in the registry item.
 */
export function ThemeToggle() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Toggle theme">
          <PaletteIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <ThemeToggleItem />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
