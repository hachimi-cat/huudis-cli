import { Command } from 'commander';
import { loadSession } from '../lib/session.js';

/**
 * `huudis account ...` — inspect the current identity, manage sessions, view
 * linked social providers. Authenticates with the Bearer access token stored
 * by `huudis login`.
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

/**
 * Prompt the TTY for a hidden value with echo suppressed via raw mode. Refuses
 * a non-interactive stdin so a password never ends up in shell history or log
 * scrapes — callers must use the explicit flag in that case.
 */
function promptSecret(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    if (!stdin.isTTY) {
      reject(new Error('Refusing to read a password from a non-interactive stdin. Pass the value via the appropriate flag instead.'));
      return;
    }
    process.stdout.write(prompt);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    let buf = '';
    const ETX = String.fromCharCode(3);   // Ctrl-C
    const BS = String.fromCharCode(8);    // backspace
    const DEL = String.fromCharCode(127); // delete
    const cleanup = () => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener('data', onData);
      process.stdout.write('\n');
    };
    const onData = (chunk: string) => {
      for (const c of chunk) {
        if (c === '\n' || c === '\r') { cleanup(); resolve(buf); return; }
        if (c === ETX)               { cleanup(); reject(new Error('Aborted.')); return; }
        if (c === BS || c === DEL)   { buf = buf.slice(0, -1); continue; }
        buf += c;
      }
    };
    stdin.on('data', onData);
  });
}

export const account = new Command('account').description('Manage the current Huudis account — profile, sessions, linked providers.');

// ─── whoami ───────────────────────────────────────────────────────────────

account
  .command('whoami')
  .description('Show the current identity, MFA status, and linked social providers.')
  .option('--json', 'print raw JSON instead of a summary')
  .action(async (opts) => {
    try {
      const me = (await api('GET', '/api/v1/account/') as any)?.data ?? {};
      const linked = (await api('GET', '/api/v1/account/linked-accounts') as any)?.data ?? [];
      if (opts.json) {
        console.log(JSON.stringify({ ...me, linkedAccounts: linked }, null, 2));
        return;
      }
      console.log(`user:     ${me.id ?? '?'}`);
      console.log(`email:    ${me.email ?? '?'}${me.emailVerified ? ' (verified)' : ' (unverified)'}`);
      console.log(`name:     ${me.name ?? '(unset)'}`);
      console.log(`locale:   ${me.locale ?? 'en-ID'}`);
      console.log(`mfa:      ${me.mfaDevices?.length > 0 ? `${me.mfaDevices.length} device(s)` : 'not set up'}`);
      if (linked.length) {
        console.log('linked:');
        for (const l of linked) {
          console.log(`  ${l.provider.padEnd(10)} ${l.email ?? ''}  (linked ${l.linkedAt?.slice(0, 10) ?? '?'})`);
        }
      } else {
        console.log('linked:   none');
      }
    } catch (e) {
      console.error(String((e as Error).message));
      process.exit(1);
    }
  });

// ─── change-email ─────────────────────────────────────────────────────────

account
  .command('change-email')
  .description('Request an email change. Sends a verification link to the new address; the change does not take effect until verified.')
  .requiredOption('--new <email>', 'the new email address')
  .option('--password <password>', 'current account password (prompted on TTY if omitted)')
  .action(async (opts: { new: string; password?: string }) => {
    try {
      let password = opts.password;
      if (!password) {
        password = await promptSecret('Current password: ');
      }
      // Backend route POST /account/email-change accepts { email, password }.
      const out = await api('POST', '/api/v1/account/email-change', {
        email: opts.new,
        password,
      });
      const data = (out as any)?.data ?? {};
      console.log(`Email change requested for ${data.newEmail ?? opts.new}.`);
      console.log('Check the new address for a verification link. The change is not active until you verify.');
    } catch (e) {
      console.error(String((e as Error).message));
      process.exit(1);
    }
  });

