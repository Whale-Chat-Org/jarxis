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
