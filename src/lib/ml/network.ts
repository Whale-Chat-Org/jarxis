import 'server-only';
import dns from 'node:dns';
import https from 'node:https';
import type { ClientRequest, IncomingMessage, OutgoingHttpHeaders } from 'node:http';
import type { RequestOptions } from 'node:https';

/**
 * Outbound HTTP for the model gateway.
 *
 * Every upstream call is attacker-influenced (owners configure base URLs), so this module is the
 * single egress choke point: HTTPS only, no credentials in the URL, no redirects, public
 * destinations only, and the validated address is pinned to the socket so a second DNS answer
 * cannot rebind the connection to a private host between validation and connect.
 */

export type NetworkErrorCode =
  | 'DESTINATION_REJECTED'
  | 'DNS_FAILED'
  | 'TRANSPORT'
  | 'TIMEOUT'
  | 'ABORTED'
  | 'REDIRECT'
  | 'TOO_LARGE';

export class NetworkError extends Error {
  constructor(
    readonly code: NetworkErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'NetworkError';
  }
}

/** `dns.lookup` with `all: true`, narrowed to what this module uses. */
export type LookupAll = (
  hostname: string,
  options: { all: true; verbatim: true },
  callback: (
    error: NodeJS.ErrnoException | null,
    addresses: { address: string; family: number }[],
  ) => void,
) => void;

export type Transport = (
  options: RequestOptions,
  callback: (response: IncomingMessage) => void,
) => ClientRequest;

export type NetworkOptions = {
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Injected in unit tests; production always uses the Node resolver. */
  lookup?: LookupAll;
  /** Injected in unit tests; production always uses `node:https`. */
  transport?: Transport;
};

export type PinnedDestination = {
  url: URL;
  hostname: string;
  port: number;
  /** The single validated address the socket is pinned to. */
  address: string;
  family: 4 | 6;
};

export type SafeFetchInit = RequestInit & {
  /** Hard cap on the response body; the stream errors once exceeded. */
  maxResponseBytes?: number;
  /** Wall clock budget for headers plus body. */
  timeoutMs?: number;
};

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_RESPONSE_BYTES = 64 * 1024 * 1024;
const MAX_HEADER_VALUE_LENGTH = 8 * 1024;

/** Headers a caller may never set: they are owned by the socket or leak browser state. */
const FORBIDDEN_REQUEST_HEADERS = new Set([
  'host',
  'connection',
  'keep-alive',
  'proxy-authorization',
  'proxy-connection',
  'transfer-encoding',
  'upgrade',
  'te',
  'trailer',
  'cookie',
  'content-length',
]);

const FORBIDDEN_RESPONSE_HEADERS = new Set([
  'set-cookie',
  'set-cookie2',
  'connection',
  'keep-alive',
  'transfer-encoding',
  'upgrade',
  'content-length',
]);

