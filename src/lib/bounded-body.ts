/** Low-level bytes only; callers keep content types, limits and public error contracts. */
export async function readBoundedBody(
  stream: ReadableStream<Uint8Array>,
  limit: number,
  errors: { tooLarge: () => Error; aborted?: () => Error },
  signal?: AbortSignal,
): Promise<Buffer> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  const abort = () => {
    void reader.cancel().catch(() => {});
  };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    for (;;) {
      if (signal?.aborted) throw errors.aborted?.() ?? new Error('Request aborted');
      const { done, value } = await reader.read();
      if (signal?.aborted) throw errors.aborted?.() ?? new Error('Request aborted');
      if (done) return Buffer.concat(chunks);
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw errors.tooLarge();
      }
      chunks.push(value);
    }
  } finally {
    signal?.removeEventListener('abort', abort);
    reader.releaseLock();
  }
}
