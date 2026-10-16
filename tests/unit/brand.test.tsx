import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { BrandMark } from '@/components/brand';

describe('BrandMark', () => {
  it('is decorative without a label', () => {
    const { container } = render(<BrandMark />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
    expect(svg?.getAttribute('role')).toBeNull();
  });

  it('is an accessible image with a label and keeps extra classes', () => {
    const { container } = render(<BrandMark label="Jarxis" className="extra" />);
    expect(screen.getByRole('img', { name: 'Jarxis' })).toBeTruthy();
    expect(container.firstElementChild?.className).toContain('extra');
  });
});
