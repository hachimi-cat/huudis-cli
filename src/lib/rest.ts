import { loadSession } from './session.js';
import { signRequest } from './signing.js';

/**
 * Thin REST helper used by every command group that hits a dashboard-
 * style route (the OIDC protocol endpoints live in ./api.ts). Picks the
 * credential the route takes, unwraps the `{ data, error, meta }`
 * envelope, throws a helpful error on non-2xx.
 *
 * Credentials, by route:
 *   - /api/v1/app/*: your OIDC app's client credentials, from
 *     HUUDIS_CLIENT_ID + HUUDIS_CLIENT_SECRET (HTTP Basic).
 *   - everything else: an IAM access key when HUUDIS_ACCESS_KEY_ID +
 *     HUUDIS_SECRET_ACCESS_KEY are set (each request signed with
 *     Huudis-HMAC-SHA256, acting as the key's user within its policies),
 *     else the token `huudis auth login` stored.
 * HUUDIS_WORKSPACE_ID names the workspace to act in.
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

function clientCredentials(): string {
  const id = process.env.HUUDIS_CLIENT_ID;
  const secret = process.env.HUUDIS_CLIENT_SECRET;
  if (!id || !secret) {
    throw new Error(
      '/api/v1/app/* authenticates as your OIDC app: set HUUDIS_CLIENT_ID and HUUDIS_CLIENT_SECRET (its client credentials).',
    );
  }
  return `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`;
}

function accessKey(): { accessKeyId: string; secretAccessKey: string } | null {
  const accessKeyId = process.env.HUUDIS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.HUUDIS_SECRET_ACCESS_KEY;
  return accessKeyId && secretAccessKey ? { accessKeyId, secretAccessKey } : null;
}

/** The auth headers for one request: the credential its route group takes. */
function authHeaders(method: string, url: string, path: string, payload: string | undefined): Record<string, string> {
  if (/^\/api\/v1\/app(\/|\?|$)/.test(path)) return { Authorization: clientCredentials() };
  const key = accessKey();
  if (key) return signRequest(key, { method, url, body: payload });
  return { Authorization: `Bearer ${bearer()}` };
}

export async function rest<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
  const url = `${baseUrl()}${path}`;
  const payload = body ? JSON.stringify(body) : undefined;
  const workspace = process.env.HUUDIS_WORKSPACE_ID;
  const res = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(method, url, path, payload),
      ...(workspace ? { 'X-Huudis-Workspace-Id': workspace } : {}),
    },
    body: payload,
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
