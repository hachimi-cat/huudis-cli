import { Command } from 'commander';
import { rest, wrap } from '../lib/rest.js';
import { resolveIds, runBulk, finishBulk, type BulkOptions } from '../lib/bulk.js';

interface IamUser {
  id: string; email: string; name: string | null; role: string;
  emailVerified: boolean; joinedAt: string; lastLoginAt: string | null;
  groups: Array<{ id: string; name: string }>;
}
interface Invite {
  id: string; email: string; role: string;
  invitedAt: string; expiresAt: string;
  invitedBy: { email: string; name: string | null };
}

export const members = new Command('members')
  .alias('member')
  .description('Manage the people who can administer this workspace (not end users).');

members
  .command('list')
  .description('List workspace members.')
  .action(wrap(async () => {
    const rows = await rest<IamUser[]>('GET', '/api/v1/iam/users');
    if (rows.length === 0) { console.log('(no members)'); return; }
    for (const u of rows) {
      const g = u.groups.map((x) => x.name).join(',') || '—';
      console.log(`${(u.name ?? u.email).padEnd(30)}  ${u.email.padEnd(32)}  ${u.role.padEnd(8)}  [${g}]  ${u.id}`);
    }
  }));

members
  .command('add <email>')
  .description('Add a user directly to this workspace. Temp password is auto-generated unless --password is set.')
  .option('--name <name>', 'optional display name')
  .option('--password <password>', 'bring-your-own; must be ≥10 chars')
  .option('--role <role>', 'owner | admin | member (default: member)', 'member')
  .option('--unverified', 'skip the email-verified flag (default: verified)')
  .option('--no-email', 'do not email the user their temp password')
  .action(wrap(async (email: string, opts: { name?: string; password?: string; role: string; unverified?: boolean; email?: boolean }) => {
    const r = await rest<{ id: string; tempPassword?: string }>('POST', '/api/v1/iam/users', {
      email,
      ...(opts.name ? { name: opts.name } : {}),
      ...(opts.password ? { password: opts.password } : {}),
      role: opts.role,
      emailVerified: !opts.unverified,
      sendEmail: opts.email !== false,
    });
    console.log(`Added ${email} as ${opts.role} (${r.id})`);
    if (r.tempPassword) {
      console.log(`Temp password: ${r.tempPassword}`);
      console.log('(copy now — it will not be shown again)');
    }
  }));

members
  .command('remove <id>')
  .description('Remove a user from this workspace. Cannot remove the last owner.')
  .action(wrap(async (id: string) => {
    await rest('DELETE', `/api/v1/iam/users/${encodeURIComponent(id)}`);
    console.log(`Removed ${id}`);
  }));

members
  .command('set-role <id> <role>')
  .description('Change a user\'s workspace role (owner | admin | member).')
  .action(wrap(async (id: string, role: string) => {
    await rest('PATCH', `/api/v1/iam/users/${encodeURIComponent(id)}`, { role });
    console.log(`${id} → ${role}`);
  }));

members
  .command('reset-password <id>')
  .description('Admin-trigger a password reset email for this user.')
  .action(wrap(async (id: string) => {
    await rest('POST', `/api/v1/iam/users/${encodeURIComponent(id)}/reset-password`);
    console.log(`Reset email sent to user ${id}.`);
  }));

// ─── Bulk ───────────────────────────────────────────────────────────────

members
  .command('bulk-remove')
  .description('Remove multiple members. Loops `remove <id>` per ID — there is no bulk endpoint upstream.')
  .option('--ids <csv>', 'comma-separated member IDs')
  .option('--from-file <path>', 'read IDs from a file (one per line)')
  .option('--from-stdin', 'read IDs from stdin (one per line)')
  .option('--json', 'emit a result array instead of progress lines')
  .action(async (opts: BulkOptions) => {
    try {
      const ids = await resolveIds(opts);
      const results = await runBulk(
        ids,
        async (id) => { await rest('DELETE', `/api/v1/iam/users/${encodeURIComponent(id)}`); },
        { json: opts.json, verbAction: 'removed' },
      );
      process.exit(finishBulk(results, opts));
    } catch (e) {
      console.error(String((e as Error).message));
      process.exit(1);
    }
  });

members
  .command('bulk-set-role')
  .description('Set the same role for multiple members.')
  .option('--ids <csv>', 'comma-separated member IDs')
  .option('--from-file <path>', 'read IDs from a file (one per line)')
  .option('--from-stdin', 'read IDs from stdin (one per line)')
  .requiredOption('--role <role>', 'owner | admin | member')
  .option('--json', 'emit a result array instead of progress lines')
  .action(async (opts: BulkOptions & { role: string }) => {
    try {
      const ids = await resolveIds(opts);
      const results = await runBulk(
        ids,
        async (id) => { await rest('PATCH', `/api/v1/iam/users/${encodeURIComponent(id)}`, { role: opts.role }); },
        { json: opts.json, verbAction: `set role=${opts.role} on` },
      );
      process.exit(finishBulk(results, opts));
    } catch (e) {
      console.error(String((e as Error).message));
      process.exit(1);
    }
  });

// ─── Invites ────────────────────────────────────────────────────────────

const invites = members.command('invites')
  .description('Pending invite tokens for this workspace.');

invites
  .command('list')
  .description('Show all pending invites.')
  .action(wrap(async () => {
    const rows = await rest<Invite[]>('GET', '/api/v1/iam/invites');
    if (rows.length === 0) { console.log('(no pending invites)'); return; }
    for (const i of rows) {
      console.log(`${i.email.padEnd(32)}  ${i.role.padEnd(8)}  expires ${i.expiresAt.slice(0, 10)}  by ${i.invitedBy.email}  ${i.id}`);
    }
  }));

invites
  .command('send <email>')
  .description('Send (or resend) an invite link to an email.')
  .option('--role <role>', 'owner | admin | member (default: member)', 'member')
  .action(wrap(async (email: string, opts: { role: string }) => {
    const r = await rest<{ id: string; token: string }>(
      'POST', '/api/v1/iam/invites', { email, role: opts.role },
    );
    console.log(`Invite ${r.id} sent to ${email} (role ${opts.role}).`);
  }));

invites
  .command('cancel <id>')
  .description('Cancel a pending invite.')
  .action(wrap(async (id: string) => {
    await rest('DELETE', `/api/v1/iam/invites/${encodeURIComponent(id)}`);
    console.log(`Canceled ${id}`);
  }));
