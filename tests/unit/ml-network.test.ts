import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ClientRequest, IncomingMessage } from 'node:http';
import type { RequestOptions } from 'node:https';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  isBlockedAddress,
  NetworkError,
  resolveDestination,
  safeFetch,
  validateDestination,
  type LookupAll,
  type Transport,
} from '@/lib/ml/network';

const publicLookup =
  (...addresses: string[]): LookupAll =>
  (_host, _options, callback) =>
    callback(
      null,
      addresses.map((address) => ({ address, family: address.includes(':') ? 6 : 4 })),
    );

type FakeMessage = PassThrough & {
  statusCode: number;
  headers: Record<string, string>;
  complete: boolean;
};

function fakeTransport(status = 200, headers: Record<string, string> = {}) {
  const state: {
    options?: RequestOptions;
    message?: FakeMessage;
    request?: ClientRequest;
    body: Buffer[];
    destroyed: boolean;
  } = { body: [], destroyed: false };
  const transport: Transport = (options, callback) => {
    state.options = options;
    const request = Object.assign(new EventEmitter(), {
      write: (chunk: Buffer) => {
        state.body.push(chunk);
        return true;
      },
      end: (chunk?: Buffer) => {
        if (chunk) state.body.push(chunk);
        const message = Object.assign(new PassThrough(), {
          statusCode: status,
          headers,
          complete: false,
        }) as FakeMessage;
        message.on('end', () => {
          message.complete = true;
        });
        state.message = message;
        queueMicrotask(() => callback(message as unknown as IncomingMessage));
      },
      destroy: () => {
        state.destroyed = true;
        state.message?.destroy();
      },
    }) as unknown as ClientRequest;
    state.request = request;
    return request;
  };
  return { transport, state };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => vi.useRealTimers());

describe('isBlockedAddress', () => {
  it.each([
    '127.0.0.1',
    '10.0.0.1',
    '172.16.0.1',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '224.0.0.1',
    '255.255.255.255',
    '192.0.2.1',
    '198.18.0.1',
    '203.0.113.5',
    '::',
    '::1',
    'fe80::1',
    'fc00::1',
    'ff02::1',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    '64:ff9b::a00:1',
    '2002::1',
    '2001:db8::1',
    '2001::1',
    '017.0.0.1',
    '0x7f.0.0.1',
    'localhost',
  ])('blocks %s', (address) => expect(isBlockedAddress(address)).toBe(true));

  it.each(['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111', '::ffff:8.8.8.8'])(
    'allows %s',
    (address) => expect(isBlockedAddress(address)).toBe(false),
  );
});

describe('validateDestination', () => {
  it.each([
    'http://api.example.com/v1',
    'https://user:pass@api.example.com/v1',
    'https://api.example.com/v1#frag',
    'https://127.0.0.1/v1',
    'https://[::1]/v1',
    'https://0x7f000001/v1',
    'not a url',
  ])('rejects %s', async (url) => {
    await expect(
      validateDestination(url, { lookup: publicLookup('8.8.8.8') }),
    ).rejects.toMatchObject({ code: 'DESTINATION_REJECTED' });
  });

  it('rejects mixed DNS answers instead of filtering them', async () => {
    await expect(
      validateDestination('https://api.example.com', {
        lookup: publicLookup('8.8.8.8', '10.0.0.1'),
      }),
    ).rejects.toMatchObject({ code: 'DESTINATION_REJECTED' });
  });

  it('pins the first validated public answer', async () => {
    const pinned = await resolveDestination('https://api.example.com:8443/v1', {
      lookup: publicLookup('2606:4700:4700::1111', '1.1.1.1'),
    });
    expect(pinned).toMatchObject({
      hostname: 'api.example.com',
      port: 8443,
      address: '2606:4700:4700::1111',
      family: 6,
    });
  });

  it('maps resolver failures to DNS_FAILED', async () => {
    const lookup: LookupAll = (_host, _options, callback) =>
      callback(Object.assign(new Error('nx'), { code: 'ENOTFOUND' }), []);
    await expect(
      validateDestination('https://missing.example.com', { lookup }),
    ).rejects.toMatchObject({ code: 'DNS_FAILED' });
  });

  it('bounds DNS resolution by the deadline', async () => {
    vi.useFakeTimers();
    const pending = validateDestination('https://slow.example.com', {
      lookup: () => {},
      timeoutMs: 50,
    });
    const assertion = expect(pending).rejects.toMatchObject({ code: 'TIMEOUT' });
    await vi.advanceTimersByTimeAsync(60);
    await assertion;
  });

  it('aborts DNS resolution with the signal', async () => {
    const controller = new AbortController();
    const pending = validateDestination('https://slow.example.com', {
      lookup: () => {},
      signal: controller.signal,
    });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: 'ABORTED' });
  });
});

