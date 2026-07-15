import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// We mock ./session before importing rest so loadSession returns a stub.
vi.mock('../lib/session.js', () => ({
  loadSession: () => ({ accessToken: 'tok_test', refreshToken: 'rfr', expiresAt: Date.now() + 60_000 }),
}));

import { rest } from '../lib/rest.js';

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  (globalThis as { fetch: unknown }).fetch = fetchMock;
});
afterEach(() => { vi.restoreAllMocks(); });

describe('rest', () => {
  it('attaches the bearer token and parses { data } envelope', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: () => Promise.resolve(JSON.stringify({ data: { ok: 1 } })),
    });
    const out = await rest('GET', '/api/v1/account/');
    expect(out).toEqual({ ok: 1 });
    const [, init] = fetchMock.mock.calls[0]!;
    expect((init as RequestInit).headers).toMatchObject({ Authorization: 'Bearer tok_test' });
  });

  it('throws the server-supplied error message on non-2xx', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 400,
      text: () => Promise.resolve(JSON.stringify({ error: { code: 'X', message: 'bad input' } })),
    });
    await expect(rest('POST', '/api/v1/iam/users', { foo: 1 })).rejects.toThrow('bad input');
  });

  it('returns undefined for 204', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 204, text: () => Promise.resolve('') });
    const out = await rest('DELETE', '/api/v1/iam/users/u1');
    expect(out).toBeUndefined();
  });
});
