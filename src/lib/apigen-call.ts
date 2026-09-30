/**
 * How the generated `huudis api <area> <action>` commands (commands/api.generated.ts)
 * make their call: this CLI's own credentials and client (rest(): the credential each
 * route group takes — the token `huudis auth login` stored or an access key from
 * HUUDIS_ACCESS_KEY_ID/HUUDIS_SECRET_ACCESS_KEY, and for `api app …` the OIDC client
 * credentials from HUUDIS_CLIENT_ID/HUUDIS_CLIENT_SECRET; HUUDIS_API_BASE), its own
 * output and errors.
 */
import type { Command } from 'commander';
import { rest, printJson } from './rest.js';

export async function callRoute(
  _cmd: Command,
  method: string,
  path: string,
  query: Record<string, unknown>,
  body: Record<string, unknown> | undefined,
): Promise<void> {
  try {
    const qs = new URLSearchParams(
      Object.entries(query).map(([k, v]): [string, string] => [k, typeof v === 'string' ? v : JSON.stringify(v)]),
    ).toString();
    const data = await rest<unknown>(method, qs ? `${path}?${qs}` : path, body);
    printJson(data ?? { ok: true });
  } catch (e) {
    fail(e);
  }
}

/** Bad input to a generated command (a missing field, a value the spec does not allow). */
export async function failRoute(_cmd: Command, err: unknown): Promise<never> {
  fail(err);
}

// The same error output and exit code as the hand-written commands (lib/rest.ts wrap).
function fail(e: unknown): never {
  console.error(String((e as Error)?.message ?? e));
  process.exit(1);
}
