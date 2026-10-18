import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Unit coverage for the first-owner bootstrap form. `fetch` and the router are mocked, so no
 * request leaves the test and no account is created. Only the request handle may reach
 * `sessionStorage`; the password and the code never do.
 */

const { replace } = vi.hoisted(() => ({ replace: vi.fn() }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/setup',
}));

import { OwnerSetup } from '@/components/setup/owner-setup';

const STORAGE_KEY = 'jarxis.owner-setup.request';
const PASSWORD = 'correct-horse-battery';

const fetchMock = vi.fn<typeof fetch>();

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function handle(overrides: Record<string, unknown> = {}) {
  return {
    requestId: 'req-1',
    email: 'owner@jarxis.test',
    expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
    resendAvailableAt: new Date(Date.now() - 1000).toISOString(),
    deliverySent: true,
    ...overrides,
  };
}

function storeHandle(overrides: Record<string, unknown> = {}) {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(handle(overrides)));
}

async function fillDetails(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('Name'), '  Owner  ');
  await user.type(screen.getByLabelText('Email'), ' owner@jarxis.test ');
  await user.type(screen.getByLabelText('Password'), PASSWORD);
}

function submitDetails(user: ReturnType<typeof userEvent.setup>) {
  return user.click(screen.getByRole('button', { name: 'Email me a code' }));
}

async function enterCode(user: ReturnType<typeof userEvent.setup>, code = '123456') {
  await user.type(screen.getByLabelText('Owner code'), code);
  await user.click(screen.getByRole('button', { name: 'Verify and create owner' }));
}