function parseIPv4(value: string): number[] | null {
  const parts = value.split('.');
  if (parts.length !== 4) return null;
  const bytes: number[] = [];
  for (const part of parts) {
    // Only canonical dotted decimal; octal/hex/short forms are classic SSRF bypasses.
    if (!/^(?:0|[1-9]\d{0,2})$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    bytes.push(octet);
  }
  return bytes;
}

function parseIPv6(value: string): number[] | null {
  if (value.includes('%') || value.includes('/')) return null;
  const halves = value.split('::');
  if (halves.length > 2) return null;
  const expand = (segment: string): number[] | null => {
    if (segment === '') return [];
    const groups = segment.split(':');
    const bytes: number[] = [];
    for (let index = 0; index < groups.length; index += 1) {
      const group = groups[index];
      if (group.includes('.')) {
        // Embedded IPv4 is only legal in the final position.
        if (index !== groups.length - 1) return null;
        const v4 = parseIPv4(group);
        if (!v4) return null;
        bytes.push(...v4);
        continue;
      }
      if (!/^[0-9a-fA-F]{1,4}$/.test(group)) return null;
      const word = Number.parseInt(group, 16);
      bytes.push((word >> 8) & 0xff, word & 0xff);
    }
    return bytes;
  };
  const head = expand(halves[0]);
  const tail = expand(halves[1] ?? '');
  if (!head || !tail) return null;
  if (halves.length === 1) return head.length === 16 ? head : null;
  const fill = 16 - head.length - tail.length;
  if (fill < 1) return null;
  return [...head, ...new Array<number>(fill).fill(0), ...tail];
}

function isBlockedIPv4(b: number[]): boolean {
  const [a, second, third] = b;
  if (a === 0 || a === 10 || a === 127) return true; // this host, private, loopback
  if (a >= 224) return true; // multicast, reserved, broadcast
  if (a === 169 && second === 254) return true; // link local, cloud metadata
  if (a === 172 && second >= 16 && second <= 31) return true; // private
  if (a === 192 && second === 168) return true; // private
  if (a === 100 && second >= 64 && second <= 127) return true; // CGNAT
  if (a === 192 && second === 0 && (third === 0 || third === 2)) return true; // protocol assignment, TEST-NET-1
  if (a === 192 && second === 88 && third === 99) return true; // 6to4 relay anycast
  if (a === 198 && (second === 18 || second === 19)) return true; // benchmarking
  if (a === 198 && second === 51 && third === 100) return true; // TEST-NET-2
  if (a === 203 && second === 0 && third === 113) return true; // TEST-NET-3
  return false;
}

function isBlockedIPv6(b: number[]): boolean {
  const mappedV4 = b.slice(0, 10).every((byte) => byte === 0) && b[10] === 0xff && b[11] === 0xff;
  if (mappedV4) return isBlockedIPv4(b.slice(12));
  // NAT64 well known prefix 64:ff9b::/96 smuggles IPv4 destinations.
  if (b[0] === 0x00 && b[1] === 0x64 && b[2] === 0xff && b[3] === 0x9b) return true;
  // Only global unicast 2000::/3 is routable; this rejects ::, ::1, fc00::/7, fe80::/10, ff00::/8.
  if ((b[0] & 0xe0) !== 0x20) return true;
  if (b[0] === 0x20 && b[1] === 0x02) return true; // 6to4
  if (b[0] === 0x3f && (b[1] === 0xfe || b[1] === 0xff)) return true;
  if (b[0] === 0x20 && b[1] === 0x01) {
    const word2 = (b[2] << 8) | b[3];
    if (word2 < 0x0200) return true;
    if (word2 === 0x0000) return true; // Teredo
    if (word2 === 0x0002) return true; // benchmarking
    if (word2 === 0x0db8) return true; // documentation
  }
  return false;
}

/**
 * Pure address check, exported so the rejection table can be tested without DNS or sockets.
 * Anything unparseable is blocked: the validator fails closed.
 */
export function isBlockedAddress(address: string): boolean {
  const v4 = parseIPv4(address);
  if (v4) return isBlockedIPv4(v4);
  const v6 = parseIPv6(address);
  if (v6) return isBlockedIPv6(v6);
  return true;
}

function literalAddress(hostname: string): { address: string; family: 4 | 6 } | null {
  if (hostname.startsWith('[') && hostname.endsWith(']')) {
    return { address: hostname.slice(1, -1), family: 6 };
  }
  if (parseIPv4(hostname)) return { address: hostname, family: 4 };
  if (hostname.includes(':')) return { address: hostname, family: 6 };
  return null;
}

function reject(message: string): never {
  throw new NetworkError('DESTINATION_REJECTED', message);
}

function lookupAll(hostname: string, lookup: LookupAll, options: NetworkOptions) {
  return new Promise<{ address: string; family: number }[]>((resolve, rejectPromise) => {
    let settled = false;
    const finish = (error?: Error, addresses?: { address: string; family: number }[]) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', abort);
      if (error) rejectPromise(error);
      else resolve(addresses!);
    };
    const abort = () => finish(new NetworkError('ABORTED', 'Request was aborted'));
    const timer = setTimeout(
      () => finish(new NetworkError('TIMEOUT', 'DNS lookup timed out')),
      options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    );
    options.signal?.addEventListener('abort', abort, { once: true });
    if (options.signal?.aborted) {
      abort();
      return;
    }
    lookup(hostname, { all: true, verbatim: true }, (error, addresses) => {
      if (error || !addresses?.length) {
        finish(new NetworkError('DNS_FAILED', 'Upstream host could not be resolved'));
        return;
      }
      finish(undefined, addresses);
    });
  });
}

/**
 * Validate a destination and return the address the socket must be pinned to.
 *
 * All DNS answers must be acceptable: a mixed answer set (one public, one private) is rejected
 * outright rather than filtered, because a filtered answer set is a rebinding oracle.
 */
