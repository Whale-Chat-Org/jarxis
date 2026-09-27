import 'server-only';
import { BrevoClient, BrevoError } from '@getbrevo/brevo';
import { env } from './env';

export type Mail = { to: string; subject: string; text: string };

let brevo: BrevoClient | undefined;

/** Split `Name <email>` (or a bare address) into Brevo's sender shape. */
export function parseSender(from: string): { name?: string; email: string } {
  const match = /^\s*(.*?)\s*<([^<>\s]+)>\s*$/.exec(from);
  if (!match) return { email: from.trim() };
  const name = match[1].replace(/^"(.*)"$/, '$1').trim();
  return name ? { name, email: match[2] } : { email: match[2] };
}

/** Send a plain-text transactional email through the Brevo API. */
export async function sendMail({ to, subject, text }: Mail) {
  const e = env();
  brevo ??= new BrevoClient({
    apiKey: e.BREVO_API_KEY,
    baseUrl: e.BREVO_API_URL,
    timeoutInSeconds: 30,
    maxRetries: 2,
  });
  try {
    await brevo.transactionalEmails.sendTransacEmail({
      sender: parseSender(e.MAIL_FROM),
      to: [{ email: to }],
      subject,
      textContent: text,
    });
  } catch (err) {
    // Never log provider bodies or headers; they can echo request data.
    console.error('Email delivery failed', {
      kind: err instanceof Error ? err.name : 'UnknownError',
      status: err instanceof BrevoError ? err.statusCode : undefined,
    });
    throw new Error('Email delivery failed');
  }
}
