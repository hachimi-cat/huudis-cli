import { loadSession } from './session.js';

/**
 * Thin REST helper used by every command group that hits a dashboard-
 * style route (the OIDC protocol endpoints live in ./api.ts). Loads the
 * stored bearer token, unwraps the `{ data, error, meta }` envelope,
 * throws a helpful error on non-2xx.
 */

export function baseUrl(): string {
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

export async function rest<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${baseUrl()}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${bearer()}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let parsed: { data?: T; error?: { code?: string; message?: string } } | null = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
  if (!res.ok) {
    const msg = parsed?.error?.message ?? parsed?.error ?? `HTTP ${res.status}`;
    throw new Error(String(msg));
  }
  return (parsed?.data ?? parsed) as T;
}

/** Print as indented JSON. */
export function printJson(x: unknown): void {
  console.log(JSON.stringify(x, null, 2));
}

/** Wrap an async action so thrown errors exit non-zero with a clean message. */
export function wrap<A extends unknown[]>(fn: (...args: A) => Promise<void>): (...args: A) => Promise<void> {
  return async (...args: A) => {
    try { await fn(...args); } catch (e) {
      console.error(String((e as Error).message));
      process.exit(1);
    }
  };
}
