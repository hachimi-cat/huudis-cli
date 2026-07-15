import { Command } from 'commander';
import { rest, wrap } from '../lib/rest.js';

interface AssumedSession {
  id: string; role: { id: string; name: string };
  sessionName: string | null; sessionAccessKeyId: string;
  assumedByType: string; assumedBy: string;
  issuedAt: string; expiresAt: string; revokedAt: string | null;
  status: 'active' | 'expired' | 'revoked';
}

export const assumedSessions = new Command('assumed-sessions')
  .alias('assumed-session')
  .description('Inspect and revoke STS-style sessions issued by assume-role.');

assumedSessions
  .command('list')
  .option('--all', 'include expired and revoked (default: active only)')
  .description('List assumed-role sessions in this workspace.')
  .action(wrap(async (opts: { all?: boolean }) => {
    const rows = await rest<AssumedSession[]>('GET', '/api/v1/iam/assumed-sessions');
    const filtered = opts.all ? rows : rows.filter((s) => s.status === 'active');
    if (filtered.length === 0) { console.log(opts.all ? '(no sessions)' : '(no active sessions)'); return; }
    for (const s of filtered) {
      const name = s.sessionName ? ` (${s.sessionName})` : '';
      console.log(`${s.role.name}${name}`.padEnd(36) + `  ${s.sessionAccessKeyId.padEnd(26)}  ${s.status.padEnd(8)}  by ${s.assumedBy}  expires ${s.expiresAt.slice(0, 16)}  ${s.id}`);
    }
  }));

assumedSessions
  .command('revoke <id>')
  .description('Revoke an active assumed-role session — caller\'s credentials stop working immediately.')
  .action(wrap(async (id: string) => {
    await rest('POST', `/api/v1/iam/assumed-sessions/${encodeURIComponent(id)}/revoke`);
    console.log(`Revoked ${id}`);
  }));