describe('safeFetch', () => {
  it('pins the socket lookup, strips forbidden headers and streams the body', async () => {
    const { transport, state } = fakeTransport(200, {
      'content-type': 'application/json',
      'set-cookie': 'a=b',
    });
    const pending = safeFetch(
      'https://api.example.com/v1/models?x=1',
      {
        method: 'POST',
        body: '{"a":1}',
        headers: { Authorization: 'Bearer k', Cookie: 'c=d', Host: 'evil' },
      },
      { lookup: publicLookup('8.8.8.8'), transport },
    );
    await tick();
    state.message!.end('{"ok":true}');
    const response = await pending;
    expect(response.status).toBe(200);
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(await response.json()).toEqual({ ok: true });
    expect(state.options).toMatchObject({
      hostname: 'api.example.com',
      path: '/v1/models?x=1',
      method: 'POST',
      servername: 'api.example.com',
    });
    expect(state.options!.headers).toMatchObject({
      authorization: 'Bearer k',
      'accept-encoding': 'identity',
      'user-agent': expect.stringMatching(/^jarxis\//),
    });
    expect(state.options!.headers).not.toHaveProperty('cookie');
    expect(state.options!.headers).not.toHaveProperty('host');
    expect(Buffer.concat(state.body).toString()).toBe('{"a":1}');
    const lookup = state.options!.lookup as unknown as (
      host: string,
      options: object,
      callback: (...args: unknown[]) => void,
    ) => void;
    const callback = vi.fn();
    lookup('rebound.internal', {}, callback);
    expect(callback).toHaveBeenCalledWith(null, '8.8.8.8', 4);
  });

  it('keeps a caller-supplied User-Agent', async () => {
    const { transport, state } = fakeTransport();
    const pending = safeFetch(
      'https://api.example.com',
      { headers: { 'User-Agent': 'custom/1' } },
      { lookup: publicLookup('8.8.8.8'), transport },
    );
    await tick();
    state.message!.end();
    await pending;
    expect(state.options!.headers).toMatchObject({ 'user-agent': 'custom/1' });
  });

  it('rejects redirects', async () => {
    const { transport } = fakeTransport(302, { location: 'https://169.254.169.254/' });
    await expect(
      safeFetch('https://api.example.com', {}, { lookup: publicLookup('8.8.8.8'), transport }),
    ).rejects.toMatchObject({ code: 'REDIRECT' });
  });

  it('errors the body once the response cap is exceeded', async () => {
    const { transport, state } = fakeTransport();
    const pending = safeFetch(
      'https://api.example.com',
      { maxResponseBytes: 4 },
      { lookup: publicLookup('8.8.8.8'), transport },
    );
    await tick();
    const response = await pending;
    state.message!.write('123456');
    await expect(response.text()).rejects.toMatchObject({ code: 'TOO_LARGE' });
  });

  it('times out before headers arrive', async () => {
    const transport: Transport = () =>
      Object.assign(new EventEmitter(), {
        end: () => {},
        write: () => true,
        destroy: () => {},
      }) as unknown as ClientRequest;
    await expect(
      safeFetch(
        'https://api.example.com',
        { timeoutMs: 20 },
        { lookup: publicLookup('8.8.8.8'), transport },
      ),
    ).rejects.toMatchObject({ code: 'TIMEOUT' });
  });

  it('keeps the deadline after headers so a stalled body still fails', async () => {
    const { transport, state } = fakeTransport();
    const pending = safeFetch(
      'https://api.example.com',
      { timeoutMs: 40 },
      { lookup: publicLookup('8.8.8.8'), transport },
    );
    await tick();
    const response = await pending;
    state.message!.write('partial');
    const error = await response.text().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(NetworkError);
    expect(error).toMatchObject({ code: 'TIMEOUT' });
    expect(state.message!.destroyed).toBe(true);
  });

  it('propagates abort into an in-flight body and destroys the socket', async () => {
    const controller = new AbortController();
    const { transport, state } = fakeTransport();
    const pending = safeFetch(
      'https://api.example.com',
      { signal: controller.signal },
      { lookup: publicLookup('8.8.8.8'), transport },
    );
    await tick();
    const response = await pending;
    const reading = response.text();
    controller.abort();
    await expect(reading).rejects.toMatchObject({ code: 'ABORTED' });
    expect(state.destroyed || state.message!.destroyed).toBe(true);
  });

  it('rejects immediately when already aborted', async () => {
    const { transport } = fakeTransport();
    await expect(
      safeFetch(
        'https://api.example.com',
        { signal: AbortSignal.abort() },
        { lookup: publicLookup('8.8.8.8'), transport },
      ),
    ).rejects.toMatchObject({ code: 'ABORTED' });
  });

  it('maps a connection drop mid-body to TRANSPORT', async () => {
    const { transport, state } = fakeTransport();
    const pending = safeFetch(
      'https://api.example.com',
      {},
      { lookup: publicLookup('8.8.8.8'), transport },
    );
    await tick();
    const response = await pending;
    state.message!.write('x');
    state.message!.destroy();
    await expect(response.text()).rejects.toMatchObject({ code: 'TRANSPORT' });
  });
});

describe('address parser edge cases', () => {
  it.each([
    '256.1.1.1',
    '1.2.3',
    'fe80::1%eth0',
    '2001:db8::/32',
    '1::2::3',
    '2001:4860:1.2.3.4:1',
    '2001:4860::8.8.8.256',
    '2001:4860:4860:0:0:0:0',
    '2001:4860:4860:0:0:0:0::8888',
    '2001:zzzz::1',
    '198.19.0.1',
    '198.51.100.7',
    '192.0.0.1',
    '192.88.99.1',
    '172.31.255.255',
    '3ffe::1',
    '3fff::1',
    '2001:100::1',
    '2001:2::1',
    '::ffff:10.0.0.1',
  ])('blocks %s', (address) => expect(isBlockedAddress(address)).toBe(true));

  it.each([
    '2001:4860:4860:0:0:0:0:8888',
    '2001:4860::8.8.8.8',
    '172.32.0.1',
    '100.128.0.1',
    '9.9.9.9',
  ])('allows %s', (address) => expect(isBlockedAddress(address)).toBe(false));
});

describe('literal destinations', () => {
  it('accepts a public literal address without DNS and without SNI', async () => {
    const lookup = vi.fn();
    await expect(
      resolveDestination(new URL('https://8.8.8.8/v1'), { lookup }),
    ).resolves.toMatchObject({
      address: '8.8.8.8',
      family: 4,
      port: 443,
    });
    await expect(resolveDestination('https://[2606:4700:4700::1111]:8443/')).resolves.toMatchObject(
      {
        address: '2606:4700:4700::1111',
        family: 6,
        port: 8443,
      },
    );
    expect(lookup).not.toHaveBeenCalled();

    const { transport, state } = fakeTransport();
    const pending = safeFetch('https://8.8.8.8/', {}, { transport });
    await tick();
    state.message!.end();
    await pending;
    expect(state.options!.servername).toBeUndefined();
  });

  it('maps an empty DNS answer to DNS_FAILED', async () => {
    const lookup: LookupAll = (_host, _options, callback) => callback(null, []);
    await expect(
      validateDestination('https://empty.example.com', { lookup }),
    ).rejects.toMatchObject({
      code: 'DNS_FAILED',
    });
  });

  it('ignores a resolver that answers after the deadline', async () => {
    vi.useFakeTimers();
    let late: ((error: null, addresses: { address: string; family: number }[]) => void) | undefined;
    const pending = validateDestination('https://slow.example.com', {
      lookup: (_h, _o, callback) => {
        late = callback;
      },
      timeoutMs: 10,
    });
    const assertion = expect(pending).rejects.toMatchObject({ code: 'TIMEOUT' });
    await vi.advanceTimersByTimeAsync(20);
    late!(null, [{ address: '8.8.8.8', family: 4 }]);
    await assertion;
  });

  it('defaults IPv4 answers to family 4', async () => {
    const lookup: LookupAll = (_h, _o, callback) =>
      callback(null, [{ address: '8.8.8.8', family: 0 }]);
    await expect(resolveDestination('https://api.example.com', { lookup })).resolves.toMatchObject({
      family: 4,
    });
  });
});

describe('safeFetch request handling', () => {
  const lookup = publicLookup('8.8.8.8');

  it('rejects an already-aborted signal and an exhausted deadline for literal hosts', async () => {
    const { transport } = fakeTransport();
    await expect(
      safeFetch('https://8.8.8.8', { signal: AbortSignal.abort() }, { transport }),
    ).rejects.toMatchObject({ code: 'ABORTED' });
    await expect(
      safeFetch('https://8.8.8.8', { timeoutMs: 0 }, { transport }),
    ).rejects.toMatchObject({
      code: 'TIMEOUT',
    });
  });

  it('rejects header injection and oversized header values', async () => {
    const { transport } = fakeTransport();
    await expect(
      safeFetch(
        'https://api.example.com',
        { headers: { 'x-test': 'a'.repeat(8 * 1024 + 1) } },
        { lookup, transport },
      ),
    ).rejects.toMatchObject({ code: 'DESTINATION_REJECTED' });
    // CR/LF never reaches the socket: header construction itself refuses it.
    await expect(
      safeFetch(
        'https://api.example.com',
        { headers: { 'x-test': 'a\r\nInjected: 1' } },
        { lookup, transport },
      ),
    ).rejects.toThrow();
  });

  it('writes byte bodies and streamed bodies, waiting for drain', async () => {
    const bytes = fakeTransport();
    const first = safeFetch(
      'https://api.example.com',
      { method: 'post', body: new TextEncoder().encode('bytes') },
      { lookup, transport: bytes.transport },
    );
    await tick();
    bytes.state.message!.end();
    await first;
    expect(Buffer.concat(bytes.state.body).toString()).toBe('bytes');
    expect(bytes.state.options!.method).toBe('POST');

    const chunks: Buffer[] = [];
    let message: FakeMessage | undefined;
    const drainTransport: Transport = (_options, callback) => {
      let writes = 0;
      const request: ClientRequest = Object.assign(new EventEmitter(), {
        write: (chunk: Buffer) => {
          chunks.push(chunk);
          writes += 1;
          if (writes === 1) {
            queueMicrotask(() => request.emit('drain'));
            return false;
          }
          return true;
        },
        end: () => {
          message = Object.assign(new PassThrough(), {
            statusCode: 200,
            headers: {},
            complete: false,
          }) as FakeMessage;
          queueMicrotask(() => callback(message as unknown as IncomingMessage));
        },
        destroy: () => {},
      }) as unknown as ClientRequest;
      return request;
    };
    const streamed = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('a'));
        controller.enqueue(new TextEncoder().encode('b'));
        controller.close();
      },
    });
    const second = safeFetch(
      'https://api.example.com',
      { method: 'POST', body: streamed, duplex: 'half' } as RequestInit,
      { lookup, transport: drainTransport },
    );
    await vi.waitFor(() => expect(message).toBeDefined());
    message!.end();
    await second;
    expect(Buffer.concat(chunks).toString()).toBe('ab');
  });

  it('fails with TRANSPORT when a streamed body errors or the body type is unsupported', async () => {
    let destroyed = false;
    const transport: Transport = () =>
      Object.assign(new EventEmitter(), {
        write: () => true,
        end: () => {},
        destroy: () => {
          destroyed = true;
        },
      }) as unknown as ClientRequest;
    const failing = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(new Error('source failed'));
      },
    });
    await expect(
      safeFetch(
        'https://api.example.com',
        { method: 'POST', body: failing, duplex: 'half' } as RequestInit,
        { lookup, transport },
      ),
    ).rejects.toMatchObject({ code: 'TRANSPORT', message: 'Upstream request body failed' });
    expect(destroyed).toBe(true);

    await expect(
      safeFetch(
        'https://api.example.com',
        { method: 'POST', body: new Blob(['x']) },
        { lookup, transport },
      ),
    ).rejects.toMatchObject({ code: 'TRANSPORT' });
  });

  it('maps socket errors to TRANSPORT', async () => {
    const transport: Transport = () => {
      const request = Object.assign(new EventEmitter(), {
        write: () => true,
        end: () => queueMicrotask(() => request.emit('error', new Error('ECONNRESET 10.0.0.1'))),
        destroy: () => {},
      });
      return request as unknown as ClientRequest;
    };
    const error = await safeFetch('https://api.example.com', {}, { lookup, transport }).catch(
      (e: unknown) => e,
    );
    expect(error).toMatchObject({ code: 'TRANSPORT', message: 'Upstream connection failed' });
  });

  it('answers all-address lookups with the pinned address', async () => {
    const { transport, state } = fakeTransport();
    const pending = safeFetch('https://api.example.com', {}, { lookup, transport });
    await tick();
    state.message!.end();
    await pending;
    const pinned = state.options!.lookup as unknown as (
      h: string,
      o: unknown,
      cb: (...a: unknown[]) => void,
    ) => void;
    const callback = vi.fn();
    pinned('other.host', { all: true }, callback);
    expect(callback).toHaveBeenCalledWith(null, [{ address: '8.8.8.8', family: 4 }]);
    pinned('other.host', null, callback);
    expect(callback).toHaveBeenLastCalledWith(null, '8.8.8.8', 4);
  });

  it('returns bodyless responses without a stream', async () => {
    const { transport, state } = fakeTransport(204, { 'x-multi': 'a' });
    const pending = safeFetch('https://api.example.com', {}, { lookup, transport });
    const response = await pending;
    expect(response.status).toBe(204);
    expect(response.body).toBeNull();
    expect(state.message).toBeDefined();
  });

  it('joins array headers and defaults a missing status to 502', async () => {
    const transport: Transport = (_options, callback) => {
      const request = Object.assign(new EventEmitter(), {
        write: () => true,
        end: () => {
          const message = Object.assign(new PassThrough(), {
            statusCode: undefined,
            headers: { 'x-list': ['a', 'b'], 'x-none': undefined },
            complete: false,
          });
          queueMicrotask(() => {
            callback(message as unknown as IncomingMessage);
            message.end('ok');
          });
        },
        destroy: () => {},
      });
      return request as unknown as ClientRequest;
    };
    const response = await safeFetch('https://api.example.com', {}, { lookup, transport });
    expect(response.status).toBe(502);
    expect(response.headers.get('x-list')).toBe('a, b');
    expect(response.headers.has('x-none')).toBe(false);
  });

  it('destroys a response that arrives after the request already failed', async () => {
    vi.useFakeTimers();
    let respond: ((message: IncomingMessage) => void) | undefined;
    const transport: Transport = (_options, callback) => {
      respond = callback;
      return Object.assign(new EventEmitter(), {
        write: () => true,
        end: () => {},
        destroy: () => {},
      }) as unknown as ClientRequest;
    };
    const pending = safeFetch('https://api.example.com', { timeoutMs: 10 }, { lookup, transport });
    const assertion = expect(pending).rejects.toMatchObject({ code: 'TIMEOUT' });
    await vi.advanceTimersByTimeAsync(20);
    await assertion;
    const late = Object.assign(new PassThrough(), {
      statusCode: 200,
      headers: {},
      complete: false,
    });
    respond!(late as unknown as IncomingMessage);
    expect(late.destroyed).toBe(true);
  });

  it('destroys the upstream when the consumer cancels the body', async () => {
    const { transport, state } = fakeTransport();
    const response = await (async () => {
      const pending = safeFetch('https://api.example.com', {}, { lookup, transport });
      await tick();
      return pending;
    })();
    state.message!.write('chunk');
    const reader = response.body!.getReader();
    await reader.read();
    await reader.cancel();
    expect(state.message!.destroyed).toBe(true);
    // Late data and end events after cancellation are ignored.
    expect(() => state.message!.emit('data', Buffer.from('late'))).not.toThrow();
    expect(() => state.message!.emit('end')).not.toThrow();
  });

  it('maps an upstream abort event to TRANSPORT', async () => {
    const { transport, state } = fakeTransport();
    const pending = safeFetch('https://api.example.com', {}, { lookup, transport });
    await tick();
    const response = await pending;
    state.message!.emit('aborted');
    await expect(response.text()).rejects.toMatchObject({ code: 'TRANSPORT' });
  });
});
