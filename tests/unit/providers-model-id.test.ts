import { publicModelId } from '@/lib/providers/model-id';
import { describe, expect, it } from 'vitest';

describe('public model identity', () => {
  it('keeps preset model IDs stable and pools credentials for the same endpoint', () => {
    expect(
      publicModelId({ provider: 'openai', baseUrl: 'https://api.openai.com/v1/' }, 'gpt-test'),
    ).toBe('openai/gpt-test');
    expect(
      publicModelId(
        { provider: 'custom', baseUrl: 'https://models.example.test/v1' },
        'same-model',
      ),
    ).toBe(
      publicModelId(
        { provider: 'custom', baseUrl: 'https://models.example.test/v1/' },
        'same-model',
      ),
    );
  });
  it('keeps unrelated custom endpoints and provider names separate', () => {
    const first = publicModelId(
      { provider: 'custom', baseUrl: 'https://first.example.test/v1' },
      'same-model',
    );
    expect(first).not.toBe(
      publicModelId(
        { provider: 'custom', baseUrl: 'https://second.example.test/v1' },
        'same-model',
      ),
    );
    expect(first).not.toBe(
      publicModelId(
        { provider: 'custom', baseUrl: 'https://first.example.test/other' },
        'same-model',
      ),
    );
    expect(first).not.toBe(
      publicModelId({ provider: 'openai', baseUrl: 'https://first.example.test/v1' }, 'same-model'),
    );
  });
});

describe('public model identity edge cases', () => {
  it('namespaces root endpoints and unknown providers by endpoint hash', () => {
    expect(
      publicModelId({ provider: 'custom', baseUrl: 'https://root.example.test' }, 'm'),
    ).toMatch(/^custom-[0-9a-f]{24}\/m$/);
    expect(
      publicModelId({ provider: 'legacy', baseUrl: 'https://api.openai.com/v1' }, 'm'),
    ).toMatch(/^legacy-[0-9a-f]{24}\/m$/);
    expect(
      publicModelId({ provider: 'openai', baseUrl: 'https://proxy.example.test/v1' }, 'm'),
    ).toMatch(/^openai-[0-9a-f]{24}\/m$/);
  });
});
