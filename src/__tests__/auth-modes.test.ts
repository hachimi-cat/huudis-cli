import { createHash, createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';

// Signed in too — the access key and the client credentials must still win where they apply.
vi.mock('../lib/session.js', () => ({
  loadSession: () => ({ accessToken: 'tok_test', refreshToken: 'rfr', expiresAt: Date.now() + 60_000 }),
}));

import { buildApiCommand } from '../commands/api.generated.js';

const KEY_ID = 'AKIA0123456789ABCDEF01234567';
const SECRET = 'c2VjcmV0LXNlY3JldC1zZWNyZXQtc2VjcmV0LTAxMjM=';

function run(args: string[]) {
  const program = new Command();
  program.addCommand(buildApiCommand());
  program.exitOverride();
  return program.parseAsync(['node', 'huudis', ...args]);
}

/** What the Huudis server computes (backend/src/services/iam-access-keys.ts), restated. */
function expected(method: string, pathWithQuery: string, date: string, body = ''): string {
  const bodyHash = createHash('sha256').update(body).digest('hex');
  return createHmac('sha256', SECRET).update(`${method}\n${pathWithQuery}\n${date}\n${bodyHash}`).digest('hex');
}

const fetchMock = vi.fn();
let exits: Array<number | string | null | undefined>;
let errors: string[];
const spies: Array<{ mockRestore(): void }> = [];
const ENV = ['HUUDIS_API_BASE', 'HUUDIS_ACCESS_KEY_ID', 'HUUDIS_SECRET_ACCESS_KEY', 'HUUDIS_CLIENT_ID', 'HUUDIS_CLIENT_SECRET', 'HUUDIS_WORKSPACE_ID'];

beforeEach(() => {
  exits = [];
  errors = [];
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify({ data: { id: 'x' } })) });
  (globalThis as { fetch: unknown }).fetch = fetchMock;
  process.env.HUUDIS_API_BASE = 'https://huudis.test';
  spies.push(vi.spyOn(console, 'log').mockImplementation(() => {}));
  spies.push(vi.spyOn(console, 'error').mockImplementation((m: unknown) => { errors.push(String(m)); }));
  spies.push(vi.spyOn(process, 'exit').mockImplementation(((code?: number | string | null) => { exits.push(code); }) as never));
});
afterEach(() => {
  while (spies.length) spies.pop()!.mockRestore();
  for (const k of ENV) delete process.env[k];
});

describe('huudis api — credentials by route group', () => {
  it('signs with the access key from the environment (method, path with query, date, body)', async () => {
    process.env.HUUDIS_ACCESS_KEY_ID = KEY_ID;
    process.env.HUUDIS_SECRET_ACCESS_KEY = SECRET;
    process.env.HUUDIS_WORKSPACE_ID = 'acc_123';
    await run(['api', 'iam', 'create-groups', '--name', 'Ops']);
    await run(['api', 'account', 'audit', '--limit', '5']);

    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    const date = headers['X-Huudis-Date']!;
    expect(url).toBe('https://huudis.test/api/v1/iam/groups');
    expect(headers['X-Huudis-Workspace-Id']).toBe('acc_123');
    expect(headers.Authorization).toBe(
      `Huudis-HMAC-SHA256 Credential=${KEY_ID}, Signature=${expected('POST', '/api/v1/iam/groups', date, init.body as string)}`,
    );

    const [url2, init2] = fetchMock.mock.calls[1]! as [string, RequestInit];
    const h2 = init2.headers as Record<string, string>;
    const u = new URL(url2);
    expect(h2.Authorization).toContain(expected('GET', `${u.pathname}${u.search}`, h2['X-Huudis-Date']!));
    expect(exits).toEqual([]);
  });

  it('uses the stored sign-in when no access key is set', async () => {
    await run(['api', 'iam', 'users']);
    const [, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok_test');
  });

  it('`api app …` authenticates as the OIDC app', async () => {
    process.env.HUUDIS_CLIENT_ID = 'oc_app';
    process.env.HUUDIS_CLIENT_SECRET = 's3cret';
    process.env.HUUDIS_ACCESS_KEY_ID = KEY_ID;
    process.env.HUUDIS_SECRET_ACCESS_KEY = SECRET;
    await run(['api', 'app', 'users', '--status', 'active']);
    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe('https://huudis.test/api/v1/app/users?status=active');
    expect((init.headers as Record<string, string>).Authorization).toBe(`Basic ${Buffer.from('oc_app:s3cret').toString('base64')}`);
  });

  it('`api app …` without client credentials exits 1 and says what to set', async () => {
    await run(['api', 'app', 'users']);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(exits).toEqual([1]);
    expect(errors.join('\n')).toContain('HUUDIS_CLIENT_SECRET');
  });
});

describe('huudis --version', () => {
  it('is the package version', async () => {
    const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string };
    const src = readFileSync(new URL('../index.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/\.version\('\d/);
    expect(src).toContain("new URL('../package.json', import.meta.url)");
    expect(pkg.version).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