// ─── change-password ──────────────────────────────────────────────────────

account
  .command('change-password')
  .description('Change the account password. Other sessions are signed out; this session is kept.')
  .option('--current <password>', 'current password (prompted on TTY if omitted)')
  .option('--new <password>', 'new password — at least 10 characters (prompted on TTY if omitted)')
  .action(async (opts: { current?: string; new?: string }) => {
    try {
      let current = opts.current;
      let next = opts.new;
      if (!current) current = await promptSecret('Current password: ');
      if (!next)    next    = await promptSecret('New password:     ');
      await api('POST', '/api/v1/account/password-change', {
        currentPassword: current,
        newPassword: next,
      });
      console.log('Password changed. Other sessions have been signed out.');
    } catch (e) {
      console.error(String((e as Error).message));
      process.exit(1);
    }
  });

// ─── sessions ─────────────────────────────────────────────────────────────

const sessions = account.command('sessions').description('Browser sessions attached to this account.');

sessions
  .command('list')
  .description('List active sessions.')
  .action(async () => {
    try {
      const out = await api('GET', '/api/v1/account/sessions');
      const rows = ((out as any)?.data ?? []) as Array<{ id: string; createdAt: string; lastUsedAt: string; ipAddress: string | null; userAgent: string | null; current: boolean }>;
      if (rows.length === 0) { console.log('(no active sessions)'); return; }
      for (const s of rows) {
        const marker = s.current ? '*' : ' ';
        const ua = (s.userAgent ?? 'unknown').slice(0, 40);
        console.log(`${marker} ${s.id}  ip=${s.ipAddress ?? '?'}  ua="${ua}"  last_used=${s.lastUsedAt?.slice(0, 16) ?? '?'}`);
      }
    } catch (e) {
      console.error(String((e as Error).message));
      process.exit(1);
    }
  });

sessions
  .command('revoke')
  .description('Revoke a specific session by id.')
  .requiredOption('--id <id>', 'session id')
  .action(async (opts) => {
    try {
      await api('POST', `/api/v1/account/sessions/${opts.id}/revoke`);
      console.log(`Revoked session ${opts.id}`);
    } catch (e) {
      console.error(String((e as Error).message));
      process.exit(1);
    }
  });

sessions
  .command('revoke-all')
  .description('Revoke every session except the current one.')
  .action(async () => {
    try {
      const out = await api('POST', '/api/v1/account/sessions/revoke-all');
      const count = ((out as any)?.data?.revoked ?? 0);
      console.log(`Revoked ${count} session(s). Current session kept.`);
    } catch (e) {
      console.error(String((e as Error).message));
      process.exit(1);
    }
  });

// ─── linked providers ─────────────────────────────────────────────────────

const linked = account.command('linked').description('Linked social sign-in providers.');

linked
  .command('list')
  .description('List linked providers.')
  .action(async () => {
    try {
      const out = await api('GET', '/api/v1/account/linked-accounts');
      const rows = ((out as any)?.data ?? []) as Array<{ provider: string; email: string | null; linkedAt: string }>;
      if (rows.length === 0) { console.log('(no linked providers)'); return; }
      for (const r of rows) {
        console.log(`${r.provider.padEnd(10)} ${r.email ?? ''}  linked ${r.linkedAt?.slice(0, 10) ?? '?'}`);
      }
    } catch (e) {
      console.error(String((e as Error).message));
      process.exit(1);
    }
  });

linked
  .command('unlink')
  .description('Unlink a social provider (refuses when it would remove your last sign-in method).')
  .requiredOption('--provider <name>', 'google | apple')
  .action(async (opts) => {
    try {
      await api('DELETE', `/api/v1/account/linked-accounts/${opts.provider}`);
      console.log(`Unlinked ${opts.provider}.`);
    } catch (e) {
      console.error(String((e as Error).message));
      process.exit(1);
    }
  });
