import { runWorker, workerTick } from '@/lib/providers/worker';
import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ due: vi.fn(), discover: vi.fn() }));
vi.mock('@/db', () => ({ db: { providerConnection: { findMany: mocks.due } } }));
vi.mock('@/lib/providers/discovery', () => ({ refreshConnection: mocks.discover }));
beforeEach(() => vi.resetAllMocks());
it('discovers due API-key connections and continues after one provider fails', async () => {
  mocks.due.mockResolvedValue([{ id: 'first' }, { id: 'second' }]);
  mocks.discover.mockRejectedValueOnce(new Error('unavailable')).mockResolvedValue(undefined);
  await workerTick(new AbortController().signal);
  expect(mocks.due.mock.calls[0][0].where.provider.in).toEqual([
    'openai',
    'anthropic',
    'openrouter',
    'custom',
  ]);
  expect(mocks.discover.mock.calls).toEqual([['first'], ['second']]);
});
it('stops before discovery when shutdown is requested', async () => {
  const controller = new AbortController();
  mocks.due.mockResolvedValue([{ id: 'first' }, { id: 'second' }]);
  mocks.discover.mockImplementation(async () => controller.abort());
  await workerTick(controller.signal);
  expect(mocks.discover.mock.calls).toEqual([['first']]);
  await runWorker(controller.signal);
  expect(mocks.due).toHaveBeenCalledTimes(1);
});
