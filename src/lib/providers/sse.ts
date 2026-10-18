import 'server-only';

/**
 * Server-sent event framing for the gateway.
 *
 * The gateway both parses upstream SSE (provider streams) and emits SSE (client streams), so the
 * framing lives in one place. The parser is incremental and bounded: an upstream that never sends
 * a blank line cannot grow the buffer without limit.
 */

export type SseEvent = {
  /** `event:` field, empty string when the upstream omits it. */
  event: string;
  /** Concatenated `data:` lines, newline joined, as the SSE spec requires. */
  data: string;
  id?: string;
};

const MAX_EVENT_BYTES = 1024 * 1024;

export class SseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SseError';
  }
}

function parseBlock(block: string): SseEvent | null {
  let event = '';
  let id: string | undefined;
  const data: string[] = [];
  for (const rawLine of block.split('\n')) {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    if (line === '' || line.startsWith(':')) continue;
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') event = value;
    else if (field === 'data') data.push(value);
    else if (field === 'id') id = value;
    // `retry` and unknown fields are ignored, per the SSE specification.
  }
  if (!data.length && !event) return null;
  return { event, data: data.join('\n'), id };
}

/** Incremental SSE decoder. Feed it decoded text chunks; it yields complete events. */
export class SseDecoder {
  private buffer = '';

  push(chunk: string): SseEvent[] {
    this.buffer += chunk;
    if (this.buffer.length > MAX_EVENT_BYTES) {
      throw new SseError('Upstream stream event exceeded the allowed size');
    }
    const events: SseEvent[] = [];
    for (;;) {
      const match = /\r\n\r\n|\n\n|\r\r/.exec(this.buffer);
      if (!match) break;
      const block = this.buffer.slice(0, match.index);
      this.buffer = this.buffer.slice(match.index + match[0].length);
      const parsed = parseBlock(block);
      if (parsed) events.push(parsed);
    }
    return events;
  }

  /** Flush a trailing event that the upstream ended without a blank line. */
  flush(): SseEvent[] {
    const rest = this.buffer;
    this.buffer = '';
    if (!rest.trim()) return [];
    const parsed = parseBlock(rest);
    return parsed ? [parsed] : [];
  }
}

/** Decode an SSE response body into events, aborting cleanly when the consumer stops. */
export async function* readSse(
  body: ReadableStream<Uint8Array> | null,
): AsyncGenerator<SseEvent, void, void> {
  if (!body) return;
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const sse = new SseDecoder();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      for (const event of sse.push(decoder.decode(value, { stream: true }))) yield event;
    }
    for (const event of sse.flush()) yield event;
  } finally {
    reader.releaseLock();
    await body.cancel().catch(() => {});
  }
}

/** Serialize one event. `data` is emitted verbatim, one `data:` line per newline. */
export function encodeSse(event: { event?: string; data: string }): string {
  const lines: string[] = [];
  if (event.event) lines.push(`event: ${event.event}`);
  for (const line of event.data.split('\n')) lines.push(`data: ${line}`);
  return `${lines.join('\n')}\n\n`;
}

export const SSE_HEADERS = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-store',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no',
} as const;
