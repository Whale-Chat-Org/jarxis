import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ due: vi.fn(), refresh: vi.fn(), pause: vi.fn() }));
vi.mock('@/db', () => ({ db: { providerConnection: { findMany: m.due } } }));
vi.mock('@/lib/providers/discovery', () => ({ refreshConnection: m.refresh }));
vi.mock('node:timers/promises', () => ({ setTimeout: m.pause }));

const { SseDecoder, SseError, encodeSse, readSse, SSE_HEADERS } =
  await import('@/lib/providers/sse');
const { runWorker, workerTick } = await import('@/lib/providers/worker');
const { defaultBaseUrl } = await import('@/lib/providers/types');

function stream(chunks: string[], close = true) {
  const encoder = new TextEncoder();
  const cancel = vi.fn();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      if (close) controller.close();
    },
    cancel,
  });
  return { body, cancel };
}
async function collect<T>(iterable: AsyncIterable<T>) {
  const out: T[] = [];
  for await (const value of iterable) out.push(value);
  return out;
}

describe('SseDecoder', () => {
  it('parses events across chunks with every line ending', () => {
    const decoder = new SseDecoder();
    expect(decoder.push('event: delta\ndata: hel')).toEqual([]);
    expect(decoder.push('lo\n\n')).toEqual([{ event: 'delta', data: 'hello', id: undefined }]);
    expect(decoder.push('data: a\r\ndata:b\r\nid: 7\r\n\r\n')).toEqual([
      { event: '', data: 'a\nb', id: '7' },
    ]);
    expect(decoder.push('data: c\r\r')).toEqual([{ event: '', data: 'c', id: undefined }]);
  });

  it('ignores comments, retry, unknown and empty blocks', () => {
    const decoder = new SseDecoder();
    expect(decoder.push(': keep-alive\n\nretry: 100\nfoo: bar\n\n')).toEqual([]);
    expect(decoder.push('data\n\n')).toEqual([{ event: '', data: '', id: undefined }]);
    expect(decoder.push('event: ping\n\n')).toEqual([{ event: 'ping', data: '', id: undefined }]);
  });

  it('bounds the buffer when no blank line arrives', () => {
    const decoder = new SseDecoder();
    expect(() => decoder.push('data: ' + 'x'.repeat(1024 * 1024))).toThrow(SseError);
    try {
      new SseDecoder().push('x'.repeat(1024 * 1024 + 1));
    } catch (error) {
      expect((error as Error).name).toBe('SseError');
    }
  });

  it('flushes a trailing event and ignores whitespace or comment-only remainders', () => {
    const decoder = new SseDecoder();
    decoder.push('data: tail');
    expect(decoder.flush()).toEqual([{ event: '', data: 'tail', id: undefined }]);
    expect(decoder.flush()).toEqual([]);
    decoder.push('   \n');
    expect(decoder.flush()).toEqual([]);
    decoder.push(': comment');
    expect(decoder.flush()).toEqual([]);
  });
});

describe('readSse', () => {
  it('yields nothing for a null body', async () => {
    expect(await collect(readSse(null))).toEqual([]);
  });

  it('decodes a stream, flushes the tail and releases the body', async () => {
    const { body } = stream(['data: one\n\n', 'event: done\ndata: two']);
    expect(await collect(readSse(body))).toEqual([
      { event: '', data: 'one', id: undefined },
      { event: 'done', data: 'two', id: undefined },
    ]);
  });

  it('cancels the upstream when the consumer stops early', async () => {
    const { body, cancel } = stream(['data: one\n\ndata: two\n\n'], false);
    const iterator = readSse(body);
    await iterator.next();
    await iterator.return(undefined);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(body.locked).toBe(false);
  });
});

describe('encodeSse', () => {
  it('emits one data line per newline and an optional event name', () => {
    expect(encodeSse({ data: 'a\nb' })).toBe('data: a\ndata: b\n\n');
    expect(encodeSse({ event: 'done', data: '[DONE]' })).toBe('event: done\ndata: [DONE]\n\n');
    expect(SSE_HEADERS['Cache-Control']).toBe('no-store');
  });
});

describe('types', () => {
  it('maps providers to base URLs and builds public ids', () => {
    expect(defaultBaseUrl('anthropic')).toBe('https://api.anthropic.com/v1');
    expect(defaultBaseUrl('custom')).toBe('');
  });
});

describe('runWorker', () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  beforeEach(() => {
    vi.resetAllMocks();
    error.mockImplementation(() => {});
  });
  afterEach(() => error.mockReset());

  it('returns immediately when already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    await workerTick(controller.signal);
    await runWorker(controller.signal);
    expect(m.due).not.toHaveBeenCalled();
  });

  it('logs a failed poll without details and keeps polling until aborted', async () => {
    const controller = new AbortController();
    m.due.mockRejectedValueOnce(new Error('db password=fake')).mockResolvedValue([]);
    m.pause
      .mockImplementationOnce(async () => undefined)
      .mockImplementationOnce(async () => {
        controller.abort();
        throw new Error('AbortError');
      });
    await runWorker(controller.signal);
    expect(error).toHaveBeenCalledWith('Providers worker poll failed; retrying.');
    expect(m.due).toHaveBeenCalledTimes(2);
    expect(m.pause).toHaveBeenCalledWith(1000, undefined, { signal: controller.signal });
  });

  it('rethrows a pause failure that is not caused by shutdown', async () => {
    m.due.mockResolvedValue([]);
    m.pause.mockRejectedValue(new Error('timer broke'));
    await expect(runWorker(new AbortController().signal)).rejects.toThrow('timer broke');
  });

  it('skips the pause once shutdown is requested during a tick', async () => {
    const controller = new AbortController();
    m.due.mockImplementation(async () => {
      controller.abort();
      return [];
    });
    await runWorker(controller.signal);
    expect(m.pause).not.toHaveBeenCalled();
  });
});
