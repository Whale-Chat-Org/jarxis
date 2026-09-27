import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { sendTransacEmail, BrevoClient } = vi.hoisted(() => {
  const sendTransacEmail = vi.fn();
  return {
    sendTransacEmail,
    BrevoClient: vi.fn(function () {
      return { transactionalEmails: { sendTransacEmail } };
    }),
  };
});
vi.mock('@getbrevo/brevo', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@getbrevo/brevo')>()),
  BrevoClient,
}));

const base = {
  DATABASE_URL: 'postgresql://test:test@localhost:5432/jarxis_test',
  REDIS_URL: 'redis://localhost:6379',
  BETTER_AUTH_URL: 'http://localhost:3000',
  BETTER_AUTH_SECRET: 'a'.repeat(64),
  JWT_SECRET: 'b'.repeat(64),
  BREVO_API_KEY: 'xkeysib-test',
  MAIL_FROM: 'Jarxis <noreply@example.com>',
};
const mail = { to: 'user@example.com', subject: 'Verify', text: 'Verify\n\nhttps://x' };

// env() and the mailer cache their state, so load fresh modules per configuration.
async function load(vars: Record<string, string | undefined> = {}) {
  for (const [k, v] of Object.entries({ ...base, BREVO_API_URL: undefined, ...vars }))
    vi.stubEnv(k, v);
  vi.resetModules();
  return {
    ...(await import('@/lib/mailer')),
    ...(await import('@/lib/env')),
    brevo: await import('@getbrevo/brevo'),
  };
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('mailer', () => {
  it('sends a plain-text email through Brevo', async () => {
    const { sendMail } = await load();
    await sendMail(mail);
    expect(BrevoClient).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: 'xkeysib-test', baseUrl: undefined }),
    );
    expect(sendTransacEmail).toHaveBeenCalledWith({
      sender: { name: 'Jarxis', email: 'noreply@example.com' },
      to: [{ email: 'user@example.com' }],
      subject: 'Verify',
      textContent: mail.text,
    });
  });

  it('honours the test-only API base URL override', async () => {
    const { sendMail } = await load({ BREVO_API_URL: 'http://127.0.0.1:4010' });
    await sendMail(mail);
    expect(BrevoClient).toHaveBeenCalledWith(
      expect.objectContaining({ baseUrl: 'http://127.0.0.1:4010' }),
    );
  });

  it('parses named and bare sender addresses', async () => {
    const { parseSender } = await load();
    expect(parseSender('Jarxis <noreply@example.com>')).toEqual({
      name: 'Jarxis',
      email: 'noreply@example.com',
    });
    expect(parseSender('"Jarxis Team" <team@example.com>')).toEqual({
      name: 'Jarxis Team',
      email: 'team@example.com',
    });
    expect(parseSender('<noreply@example.com>')).toEqual({ email: 'noreply@example.com' });
    expect(parseSender(' noreply@example.com ')).toEqual({ email: 'noreply@example.com' });
  });

  it('hides provider errors behind a generic failure', async () => {
    const { sendMail, brevo } = await load({ BREVO_API_KEY: 'xkeysib-secret' });
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    sendTransacEmail.mockRejectedValueOnce(
      new brevo.Brevo.UnauthorizedError({ message: 'Key not found', code: 'unauthorized' }),
    );
    await expect(sendMail(mail)).rejects.toThrow(new Error('Email delivery failed'));
    expect(log).toHaveBeenCalledWith('Email delivery failed', {
      kind: 'UnauthorizedError',
      status: 401,
    });
    const logged = JSON.stringify(log.mock.calls);
    expect(logged).not.toContain('xkeysib-secret');
    expect(logged).not.toContain('Key not found');
  });
});

describe('mail environment', () => {
  it('requires a Brevo API key and sender', async () => {
    const noKey = await load({ BREVO_API_KEY: undefined });
    expect(() => noKey.env()).toThrow(/BREVO_API_KEY/);
    const noSender = await load({ MAIL_FROM: undefined });
    expect(() => noSender.env()).toThrow(/MAIL_FROM/);
  });

  it('accepts a complete configuration', async () => {
    expect((await load()).env().BREVO_API_KEY).toBe('xkeysib-test');
  });
});
