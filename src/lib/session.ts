import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * On-disk session store for the Huudis CLI.
 *
 * Lives at ~/.huudis/session.json with 0600 permissions. Holds the
 * bearer tokens so subsequent `huudis ...` invocations don't re-prompt.
 */

export interface StoredSession {
  accessToken: string;
  refreshToken: string;
  idToken: string;
  accessTokenExpiresAt: string; // ISO
  scope: string;
  issuer: string;
  clientId: string;
}

function sessionPath(): string {
  return path.join(os.homedir(), '.huudis', 'session.json');
}

export function saveSession(s: StoredSession): void {
  const file = sessionPath();
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, JSON.stringify(s, null, 2), { mode: 0o600 });
}

export function loadSession(): StoredSession | null {
  const file = sessionPath();
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as StoredSession;
  } catch {
    return null;
  }
}

export function clearSession(): void {
  const file = sessionPath();
  if (fs.existsSync(file)) fs.unlinkSync(file);
}

export function isAccessTokenStale(s: StoredSession): boolean {
  // Treat "stale" as <60s until expiry — gives the refresh call headroom.
  return new Date(s.accessTokenExpiresAt).getTime() - Date.now() < 60_000;
}
