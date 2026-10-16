import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger, tabsListVariants } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

describe('Dialog', () => {
  it('opens, closes with the footer and the X button', async () => {
    render(
      <Dialog>
        <DialogTrigger>Open</DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit</DialogTitle>
            <DialogDescription>Change things</DialogDescription>
          </DialogHeader>
          <DialogFooter showCloseButton>
            <DialogClose>Dismiss</DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Open' }));
    const dialog = screen.getByRole('dialog', { name: 'Edit' });
    expect(dialog.getAttribute('data-slot')).toBe('dialog-content');
    expect(screen.getAllByRole('button', { name: 'Close' }).length).toBe(2);
    await userEvent.click(screen.getAllByRole('button', { name: 'Close' })[0]!);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    await userEvent.click(screen.getByRole('button', { name: 'Open' }));
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('can hide the close button', () => {
    render(
      <Dialog open>
        <DialogContent showCloseButton={false} aria-describedby={undefined}>
          <DialogTitle>Bare</DialogTitle>
          <DialogFooter>Footer</DialogFooter>
        </DialogContent>
      </Dialog>,
    );
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
  });
});

describe('AlertDialog', () => {
  it('confirms and cancels', async () => {
    const onAction = vi.fn();
    render(
      <AlertDialog>
        <AlertDialogTrigger>Delete</AlertDialogTrigger>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogMedia>!</AlertDialogMedia>
            <AlertDialogTitle>Sure?</AlertDialogTitle>
            <AlertDialogDescription>Cannot undo</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={onAction}>
              Confirm
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    const dialog = screen.getByRole('alertdialog', { name: 'Sure?' });
    expect(dialog.getAttribute('data-size')).toBe('sm');
    expect(screen.getByRole('button', { name: 'Confirm' }).getAttribute('data-variant')).toBe(
      'destructive',
    );
    expect(screen.getByRole('button', { name: 'Cancel' }).getAttribute('data-variant')).toBe(
      'outline',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());

    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(onAction).toHaveBeenCalledOnce();
  });

  it('uses the default size', () => {
    render(
      <AlertDialog open>
        <AlertDialogContent>
          <AlertDialogTitle>Default</AlertDialogTitle>
          <AlertDialogDescription>d</AlertDialogDescription>
        </AlertDialogContent>
      </AlertDialog>,
    );
    expect(screen.getByRole('alertdialog').getAttribute('data-size')).toBe('default');
  });
});

describe('Sheet', () => {
  it.each(['top', 'right', 'bottom', 'left'] as const)('opens on the %s side', async (side) => {
    render(
      <Sheet>
        <SheetTrigger>Menu</SheetTrigger>
        <SheetContent side={side}>
          <SheetHeader>
            <SheetTitle>Nav</SheetTitle>
            <SheetDescription>Navigation</SheetDescription>
          </SheetHeader>
          <SheetFooter>
            <SheetClose>Done</SheetClose>
          </SheetFooter>
        </SheetContent>
      </Sheet>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Menu' }));
    expect(screen.getByRole('dialog', { name: 'Nav' })).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('can hide the close button', () => {
    render(
      <Sheet open>
        <SheetContent showCloseButton={false} aria-describedby={undefined}>
          <SheetTitle>T</SheetTitle>
        </SheetContent>
      </Sheet>,
    );
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
  });
});

describe('DropdownMenu', () => {
  it('renders items, checkbox, radio and submenus', async () => {
    const onSelect = vi.fn();
    const onChecked = vi.fn();
    render(
      <DropdownMenu>
        <DropdownMenuTrigger>Actions</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuLabel inset>Label</DropdownMenuLabel>
          <DropdownMenuGroup>
            <DropdownMenuItem onSelect={onSelect} inset>
              Edit
              <DropdownMenuShortcut>⌘E</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive">Remove</DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuCheckboxItem checked onCheckedChange={onChecked}>
            Pinned
          </DropdownMenuCheckboxItem>
          <DropdownMenuRadioGroup value="a">
            <DropdownMenuRadioItem value="a">Option A</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="b">Option B</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
          <DropdownMenuSub open>
            <DropdownMenuSubTrigger inset>More</DropdownMenuSubTrigger>
            <DropdownMenuPortal>
              <DropdownMenuSubContent>
                <DropdownMenuItem>Nested</DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuPortal>
          </DropdownMenuSub>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Actions' }));
    expect(screen.getAllByRole('menu').length).toBe(2);
    expect(screen.getByRole('menuitem', { name: 'Remove' }).getAttribute('data-variant')).toBe(
      'destructive',
    );
    expect(
      screen.getByRole('menuitemcheckbox', { name: 'Pinned' }).getAttribute('aria-checked'),
    ).toBe('true');
    expect(
      screen.getByRole('menuitemradio', { name: 'Option A' }).getAttribute('aria-checked'),
    ).toBe('true');
    expect(screen.getByRole('menuitem', { name: 'Nested' })).toBeTruthy();
    expect(screen.getByText('⌘E').getAttribute('data-slot')).toBe('dropdown-menu-shortcut');
    await userEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Pinned' }));
    expect(onChecked).toHaveBeenCalledWith(false);
    await userEvent.click(screen.getByRole('button', { name: 'Actions' }));
    await userEvent.click(screen.getByRole('menuitem', { name: /Edit/ }));
    expect(onSelect).toHaveBeenCalledOnce();
  });
});

describe('Select', () => {
  it('opens and selects an item', async () => {
    const onChange = vi.fn();
    render(
      <Select onValueChange={onChange} defaultOpen>
        <SelectTrigger size="sm" aria-label="Fruit">
          <SelectValue placeholder="Pick" />
        </SelectTrigger>
        <SelectContent position="popper">
          <SelectScrollUpButton />
          <SelectGroup>
            <SelectLabel>Fruits</SelectLabel>
            <SelectItem value="apple">Apple</SelectItem>
            <SelectSeparator />
            <SelectItem value="pear">Pear</SelectItem>
          </SelectGroup>
          <SelectScrollDownButton />
        </SelectContent>
      </Select>,
    );
    expect(
      screen.getByRole('combobox', { name: 'Fruit', hidden: true }).getAttribute('data-size'),
    ).toBe('sm');
    expect(screen.getByRole('listbox')).toBeTruthy();
    expect(screen.getByText('Fruits')).toBeTruthy();
    await userEvent.click(screen.getByRole('option', { name: 'Pear' }));
    expect(onChange).toHaveBeenCalledWith('pear');
  });

  it('renders the default trigger size and item-aligned content', () => {
    render(
      <Select defaultValue="a" open>
        <SelectTrigger aria-label="Letter">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="a">A</SelectItem>
        </SelectContent>
      </Select>,
    );
    expect(
      screen.getByRole('combobox', { name: 'Letter', hidden: true }).getAttribute('data-size'),
    ).toBe('default');
    expect(screen.getByRole('option', { name: 'A' }).getAttribute('aria-selected')).toBe('true');
  });
});

describe('Popover', () => {
  it('opens content from the trigger', async () => {
    render(
      <Popover>
        <PopoverAnchor />
        <PopoverTrigger>Info</PopoverTrigger>
        <PopoverContent>
          <PopoverHeader>
            <PopoverTitle>About</PopoverTitle>
            <PopoverDescription>Details here</PopoverDescription>
          </PopoverHeader>
        </PopoverContent>
      </Popover>,
    );
    expect(screen.queryByText('About')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Info' }));
    expect(screen.getByText('About').getAttribute('data-slot')).toBe('popover-title');
    expect(screen.getByText('Details here')).toBeTruthy();
  });
});

describe('Tooltip', () => {
  it('shows content on hover', async () => {
    render(
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger>Hover me</TooltipTrigger>
          <TooltipContent>Tip text</TooltipContent>
        </Tooltip>
      </TooltipProvider>,
    );
    await userEvent.hover(screen.getByRole('button', { name: 'Hover me' }));
    expect((await screen.findByRole('tooltip')).textContent).toContain('Tip text');
  });
});

describe('Tabs', () => {
  it('switches panels', async () => {
    render(
      <Tabs defaultValue="one" orientation="vertical">
        <TabsList variant="line">
          <TabsTrigger value="one">One</TabsTrigger>
          <TabsTrigger value="two">Two</TabsTrigger>
        </TabsList>
        <TabsContent value="one">First</TabsContent>
        <TabsContent value="two">Second</TabsContent>
      </Tabs>,
    );
    expect(screen.getByRole('tablist').getAttribute('data-variant')).toBe('line');
    expect(screen.getByRole('tabpanel').textContent).toBe('First');
    await userEvent.click(screen.getByRole('tab', { name: 'Two' }));
    expect(screen.getByRole('tabpanel').textContent).toBe('Second');
    expect(tabsListVariants({ variant: 'default' })).toContain('bg-muted');
  });

  it('defaults to horizontal and the default list variant', () => {
    render(
      <Tabs defaultValue="a">
        <TabsList>
          <TabsTrigger value="a">A</TabsTrigger>
        </TabsList>
      </Tabs>,
    );
    expect(screen.getByRole('tablist').getAttribute('data-variant')).toBe('default');
    expect(
      screen.getByRole('tablist').closest('[data-slot="tabs"]')?.getAttribute('data-orientation'),
    ).toBe('horizontal');
  });
});

describe('Collapsible', () => {
  it('toggles content', async () => {
    render(
      <Collapsible>
        <CollapsibleTrigger>Toggle</CollapsibleTrigger>
        <CollapsibleContent>Hidden content</CollapsibleContent>
      </Collapsible>,
    );
    expect(screen.queryByText('Hidden content')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Toggle' }));
    expect(screen.getByText('Hidden content')).toBeTruthy();
  });
});