export async function resolveDestination(
  url: string | URL,
  options: NetworkOptions = {},
): Promise<PinnedDestination> {
  let target: URL;
  try {
    target = url instanceof URL ? new URL(url.href) : new URL(url);
  } catch {
    reject('Upstream URL is not a valid absolute URL');
  }
  if (target.protocol !== 'https:') reject('Upstream URL must use https');
  if (target.username || target.password) reject('Upstream URL must not contain credentials');
  if (target.hash) reject('Upstream URL must not contain a fragment');
  if (!target.hostname) reject('Upstream URL must contain a host');
  const port = target.port ? Number(target.port) : 443;
  if (!Number.isInteger(port) || port < 1 || port > 65535) reject('Upstream port is not valid');

  const literal = literalAddress(target.hostname);
  if (literal) {
    if (isBlockedAddress(literal.address)) reject('Upstream address is not publicly routable');
    return { url: target, hostname: target.hostname, port, ...literal };
  }

  const answers = await lookupAll(
    target.hostname,
    options.lookup ?? (dns.lookup as LookupAll),
    options,
  );
  for (const answer of answers) {
    if (isBlockedAddress(answer.address)) reject('Upstream address is not publicly routable');
  }
  const first = answers[0];
  return {
    url: target,
    hostname: target.hostname,
    port,
    address: first.address,
    family: first.family === 6 ? 6 : 4,
  };
}

/** Contract surface: throws when the destination is unusable, resolves otherwise. */
export async function validateDestination(
  url: string,
  options: NetworkOptions = {},
): Promise<void> {
  await resolveDestination(url, options);
}

function outgoingHeaders(init: SafeFetchInit): OutgoingHttpHeaders {
  const headers = new Headers(init.headers ?? {});
  const out: OutgoingHttpHeaders = {};
  headers.forEach((value, key) => {
    const name = key.toLowerCase();
    if (FORBIDDEN_REQUEST_HEADERS.has(name)) return;
    if (value.length > MAX_HEADER_VALUE_LENGTH) reject('Upstream header value is too long');
    if (/[\r\n]/.test(value)) reject('Upstream header value is not valid');
    out[name] = value;
  });
  // Node does not decode content encodings for us, so ask for none.
  out['accept-encoding'] = 'identity';
  return out;
}

async function writeBody(request: ClientRequest, body: SafeFetchInit['body']) {
  if (body === undefined || body === null) {
    request.end();
    return;
  }
  if (typeof body === 'string') {
    request.end(Buffer.from(body, 'utf8'));
    return;
  }
  if (body instanceof Uint8Array) {
    request.end(Buffer.from(body.buffer, body.byteOffset, body.byteLength));
    return;
  }
  if (body instanceof ReadableStream) {
    const reader = (body as ReadableStream<Uint8Array>).getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!request.write(Buffer.from(value))) {
          await new Promise<void>((resolve, rejectDrain) => {
            request.once('drain', resolve);
            request.once('error', rejectDrain);
          });
        }
      }
      request.end();
    } catch (error) {
      request.destroy();
      throw error;
    } finally {
      reader.releaseLock();
    }
    return;
  }
  throw new NetworkError('TRANSPORT', 'Unsupported request body type');
}

function responseStream(
  message: IncomingMessage,
  maxBytes: number,
  cleanup: () => void,
  registerFailure: (fail: (error: Error) => void) => void,
): ReadableStream<Uint8Array> {
  let received = 0;
  let ended = false;
  return new ReadableStream<Uint8Array>({
    start(controller) {
      const failStream = (error?: Error) => {
        if (ended) return;
        ended = true;
        cleanup();
        controller.error(
          error instanceof NetworkError
            ? error
            : new NetworkError('TRANSPORT', 'Upstream connection failed'),
        );
      };
      registerFailure(failStream);
      message.on('data', (chunk: Buffer) => {
        if (ended) return;
        received += chunk.length;
        if (received > maxBytes) {
          ended = true;
          message.destroy();
          cleanup();
          controller.error(new NetworkError('TOO_LARGE', 'Upstream response is too large'));
          return;
        }
        controller.enqueue(new Uint8Array(chunk));
        // Respect the consumer: pause until `pull` asks for more.
        if ((controller.desiredSize ?? 1) <= 0) message.pause();
      });
      message.on('end', () => {
        if (ended) return;
        ended = true;
        cleanup();
        try {
          controller.close();
        } catch {
          // Already closed by an error path.
        }
      });
      message.on('error', failStream);
      message.on('aborted', failStream);
      message.on('close', () => {
        if (!message.complete) failStream();
      });
    },
    pull() {
      message.resume();
    },
    cancel() {
      ended = true;
      cleanup();
      message.destroy();
    },
  });
}

