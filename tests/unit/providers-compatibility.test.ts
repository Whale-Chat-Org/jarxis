import { DELETE as oldDelete, PATCH as oldPatch } from '@/app/api/admin/ml-providers/[id]/route';
import { GET as oldGet, POST as oldPost } from '@/app/api/admin/ml-providers/route';
import { DELETE, PATCH } from '@/app/api/admin/providers/[id]/route';
import { GET, POST } from '@/app/api/admin/providers/route';
import { describe, expect, it } from 'vitest';

describe('Providers compatibility routes', () => {
  it('shares the guarded implementation for legacy reads and mutation bodies', () => {
    expect(oldGet).toBe(GET);
    expect(oldPost).toBe(POST);
    expect(oldPatch).toBe(PATCH);
    expect(oldDelete).toBe(DELETE);
  });
});

for (const suffix of ['/discover', '/keys', '/keys/[keyId]', '/[id]/models', '/[id]/refresh']) {
  it(`delegates every legacy ${suffix} handler to the canonical module`, async () => {
    const legacy = await import(`../../src/app/api/admin/ml-providers${suffix}/route`);
    const canonical = await import(`../../src/app/api/admin/providers${suffix}/route`);
    for (const method of ['GET', 'POST', 'PATCH', 'DELETE']) {
      if (method in legacy) expect(legacy[method]).toBe(canonical[method]);
    }
  });
}
