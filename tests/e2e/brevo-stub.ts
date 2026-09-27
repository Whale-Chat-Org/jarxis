/**
 * Local stand-in for Brevo's transactional email API, used only by the acceptance suite.
 * The test app points BREVO_API_URL here so no real mail is sent; tests read captured mail back.
 */
import { randomUUID } from 'node:crypto';
import { createServer, type ServerResponse } from 'node:http';

type Captured = { id: string; to: string[]; subject: string; text: string; html: string };
const messages: Captured[] = [];
const MAX_MESSAGES = 1_000;
const MAX_BODY = 1_000_000;
const url = new URL(process.env.BREVO_STUB_URL ?? 'http://127.0.0.1:4010');

const json = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};

createServer((req, res) => {
  const { pathname, searchParams } = new URL(req.url ?? '/', url);
  if (req.method === 'GET' && pathname === '/') return json(res, 200, { ok: true });
  if (req.method === 'GET' && pathname === '/messages') {
    const to = searchParams.get('to')?.toLowerCase();
    return json(res, 200, { messages: messages.filter((m) => !to || m.to.includes(to)) });
  }
  if (req.method !== 'POST' || pathname !== '/smtp/email') return json(res, 404, {});
  if (!req.headers['api-key'])
    return json(res, 401, { code: 'unauthorized', message: 'Key not found' });
  let raw = '';
  req.on('data', (chunk: Buffer) => {
    raw += chunk;
    if (raw.length > MAX_BODY) req.destroy();
  });
  req.on('end', () => {
    try {
      const body = JSON.parse(raw);
      const to = (body.to ?? []).map((r: { email?: string }) => String(r.email).toLowerCase());
      if (
        !body.sender?.email ||
        !to.length ||
        !body.subject ||
        !(body.textContent || body.htmlContent)
      )
        return json(res, 400, { code: 'missing_parameter', message: 'Invalid email payload' });
      const id = `<${randomUUID()}@brevo-stub>`;
      messages.push({
        id,
        to,
        subject: body.subject,
        text: body.textContent ?? '',
        html: body.htmlContent ?? '',
      });
      if (messages.length > MAX_MESSAGES) messages.shift();
      json(res, 201, { messageId: id });
    } catch {
      json(res, 400, { code: 'bad_request', message: 'Invalid JSON' });
    }
  });
}).listen(Number(url.port), url.hostname, () => {
  console.log(`Brevo stub listening on ${url.origin}`);
});
