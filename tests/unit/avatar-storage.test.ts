import { describe, expect, it } from 'vitest';

import { avatarURL, isPng } from '@/lib/avatar-storage';

describe('avatar storage identifiers', () => {
  it('builds a same-origin URL with an encoded user id', () => {
    expect(avatarURL('user/with space', '123e4567-e89b-42d3-a456-426614174000')).toBe(
      '/api/profile/avatar/user%2Fwith%20space/123e4567-e89b-42d3-a456-426614174000',
    );
  });

  it('recognizes the complete PNG signature', () => {
    expect(isPng(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(true);
    expect(isPng(Buffer.from([0x89, 0x50, 0x4e, 0x47]))).toBe(false);
    expect(isPng(Buffer.from('not a png'))).toBe(false);
  });
});
