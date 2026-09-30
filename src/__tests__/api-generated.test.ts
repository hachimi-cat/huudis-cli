import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';

// Signed in: the token `huudis auth login` stored.
vi.mock('../lib/session.js', () => ({
  loadSession: () => ({ accessToken: 'tok_test', refreshToken: 'rfr', expiresAt: Date.now() + 60_000 }),
}));

import { buildApiCommand, API_ROUTES } from '../commands/api.generated.js';

// `huudis api <area> <action>`: every feature route, generated from the API spec.
function run(args: string[]) {
  const program = new Command();
  program.addCommand(buildApiCommand());
  program.exitOverride();
  return program.parseAsync(['node', 'huudis', ...args]);
}

const fetchMock = vi.fn();
let exits: Array<number | string | null | undefined>;
const spies: Array<{ mockRestore(): void }> = [];

beforeEach(() => {
  exits = [];
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify({ data: { id: 'x' } })) });
  (globalThis as { fetch: unknown }).fetch = fetchMock;
  spies.push(vi.spyOn(console, 'log').mockImplementation(() => {}));
  spies.push(vi.spyOn(console, 'error').mockImplementation(() => {}));
  spies.push(
    vi.spyOn(process, 'exit').mockImplementation(((code?: number | string | null) => {
      exits.push(code);
    }) as never),
  );
});
afterEach(() => {
  while (spies.length) spies.pop()!.mockRestore();
  delete process.env.HUUDIS_API_BASE;
});

describe('huudis api', () => {
  it('has a command for every feature route', () => {
    const count = API_ROUTES.reduce((n, a) => n + a.routes.length, 0);
    expect(count).toBeGreaterThan(105);
    expect(API_ROUTES.map((a) => a.area)).toEqual(expect.arrayContaining(['account', 'iam', 'mfa', 'authz', 'app']));
  });

  it('creates an IAM user from flags, typed as the spec says, with the stored bearer', async () => {
    process.env.HUUDIS_API_BASE = 'https://huudis.test';
    await run(['api', 'iam', 'create-users', '--email', 'rina@example.com', '--role', 'member', '--send-invite-email', 'false']);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://huudis.test/api/v1/iam/users');
    expect((init as RequestInit).method).toBe('POST');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ email: 'rina@example.com', role: 'member', sendInviteEmail: false });
    expect((init as RequestInit).headers).toMatchObject({ Authorization: 'Bearer tok_test' });
    expect(exits).toEqual([]);
  });

  it('refuses a value the spec does not allow, and a missing required field', async () => {
    await run(['api', 'iam', 'create-users', '--email', 'a@b.co', '--role', 'superuser']);
    await run(['api', 'iam', 'create-users', '--name', 'Rina']);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(exits).toEqual([1, 1]);
  });

  it('puts path parameters in the path and query fields in the query', async () => {
    process.env.HUUDIS_API_BASE = 'https://huudis.test';
    await run(['api', 'iam', 'delete-groups-members', 'grp 1', 'usr/2']);
    expect(fetchMock.mock.calls[0]![0]).toBe('https://huudis.test/api/v1/iam/groups/grp%201/members/usr%2F2');
    await run(['api', 'account', 'audit', '--limit', '5', '--outcome', 'denied']);
    const listed = new URL(fetchMock.mock.calls[1]![0] as string);
    expect(listed.pathname).toBe('/api/v1/account/audit');
    expect(Object.fromEntries(listed.searchParams)).toEqual({ limit: '5', outcome: 'denied' });
  });

  it('exits 1 with the server message on an error, like the hand-written commands', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 403,
      text: () => Promise.resolve(JSON.stringify({ error: { code: 'FORBIDDEN', message: 'Not allowed' } })),
    });
    await run(['api', 'account', 'list']);
    expect(exits).toEqual([1]);
  });
});
