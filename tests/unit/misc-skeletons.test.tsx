import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import {
  AdminShellSkeleton,
  AuthCardSkeleton,
  LandingSkeleton,
  ListCardSkeleton,
  LoadingRegion,
  PageHeaderSkeleton,
  PaginationSkeleton,
  RoleCardsSkeleton,
  SettingsSkeleton,
  StatCardsSkeleton,
  TableSkeleton,
} from '@/components/skeletons';

const count = (container: HTMLElement, selector: string) =>
  container.querySelectorAll(selector).length;

describe('skeletons', () => {
  it('announces loading once and hides the shapes', () => {
    render(
      <LoadingRegion label="Loading things" className="region">
        <span>shape</span>
      </LoadingRegion>,
    );
    const status = screen.getByRole('status');
    expect(status.getAttribute('aria-busy')).toBe('true');
    expect(status.className).toBe('region');
    expect(status.textContent).toContain('Loading things');
    expect(screen.getByText('shape').parentElement?.getAttribute('aria-hidden')).toBe('true');
  });

  it('renders table rows and columns', () => {
    const { container } = render(<TableSkeleton columns={3} rows={4} />);
    expect(count(container, 'th')).toBe(3);
    expect(count(container, 'tbody tr')).toBe(4);
    expect(count(container, 'tbody td')).toBe(12);
  });

  it('renders configurable card counts', () => {
    const { container, rerender } = render(<StatCardsSkeleton />);
    expect(count(container, '[data-slot="card"]')).toBe(4);
    rerender(<StatCardsSkeleton count={2} />);
    expect(count(container, '[data-slot="card"]')).toBe(2);
    rerender(<RoleCardsSkeleton count={3} />);
    expect(count(container, '[data-slot="card"]')).toBe(3);
    rerender(<RoleCardsSkeleton />);
    expect(count(container, '[data-slot="card"]')).toBe(4);
    rerender(<ListCardSkeleton />);
    expect(count(container, '[data-slot="card-content"] > div')).toBe(5);
    rerender(<ListCardSkeleton lines={2} />);
    expect(count(container, '[data-slot="card-content"] > div')).toBe(2);
  });

  it('renders page header with an optional action and pagination', () => {
    render(
      <>
        <PageHeaderSkeleton action={<button type="button">Act</button>} />
        <PageHeaderSkeleton />
        <PaginationSkeleton />
      </>,
    );
    expect(screen.getByRole('button', { name: 'Act' })).toBeTruthy();
  });

  it('renders the page-level skeletons with loading labels', () => {
    render(
      <>
        <AuthCardSkeleton />
        <SettingsSkeleton />
        <AdminShellSkeleton />
        <LandingSkeleton />
      </>,
    );
    const labels = screen.getAllByRole('status').map((status) => status.textContent);
    expect(labels).toEqual(
      expect.arrayContaining(['Loading…', 'Loading settings…', 'Loading administration…']),
    );
    expect(document.querySelectorAll('[data-sidebar="menu-skeleton"]').length).toBe(8);
  });
});
