'use client';

import { useAuthPlugin } from '@better-auth-ui/react';
import { Monitor, Moon, PaletteIcon, Sun } from 'lucide-react';
import { useRef } from 'react';

import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { themePlugin } from '@/lib/auth/theme-plugin';

/**
 * Theme toggle dropdown item used inside `UserButton`. Callers are responsible
 * for ensuring theming is configured before rendering this component.
 */
export function ThemeToggleItem() {
  const { useTheme, localization } = useAuthPlugin(themePlugin);
  const { theme, setTheme, themes = [] } = useTheme();
  const tabsListRef = useRef<HTMLDivElement>(null);

  // The TabsTriggers aren't part of the menu's roving focus group, so
  // arrow-key navigation can't reach them on its own. When the wrapper
  // menu item receives focus we delegate focus to the active TabsTrigger
  // inside, letting the user switch themes with Left/Right arrows.
  const focusActiveTab = () => {
    const activeTab = tabsListRef.current?.querySelector<HTMLElement>(
      '[role="tab"][data-state="active"]',
    );
    activeTab?.focus({ preventScroll: true });
  };

  // Up/Down on a TabsTrigger escapes back to the previous/next sibling
  // menu item so users can keep navigating the menu with the arrow keys.
  const handleTabsKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;

    const target = event.target as HTMLElement;
    if (target.getAttribute('role') !== 'tab') return;

    const wrapper = target.closest<HTMLElement>('[role="menuitem"]');
    const content = wrapper?.closest<HTMLElement>('[data-slot="dropdown-menu-content"]');
    if (!wrapper || !content) return;

    const items = Array.from(
      content.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])'),
    );
    const currentIndex = items.indexOf(wrapper);
    const nextIndex = event.key === 'ArrowDown' ? currentIndex + 1 : currentIndex - 1;
    const next = items[nextIndex];
    if (!next) return;

    event.preventDefault();
    next.focus();
  };

  return (
    <DropdownMenuItem
      onSelect={(e) => e.preventDefault()}
      onFocus={(e) => {
        // onFocus bubbles in React, so guard against re-entry from focus
        // events fired by the inner TabsTrigger.
        if (e.target === e.currentTarget) focusActiveTab();
      }}
    >
      <PaletteIcon className="text-muted-foreground" />

      <span>{localization.theme}</span>

      <Tabs
        className="ml-auto"
        value={theme}
        onValueChange={setTheme}
        onKeyDown={handleTabsKeyDown}
      >
        <TabsList ref={tabsListRef} className="group-data-[orientation=horizontal]/tabs:h-xl">
          {themes.includes('system') && (
            <TabsTrigger
              value="system"
              className="size-icon-lg p-none"
              aria-label={localization.system}
            >
              <Monitor className="size-icon-xs" />
            </TabsTrigger>
          )}
          {themes.includes('light') && (
            <TabsTrigger
              value="light"
              className="size-icon-lg p-none"
              aria-label={localization.light}
            >
              <Sun className="size-icon-xs" />
            </TabsTrigger>
          )}
          {themes.includes('dark') && (
            <TabsTrigger
              value="dark"
              className="size-icon-lg p-none"
              aria-label={localization.dark}
            >
              <Moon className="size-icon-xs" />
            </TabsTrigger>
          )}
        </TabsList>
      </Tabs>
    </DropdownMenuItem>
  );
}
