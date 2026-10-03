import { describe, expect, it } from 'vitest';
import { poolModelId } from '@/lib/ml/model-id';

describe('pool model identity', () => {
  it('keeps preset model IDs stable and pools credentials for the same endpoint', () => {
    expect(
      poolModelId({ provider: 'openai', baseUrl: 'https://api.openai.com/v1/' }, 'gpt-test'),
    ).toBe('openai/gpt-test');
    expect(
      poolModelId({ provider: 'custom', baseUrl: 'https://models.example.test/v1' }, 'same-model'),
    ).toBe(
      poolModelId({ provider: 'custom', baseUrl: 'https://models.example.test/v1/' }, 'same-model'),
    );
  });
  it('keeps unrelated custom endpoints and provider names separate', () => {
    const first = poolModelId(
      { provider: 'custom', baseUrl: 'https://first.example.test/v1' },
      'same-model',
    );
    expect(first).not.toBe(
      poolModelId({ provider: 'custom', baseUrl: 'https://second.example.test/v1' }, 'same-model'),
    );
    expect(first).not.toBe(
      poolModelId(
        { provider: 'custom', baseUrl: 'https://first.example.test/other' },
        'same-model',
      ),
    );
    expect(first).not.toBe(
      poolModelId({ provider: 'openai', baseUrl: 'https://first.example.test/v1' }, 'same-model'),
    );
  });
});
