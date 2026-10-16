import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle,
  AttachmentTrigger,
} from '@/components/ui/attachment';
import {
  Avatar,
  AvatarBadge,
  AvatarFallback,
  AvatarGroup,
  AvatarGroupCount,
  AvatarImage,
} from '@/components/ui/avatar';
import { Badge, badgeVariants } from '@/components/ui/badge';
import {
  Breadcrumb,
  BreadcrumbEllipsis,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import { Bubble, BubbleContent, BubbleGroup, BubbleReactions } from '@/components/ui/bubble';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Marker, MarkerContent, MarkerIcon, markerVariants } from '@/components/ui/marker';
import {
  Message,
  MessageAvatar,
  MessageContent,
  MessageFooter,
  MessageGroup,
  MessageHeader,
} from '@/components/ui/message';
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui/pagination';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';

const slot = (container: HTMLElement, name: string) =>
  container.querySelector(`[data-slot="${name}"]`);

describe('Button', () => {
  it('renders variants and sizes as data attributes', async () => {
    const onClick = vi.fn();
    render(
      <Button variant="destructive" size="lg" className="extra" onClick={onClick}>
        Delete
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Delete' });
    expect(button.getAttribute('data-variant')).toBe('destructive');
    expect(button.getAttribute('data-size')).toBe('lg');
    expect(button.className).toContain('extra');
    await userEvent.click(button);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('renders its child element with asChild and defaults', () => {
    render(
      <Button asChild>
        <a href="/x">Go</a>
      </Button>,
    );
    const link = screen.getByRole('link', { name: 'Go' });
    expect(link.getAttribute('data-variant')).toBe('default');
    expect(link.getAttribute('data-size')).toBe('default');
    expect(buttonVariants({ variant: 'link', size: 'icon' })).toContain('underline-offset-4');
  });
});

describe('Badge', () => {
  it('renders a span by default and a child with asChild', () => {
    const { container } = render(<Badge variant="outline">New</Badge>);
    const badge = slot(container, 'badge');
    expect(badge?.tagName).toBe('SPAN');
    expect(badge?.getAttribute('data-variant')).toBe('outline');
    render(
      <Badge asChild>
        <a href="/b">Link badge</a>
      </Badge>,
    );
    expect(screen.getByRole('link').getAttribute('data-variant')).toBe('default');
    expect(badgeVariants({ variant: 'ghost' })).toContain('hover:bg-accent');
  });
});

describe('Alert and Card', () => {
  it('renders an alert with title and description', () => {
    render(
      <Alert variant="destructive">
        <AlertTitle>Heads up</AlertTitle>
        <AlertDescription>Something happened</AlertDescription>
      </Alert>,
    );
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('Heads up');
    expect(alert.className).toContain('text-destructive');
  });

  it('renders all card slots', () => {
    const { container } = render(
      <Card className="c">
        <CardHeader>
          <CardTitle>Title</CardTitle>
          <CardDescription>Desc</CardDescription>
          <CardAction>Act</CardAction>
        </CardHeader>
        <CardContent>Body</CardContent>
        <CardFooter>Foot</CardFooter>
      </Card>,
    );
    for (const name of [
      'card',
      'card-header',
      'card-title',
      'card-description',
      'card-action',
      'card-content',
      'card-footer',
    ]) {
      expect(slot(container, name)).toBeTruthy();
    }
    expect(slot(container, 'card')?.className).toContain('c');
  });
});

describe('Avatar', () => {
  it('shows the fallback when no image loads and renders group helpers', () => {
    const { container } = render(
      <AvatarGroup>
        <Avatar size="lg">
          <AvatarImage src="/missing.png" alt="User" />
          <AvatarFallback>AB</AvatarFallback>
          <AvatarBadge>1</AvatarBadge>
        </Avatar>
        <AvatarGroupCount>+3</AvatarGroupCount>
      </AvatarGroup>,
    );
    expect(slot(container, 'avatar')?.getAttribute('data-size')).toBe('lg');
    expect(screen.getByText('AB')).toBeTruthy();
    expect(slot(container, 'avatar-badge')?.textContent).toBe('1');
    expect(slot(container, 'avatar-group-count')?.textContent).toBe('+3');
  });

  it('uses the default size', () => {
    const { container } = render(<Avatar />);
    expect(slot(container, 'avatar')?.getAttribute('data-size')).toBe('default');
  });
});

describe('Breadcrumb', () => {
  it('renders links, page, separators and ellipsis', () => {
    const { container } = render(
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink href="/">Home</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <button type="button">Section</button>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator>/</BreadcrumbSeparator>
          <BreadcrumbEllipsis />
          <BreadcrumbItem>
            <BreadcrumbPage>Current</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>,
    );
    expect(screen.getByRole('navigation', { name: 'breadcrumb' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Home' }).getAttribute('href')).toBe('/');
    expect(screen.getByRole('button', { name: 'Section' }).getAttribute('data-slot')).toBe(
      'breadcrumb-link',
    );
    const separators = container.querySelectorAll('[data-slot="breadcrumb-separator"]');
    expect(separators[0]?.querySelector('svg')).toBeTruthy();
    expect(separators[1]?.textContent).toBe('/');
    expect(screen.getByText('Current').getAttribute('aria-current')).toBe('page');
    expect(screen.getByText('More')).toBeTruthy();
  });
});

describe('Pagination', () => {
  it('marks the active link and renders previous/next/ellipsis', () => {
    render(
      <Pagination>
        <PaginationContent>
          <PaginationItem>
            <PaginationPrevious href="#prev" />
          </PaginationItem>
          <PaginationItem>
            <PaginationLink href="#1">1</PaginationLink>
          </PaginationItem>
          <PaginationItem>
            <PaginationLink href="#2" isActive>
              2
            </PaginationLink>
          </PaginationItem>
          <PaginationItem>
            <PaginationEllipsis />
          </PaginationItem>
          <PaginationItem>
            <PaginationNext href="#next" />
          </PaginationItem>
        </PaginationContent>
      </Pagination>,
    );
    expect(screen.getByRole('navigation', { name: 'pagination' })).toBeTruthy();
    expect(screen.getByRole('link', { name: '2' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('link', { name: '1' }).getAttribute('aria-current')).toBeNull();
    expect(screen.getByRole('link', { name: 'Go to previous page' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Go to next page' })).toBeTruthy();
    expect(screen.getByText('More pages')).toBeTruthy();
  });
});

describe('Table', () => {
  it('renders all table sections', () => {
    render(
      <Table>
        <TableCaption>Caption</TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell>Alice</TableCell>
          </TableRow>
        </TableBody>
        <TableFooter>
          <TableRow>
            <TableCell>Total</TableCell>
          </TableRow>
        </TableFooter>
      </Table>,
    );
    expect(screen.getByRole('table')).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'Name' })).toBeTruthy();
    expect(screen.getByRole('cell', { name: 'Alice' })).toBeTruthy();
    expect(screen.getByText('Caption').tagName).toBe('CAPTION');
  });
});

describe('Small primitives', () => {
  it('renders skeleton, spinner, separator, label, input and textarea', async () => {
    const { container } = render(
      <div>
        <Skeleton className="sk" />
        <Spinner />
        <Separator orientation="vertical" />
        <Label htmlFor="name">Name</Label>
        <Input id="name" type="text" />
        <Textarea aria-label="Notes" />
      </div>,
    );
    expect(slot(container, 'skeleton')?.className).toContain('sk');
    expect(screen.getByRole('status', { name: 'Loading' })).toBeTruthy();
    expect(slot(container, 'separator')?.getAttribute('data-orientation')).toBe('vertical');
    const input = screen.getByLabelText('Name');
    await userEvent.type(input, 'abc');
    expect((input as HTMLInputElement).value).toBe('abc');
    const textarea = screen.getByRole('textbox', { name: 'Notes' });
    await userEvent.type(textarea, 'hi');
    expect((textarea as HTMLTextAreaElement).value).toBe('hi');
  });
});

describe('Attachment', () => {
  it('renders all slots with state, size and orientation', async () => {
    const onAction = vi.fn();
    const { container } = render(
      <AttachmentGroup>
        <Attachment state="error" size="sm" orientation="vertical">
          <AttachmentMedia variant="image">
            <span>preview</span>
          </AttachmentMedia>
          <AttachmentContent>
            <AttachmentTitle>file.pdf</AttachmentTitle>
            <AttachmentDescription>Failed</AttachmentDescription>
          </AttachmentContent>
          <AttachmentActions>
            <AttachmentAction aria-label="Remove" onClick={onAction} />
            <AttachmentAction aria-label="Retry" variant="outline" />
          </AttachmentActions>
          <AttachmentTrigger aria-label="Open" />
        </Attachment>
        <Attachment>
          <AttachmentMedia />
          <AttachmentTrigger asChild>
            <a href="/f">Open link</a>
          </AttachmentTrigger>
          <AttachmentTrigger type="submit" aria-label="Submit" />
        </Attachment>
      </AttachmentGroup>,
    );
    const items = container.querySelectorAll('[data-slot="attachment"]');
    expect(items[0]?.getAttribute('data-state')).toBe('error');
    expect(items[0]?.getAttribute('data-size')).toBe('sm');
    expect(items[0]?.getAttribute('data-orientation')).toBe('vertical');
    expect(items[1]?.getAttribute('data-state')).toBe('done');
    expect(items[1]?.getAttribute('data-orientation')).toBe('horizontal');
    expect(slot(container, 'attachment-media')?.getAttribute('data-variant')).toBe('image');
    await userEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(onAction).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'Retry' }).getAttribute('data-variant')).toBe(
      'outline',
    );
    expect(screen.getByRole('button', { name: 'Open' }).getAttribute('type')).toBe('button');
    expect(screen.getByRole('button', { name: 'Submit' }).getAttribute('type')).toBe('submit');
    expect(screen.getByRole('link', { name: 'Open link' }).getAttribute('type')).toBeNull();
  });
});

describe('Bubble, Message and Marker', () => {
  it('renders bubble variants and reactions', () => {
    const { container } = render(
      <BubbleGroup>
        <Bubble variant="tinted" align="end">
          <BubbleContent>Hello</BubbleContent>
          <BubbleReactions side="top" align="start">
            +1
          </BubbleReactions>
        </Bubble>
        <Bubble>
          <BubbleContent asChild>
            <button type="button">Clickable</button>
          </BubbleContent>
          <BubbleReactions>!</BubbleReactions>
        </Bubble>
      </BubbleGroup>,
    );
    const bubbles = container.querySelectorAll('[data-slot="bubble"]');
    expect(bubbles[0]?.getAttribute('data-variant')).toBe('tinted');
    expect(bubbles[0]?.getAttribute('data-align')).toBe('end');
    expect(bubbles[1]?.getAttribute('data-variant')).toBe('default');
    const reactions = container.querySelectorAll('[data-slot="bubble-reactions"]');
    expect(reactions[0]?.getAttribute('data-side')).toBe('top');
    expect(reactions[1]?.getAttribute('data-side')).toBe('bottom');
    expect(reactions[1]?.getAttribute('data-align')).toBe('end');
    expect(screen.getByRole('button', { name: 'Clickable' }).getAttribute('data-slot')).toBe(
      'bubble-content',
    );
  });

  it('renders message slots', () => {
    const { container } = render(
      <MessageGroup>
        <Message align="end">
          <MessageAvatar>A</MessageAvatar>
          <MessageContent>
            <MessageHeader>Alice</MessageHeader>
            <MessageFooter>now</MessageFooter>
          </MessageContent>
        </Message>
        <Message />
      </MessageGroup>,
    );
    const messages = container.querySelectorAll('[data-slot="message"]');
    expect(messages[0]?.getAttribute('data-align')).toBe('end');
    expect(messages[1]?.getAttribute('data-align')).toBe('start');
    for (const name of ['message-group', 'message-avatar', 'message-header', 'message-footer'])
      expect(slot(container, name)).toBeTruthy();
  });

  it('renders marker variants', () => {
    const { container } = render(
      <div>
        <Marker variant="separator">
          <MarkerIcon>*</MarkerIcon>
          <MarkerContent>Today</MarkerContent>
        </Marker>
        <Marker asChild>
          <a href="/m">Linked</a>
        </Marker>
      </div>,
    );
    expect(slot(container, 'marker')?.getAttribute('data-variant')).toBe('separator');
    expect(slot(container, 'marker-icon')?.getAttribute('aria-hidden')).toBe('true');
    expect(screen.getByRole('link', { name: 'Linked' }).getAttribute('data-variant')).toBe(
      'default',
    );
    expect(markerVariants({ variant: 'border' })).toContain('border-b');
  });
});

describe('Input fireEvent', () => {
  it('forwards change events', () => {
    const onChange = vi.fn();
    render(<Input aria-label="x" onChange={onChange} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'z' } });
    expect(onChange).toHaveBeenCalled();
  });
});