beforeEach(() => {
  sessionStorage.clear();
  fetchMock.mockReset();
  replace.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('OwnerSetup details step', () => {
  it('renders the first-owner form', () => {
    render(<OwnerSetup />);
    expect(screen.getByRole('heading', { name: 'Create the first owner' })).toBeTruthy();
    expect(screen.getByLabelText('Password').getAttribute('type')).toBe('password');
  });

  it('shows client validation messages and does not post invalid details', async () => {
    const user = userEvent.setup();
    render(<OwnerSetup />);
    await user.type(screen.getByLabelText('Name'), 'a');
    await user.clear(screen.getByLabelText('Name'));
    await user.type(screen.getByLabelText('Email'), 'nope');
    await user.type(screen.getByLabelText('Password'), 'short');
    await user.tab();
    await submitDetails(user);

    expect(await screen.findByText('Name is required.')).toBeTruthy();
    expect(screen.getByText('Enter a valid email address.')).toBeTruthy();
    expect(screen.getByText('Password must be at least 12 characters.')).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('posts trimmed details, stores only the handle and moves to the code step', async () => {
    fetchMock.mockResolvedValueOnce(json(202, handle()));
    const user = userEvent.setup();
    render(<OwnerSetup />);
    await fillDetails(user);
    await submitDetails(user);

    expect(await screen.findByRole('heading', { name: 'Enter your owner code' })).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith('/api/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Owner', email: 'owner@jarxis.test', password: PASSWORD }),
    });
    expect(screen.getByText(/We emailed a six-digit code to owner@jarxis.test/)).toBeTruthy();
    expect(
      screen.getByText(/Code sent — check your email. It expires in \d+m \d{2}s\./),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Resend code' })).toBeTruthy();

    const stored = sessionStorage.getItem(STORAGE_KEY) ?? '';
    expect(JSON.parse(stored)).toMatchObject({ requestId: 'req-1', deliverySent: true });
    expect(stored).not.toContain(PASSWORD);
  });

  it('reports an unreachable setup endpoint', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('offline'));
    const user = userEvent.setup();
    render(<OwnerSetup />);
    await fillDetails(user);
    await submitDetails(user);

    expect(await screen.findByText('Setup could not be reached. Try again.')).toBeTruthy();
    expect((screen.getByLabelText('Password') as HTMLInputElement).value).toBe(
      'correct-horse-battery',
    );
  });

  it('maps an allowlisted error code and preserves the password', async () => {
    fetchMock.mockResolvedValueOnce(
      json(409, { error: { code: 'EMAIL_CONFLICT', message: '<b>raw</b>' } }),
    );
    const user = userEvent.setup();
    render(<OwnerSetup />);
    await fillDetails(user);
    await submitDetails(user);

    expect(
      await screen.findByText(
        'An account with this email already exists. Use another email address.',
      ),
    ).toBeTruthy();
    expect(screen.queryByText('<b>raw</b>')).toBeNull();
    expect((screen.getByLabelText('Password') as HTMLInputElement).value).toBe(
      'correct-horse-battery',
    );
  });

  it('falls back to generic copy when the error body is not JSON', async () => {
    fetchMock.mockResolvedValueOnce(new Response('boom', { status: 500 }));
    const user = userEvent.setup();
    render(<OwnerSetup />);
    await fillDetails(user);
    await submitDetails(user);

    expect(await screen.findByText('Setup failed. Check the details and try again.')).toBeTruthy();
  });

  it('closes the form when setup is already completed', async () => {
    storeHandle();
    sessionStorage.setItem(STORAGE_KEY, 'not json');
    fetchMock.mockResolvedValueOnce(json(409, { error: { code: 'SETUP_COMPLETED' } }));
    const user = userEvent.setup();
    render(<OwnerSetup />);
    await fillDetails(user);
    await submitDetails(user);

    expect(await screen.findByRole('heading', { name: 'Setup already completed' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Go to sign-in' }).getAttribute('href')).toBe(
      '/auth/sign-in',
    );
    expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('rejects an unexpected success payload', async () => {
    fetchMock.mockResolvedValueOnce(json(202, { requestId: 'req-1' }));
    const user = userEvent.setup();
    render(<OwnerSetup />);
    await fillDetails(user);
    await submitDetails(user);

    expect(await screen.findByText('Setup returned an unexpected response.')).toBeTruthy();
    expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('keeps working when sessionStorage writes are blocked', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    fetchMock.mockResolvedValueOnce(json(202, handle({ deliverySent: false })));
    const user = userEvent.setup();
    render(<OwnerSetup />);
    await fillDetails(user);
    await submitDetails(user);

    expect(
      await screen.findByText(/We could not deliver the email to owner@jarxis.test/),
    ).toBeTruthy();
    expect(screen.getByText(/Email delivery failed\. Resend once the cooldown ends/)).toBeTruthy();
  });
});

describe('OwnerSetup stored request', () => {
  it.each([
    ['a non-object', '42'],
    ['a missing field', JSON.stringify({ requestId: 'r', email: 'e', expiresAt: 'x' })],
    ['invalid JSON', '{'],
  ])('ignores %s in storage', (_label, raw) => {
    sessionStorage.setItem(STORAGE_KEY, raw);
    render(<OwnerSetup />);
    expect(screen.getByRole('heading', { name: 'Create the first owner' })).toBeTruthy();
  });

  it('resumes the code step with a live cooldown', () => {
    storeHandle({
      deliverySent: 'unknown',
      resendAvailableAt: new Date(Date.now() + 90_000).toISOString(),
    });
    render(<OwnerSetup />);

    expect(screen.getByRole('heading', { name: 'Enter your owner code' })).toBeTruthy();
    const resend = screen.getByRole('button', { name: /Resend code in 1m \d{2}s/ });
    expect((resend as HTMLButtonElement).disabled).toBe(true);
    // A resumed request is not the initial send.
    expect(
      screen.getByText(/This code expires in \d+m \d{2}s\. Resending invalidates/),
    ).toBeTruthy();
  });

  it('ticks the countdown every second', () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    try {
      storeHandle({ resendAvailableAt: new Date(Date.now() + 5_000).toISOString() });
      render(<OwnerSetup />);
      expect(screen.getByRole('button', { name: 'Resend code in 5s' })).toBeTruthy();
      act(() => {
        vi.advanceTimersByTime(2_000);
      });
      expect(screen.getByRole('button', { name: 'Resend code in 3s' })).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports an expired code and treats a bad timestamp as elapsed', () => {
    storeHandle({ expiresAt: 'not-a-date', resendAvailableAt: 'also-bad' });
    render(<OwnerSetup />);
    expect(screen.getByText('That code has expired. Resend to get a new one.')).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: 'Resend code' }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });
});

describe('OwnerSetup code step', () => {
  it('validates the code format before posting', async () => {
    storeHandle();
    const user = userEvent.setup();
    render(<OwnerSetup />);
    await enterCode(user, '12a456');
    expect(await screen.findByText('The code is 6 digits, 0-9.')).toBeTruthy();
    await user.clear(screen.getByLabelText('Owner code'));
    await user.type(screen.getByLabelText('Owner code'), '123');
    expect(await screen.findByText('The code is exactly 6 digits.')).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('verifies the code, clears the handle and redirects to sign-in', async () => {
    storeHandle();
    fetchMock.mockResolvedValueOnce(json(201, { ok: true }));
    const user = userEvent.setup();
    render(<OwnerSetup />);
    await enterCode(user, '123456');

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/auth/sign-in'));
    expect(fetchMock).toHaveBeenCalledWith('/api/setup/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestId: 'req-1', code: '123456' }),
    });
    expect(screen.getByText('Owner created. Redirecting to sign-in…')).toBeTruthy();
    expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(
      (screen.getByRole('button', { name: 'Resend code' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('reports an unreachable verification endpoint', async () => {
    storeHandle();
    fetchMock.mockRejectedValueOnce(new TypeError('offline'));
    const user = userEvent.setup();
    render(<OwnerSetup />);
    await enterCode(user);
    expect(await screen.findByText('Verification could not be reached. Try again.')).toBeTruthy();
  });

  it('shows allowlisted copy for a rejected code and clears the input', async () => {
    storeHandle();
    fetchMock.mockResolvedValueOnce(json(400, { error: { code: 'CODE_INVALID' } }));
    const user = userEvent.setup();
    render(<OwnerSetup />);
    await enterCode(user);
    expect(
      await screen.findByText('That code is not valid. Check the email and try again.'),
    ).toBeTruthy();
    expect((screen.getByLabelText('Owner code') as HTMLInputElement).value).toBe('');
    expect(replace).not.toHaveBeenCalled();
  });

  it('uses the fallback for an unknown verification error', async () => {
    storeHandle();
    fetchMock.mockResolvedValueOnce(json(500, { code: 'WHATEVER' }));
    const user = userEvent.setup();
    render(<OwnerSetup />);
    await enterCode(user);
    expect(
      await screen.findByText('That code was not accepted. Request a new one and try again.'),
    ).toBeTruthy();
  });

  it('closes when verification finds setup already completed', async () => {
    storeHandle();
    fetchMock.mockResolvedValueOnce(json(409, { error: { code: 'SETUP_COMPLETED' } }));
    const user = userEvent.setup();
    render(<OwnerSetup />);
    await enterCode(user);
    expect(await screen.findByRole('heading', { name: 'Setup already completed' })).toBeTruthy();
    expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});

describe('OwnerSetup resend', () => {
  function clickResend(user: ReturnType<typeof userEvent.setup>) {
    return user.click(screen.getByRole('button', { name: 'Resend code' }));
  }

  it('issues a new code and replaces the stored handle', async () => {
    storeHandle();
    const next = handle({
      requestId: 'req-2',
      resendAvailableAt: new Date(Date.now() + 60_000).toISOString(),
    });
    let resolve: (value: Response) => void = () => {};
    fetchMock.mockReturnValueOnce(new Promise<Response>((r) => (resolve = r)));
    const user = userEvent.setup();
    render(<OwnerSetup />);
    await clickResend(user);

    const pending = screen.getByRole('button', { name: 'Sending a new code…' });
    expect((pending as HTMLButtonElement).disabled).toBe(true);
    await act(async () => resolve(json(202, next)));

    expect(
      await screen.findByText('A new code is on its way. The previous code no longer works.'),
    ).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith('/api/setup/resend', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestId: 'req-1' }),
    });
    expect(JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? '{}').requestId).toBe('req-2');
    expect(screen.getByRole('button', { name: /Resend code in/ })).toBeTruthy();
  });

  it('reports a resend the provider rejected', async () => {
    storeHandle();
    fetchMock.mockResolvedValueOnce(json(202, handle({ deliverySent: false })));
    const user = userEvent.setup();
    render(<OwnerSetup />);
    await clickResend(user);
    expect(
      await screen.findByText(
        'A new code was issued, but the email provider rejected it. The previous code no longer works.',
      ),
    ).toBeTruthy();
  });

  it('reports an unreachable resend endpoint', async () => {
    storeHandle();
    fetchMock.mockRejectedValueOnce(new TypeError('offline'));
    const user = userEvent.setup();
    render(<OwnerSetup />);
    await clickResend(user);
    expect(await screen.findByText('The resend could not be reached. Try again.')).toBeTruthy();
  });

  it('maps a resend cooldown error', async () => {
    storeHandle();
    fetchMock.mockResolvedValueOnce(json(429, { error: { code: 'RESEND_COOLDOWN' } }));
    const user = userEvent.setup();
    render(<OwnerSetup />);
    await clickResend(user);
    expect(
      await screen.findByText('Please wait for the countdown before requesting another code.'),
    ).toBeTruthy();
  });

  it('uses the fallback for an unknown resend error', async () => {
    storeHandle();
    fetchMock.mockResolvedValueOnce(json(500, null));
    const user = userEvent.setup();
    render(<OwnerSetup />);
    await clickResend(user);
    expect(
      await screen.findByText('The code could not be resent. Try again shortly.'),
    ).toBeTruthy();
  });

  it('rejects an unexpected resend payload', async () => {
    storeHandle();
    fetchMock.mockResolvedValueOnce(json(202, 'nope'));
    const user = userEvent.setup();
    render(<OwnerSetup />);
    await clickResend(user);
    expect(await screen.findByText('The resend returned an unexpected response.')).toBeTruthy();
  });

  it('closes when the resend finds setup already completed', async () => {
    storeHandle();
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    fetchMock.mockResolvedValueOnce(json(409, { error: { code: 'SETUP_COMPLETED' } }));
    const user = userEvent.setup();
    render(<OwnerSetup />);
    await clickResend(user);
    expect(await screen.findByRole('heading', { name: 'Setup already completed' })).toBeTruthy();
  });
});
