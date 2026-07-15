import { Command } from 'commander';
import { loadSession } from '../lib/session.js';

/**
 * `huudis audit ...` — read the audit log. Every policy change, login,
 * assume-role, and social link event is captured. Use `--event`, `--since`,
 * `--limit` to filter.
 */

function baseUrl(): string {
  return process.env.HUUDIS_API_BASE ?? 'https://huudis.com';
}

function bearer(): string {
  const session = loadSession();
  if (!session) {
    console.error("Not signed in. Run 'huudis auth login' first.");
    process.exit(1);
  }
  return session.accessToken;
}

async function api(method: string, path: string, body?: unknown): Promise<unknown> {
  const res = await fetch(`${baseUrl()}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer()}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed: any = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
  if (!res.ok) {
    const msg = parsed?.error?.message ?? parsed?.error ?? `HTTP ${res.status}`;
    throw new Error(String(msg));
  }
  return parsed;
}

export const audit = new Command('audit').description('Read the audit log.');

audit
  .command('list')
  .description('List audit events, most recent first.')
  .option('--event <type>', 'filter by event type (e.g. iam.access_key.create, auth.social.login)')
  .option('--since <iso>', 'only show events after this ISO timestamp')
  .option('--limit <n>', 'max rows', '50')
  .option('--json', 'print raw JSON instead of a table')
  .action(async (opts) => {
    try {
      const q = new URLSearchParams();
      if (opts.event) q.set('event', opts.event);
      if (opts.since) q.set('since', opts.since);
      q.set('limit', String(opts.limit));
      const out = await api('GET', `/api/v1/account/audit?${q.toString()}`);
      const rows = ((out as any)?.data ?? []) as Array<{ id: string; eventType: string; outcome: string; createdAt: string; ipAddress: string | null; metadata: Record<string, unknown> }>;
      if (opts.json) {
        console.log(JSON.stringify(rows, null, 2));
        return;
      }
      if (rows.length === 0) { console.log('(no matching audit events)'); return; }
      for (const r of rows) {
        const t = r.createdAt?.slice(0, 19).replace('T', ' ') ?? '?';
        const outcome = r.outcome === 'success' ? 'ok' : 'FAIL';
        console.log(`${t}  ${r.eventType.padEnd(32)}  ${outcome.padEnd(4)}  ip=${r.ipAddress ?? '?'}`);
      }
    } catch (e) {
      console.error(String((e as Error).message));
      process.exit(1);
    }
  });