/**
 * HTTPS fetch with a pinned destination address, no redirect following, a bounded body and a
 * bounded lifetime. The returned `Response` streams, and aborting `init.signal` destroys the
 * socket so a cancelled client request stops the upstream inference immediately.
 */
export async function safeFetch(
  url: string | URL,
  init: SafeFetchInit = {},
  options: NetworkOptions = {},
): Promise<Response> {
  const startedAt = Date.now();
  const destination = await resolveDestination(url, {
    ...options,
    signal: init.signal ?? undefined,
    timeoutMs: init.timeoutMs,
  });
  const signal = init.signal ?? undefined;
  if (signal?.aborted) throw new NetworkError('ABORTED', 'Request was aborted');
  if (Date.now() - startedAt >= (init.timeoutMs ?? DEFAULT_TIMEOUT_MS))
    throw new NetworkError('TIMEOUT', 'Upstream request timed out');

  const maxBytes = init.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
  const timeoutMs = Math.max(1, (init.timeoutMs ?? DEFAULT_TIMEOUT_MS) - (Date.now() - startedAt));
  const transport = options.transport ?? (https.request as Transport);
  const headers = outgoingHeaders(init);

  const isLiteralHost = literalAddress(destination.hostname) !== null;
  const requestOptions: RequestOptions = {
    protocol: 'https:',
    hostname: destination.hostname,
    port: destination.port,
    path: `${destination.url.pathname}${destination.url.search}`,
    method: (init.method ?? 'GET').toUpperCase(),
    headers,
    // Pin: ignore the hostname and always hand Node the address we validated.
    lookup: ((_hostname: string, lookupOptions: unknown, callback: unknown) => {
      const done = callback as (
        error: Error | null,
        address: string | { address: string; family: number }[],
        family?: number,
      ) => void;
      const wantsAll =
        typeof lookupOptions === 'object' && lookupOptions !== null && 'all' in lookupOptions
          ? Boolean((lookupOptions as { all?: boolean }).all)
          : false;
      if (wantsAll) {
        done(null, [{ address: destination.address, family: destination.family }]);
        return;
      }
      done(null, destination.address, destination.family);
    }) as RequestOptions['lookup'],
    // Keep SNI and certificate verification tied to the requested name.
    servername: isLiteralHost ? undefined : destination.hostname,
    rejectUnauthorized: true,
    minVersion: 'TLSv1.2',
  };

  return new Promise<Response>((resolve, rejectPromise) => {
    let settled = false;
    let request: ClientRequest | undefined = undefined;
    let responseMessage: IncomingMessage | undefined;
    let failBody: ((error: Error) => void) | undefined;
    const fail = (error: Error) => {
      if (settled) {
        failBody?.(error);
        responseMessage?.destroy();
        return;
      }
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      request?.destroy();
      rejectPromise(error);
    };
    const timer = setTimeout(
      () => fail(new NetworkError('TIMEOUT', 'Upstream request timed out')),
      timeoutMs,
    );
    const onAbort = () => fail(new NetworkError('ABORTED', 'Request was aborted'));
    signal?.addEventListener('abort', onAbort, { once: true });
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    };

    request = transport(requestOptions, (message) => {
      responseMessage = message;
      const status = message.statusCode ?? 502;
      if (status >= 300 && status < 400) {
        // Following a redirect would re-open the destination check; make it the caller's problem.
        message.resume();
        fail(new NetworkError('REDIRECT', 'Upstream redirects are not followed'));
        return;
      }
      if (settled) {
        message.destroy();
        return;
      }
      settled = true;
      const responseHeaders = new Headers();
      for (const [name, value] of Object.entries(message.headers)) {
        if (value === undefined) continue;
        if (FORBIDDEN_RESPONSE_HEADERS.has(name)) continue;
        responseHeaders.set(name, Array.isArray(value) ? value.join(', ') : value);
      }
      const bodyless = status === 204 || status === 205 || status === 304;
      if (bodyless) {
        message.resume();
        cleanup();
        resolve(new Response(null, { status, headers: responseHeaders }));
        return;
      }
      message.pause();
      resolve(
        new Response(
          responseStream(message, maxBytes, cleanup, (failure) => {
            failBody = failure;
          }),
          {
            status,
            headers: responseHeaders,
          },
        ),
      );
    });

    request.on('error', () => fail(new NetworkError('TRANSPORT', 'Upstream connection failed')));
    void writeBody(request, init.body).catch(() =>
      fail(new NetworkError('TRANSPORT', 'Upstream request body failed')),
    );
  });
}
