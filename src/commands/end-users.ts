import { Command } from 'commander';
import { rest, wrap, printJson } from '../lib/rest.js';
import { resolveIds, runBulk, finishBulk, type BulkOptions } from '../lib/bulk.js';

interface EndUser {
  id: string; email: string; name: string | null;
  emailVerified: boolean; disabled: boolean;
  firstSignInAt: string; lastLoginAt: string | null;
  clientCount: number;
}

export const endUsers = new Command('end-users')
  .alias('end-user')
  .description('People who signed into this workspace\'s OIDC apps via Huudis.');

endUsers
  .command('list')
  .description('List every end-user of this workspace.')
  .action(wrap(async () => {
    const rows = await rest<EndUser[]>('GET', '/api/v1/ops/end-users');
    if (rows.length === 0) { console.log('(no end users)'); return; }
    for (const u of rows) {
      const status = [
        u.disabled ? 'disabled' : 'active',
        u.emailVerified ? '' : 'unverified',
      ].filter(Boolean).join(',');
      console.log(`${u.email.padEnd(36)}  ${u.clientCount} apps  first ${u.firstSignInAt.slice(0, 10)}  last ${(u.lastLoginAt ?? '').slice(0, 10) || 'never'}  [${status}]  ${u.id}`);
    }
  }));

endUsers
  .command('get <id>')
  .description('Full detail for one end-user (consents, MFA, disabled status).')
  .action(wrap(async (id: string) => {
    const u = await rest('GET', `/api/v1/ops/end-users/${encodeURIComponent(id)}`);
    printJson(u);
  }));

endUsers
  .command('revoke <id>')
  .description('Cut off this user\'s access to your workspace\'s apps (consents + refresh tokens).')
  .action(wrap(async (id: string) => {
    await rest('POST', `/api/v1/ops/end-users/${encodeURIComponent(id)}/revoke`);
    console.log(`Revoked ${id}`);
  }));

endUsers
  .command('send-reset <id>')
  .description('Trigger a password-reset email (Huudis owns the link/flow).')
  .action(wrap(async (id: string) => {
    await rest('POST', `/api/v1/ops/end-users/${encodeURIComponent(id)}/send-password-reset`);
    console.log('Reset email sent.');
  }));

endUsers
  .command('verify-email <id>')
  .description('Force-mark the user\'s email as verified (audited — confirm ownership first).')
  .action(wrap(async (id: string) => {
    await rest('POST', `/api/v1/ops/end-users/${encodeURIComponent(id)}/verify-email`);
    console.log('Email marked as verified.');
  }));

endUsers
  .command('impersonate <id>')
  .description('Mint a short-lived session as this user. Prints the cookie value — paste into the dashboard manually, or use the dashboard\'s "Impersonate" button.')
  .option('--duration <seconds>', 'session duration in seconds (60–3600, default 1800)', (v) => parseInt(v, 10))
  .action(wrap(async (id: string, opts: { duration?: number }) => {
    const r = await rest<{ impersonating: { userId: string; email: string }; expiresAt: string }>(
      'POST', `/api/v1/ops/end-users/${encodeURIComponent(id)}/impersonate`,
      opts.duration ? { durationSeconds: opts.duration } : undefined,
    );
    console.log(`Now acting as ${r.impersonating.email} until ${r.expiresAt}`);
    console.log('Use the dashboard for interactive impersonation — this CLI command is for automation.');
  }));

endUsers
  .command('stop-impersonation')
  .description('End the current impersonation session (revokes it).')
  .action(wrap(async () => {
    await rest('POST', '/api/v1/ops/end-users/stop-impersonation');
    console.log('Impersonation ended.');
  }));

endUsers
  .command('disable <id>')
  .description('[Huudis-ops only] Globally disable a user across every Forjio service.')
  .action(wrap(async (id: string) => {
    await rest('POST', `/api/v1/ops/end-users/${encodeURIComponent(id)}/disable`);
    console.log(`Disabled ${id}`);
  }));

endUsers
  .command('enable <id>')
  .description('[Huudis-ops only] Undo a global disable.')
  .action(wrap(async (id: string) => {
    await rest('POST', `/api/v1/ops/end-users/${encodeURIComponent(id)}/enable`);
    console.log(`Enabled ${id}`);
  }));

// ─── Bulk ───────────────────────────────────────────────────────────────

endUsers
  .command('bulk-disable')
  .description('Disable multiple end-users. Loops the per-user disable call.')
  .option('--ids <csv>', 'comma-separated end-user IDs')
  .option('--from-file <path>', 'read IDs from a file (one per line)')
  .option('--from-stdin', 'read IDs from stdin (one per line)')
  .option('--reason <text>', 'audit-log reason for the disable')
  .option('--json', 'emit a result array instead of progress lines')
  .action(async (opts: BulkOptions & { reason?: string }) => {
    try {
      const ids = await resolveIds(opts);
      const body = opts.reason ? { reason: opts.reason } : undefined;
      const results = await runBulk(
        ids,
        async (id) => { await rest('POST', `/api/v1/ops/end-users/${encodeURIComponent(id)}/disable`, body); },
        { json: opts.json, verbAction: 'disabled' },
      );
      process.exit(finishBulk(results, opts));
    } catch (e) {
      console.error(String((e as Error).message));
      process.exit(1);
    }
  });

endUsers
  .command('bulk-enable')
  .description('Re-enable multiple end-users. Loops the per-user enable call.')
  .option('--ids <csv>', 'comma-separated end-user IDs')
  .option('--from-file <path>', 'read IDs from a file (one per line)')
  .option('--from-stdin', 'read IDs from stdin (one per line)')
  .option('--json', 'emit a result array instead of progress lines')
  .action(async (opts: BulkOptions) => {
    try {
      const ids = await resolveIds(opts);
      const results = await runBulk(
        ids,
        async (id) => { await rest('POST', `/api/v1/ops/end-users/${encodeURIComponent(id)}/enable`); },
        { json: opts.json, verbAction: 'enabled' },
      );
      process.exit(finishBulk(results, opts));
    } catch (e) {
      console.error(String((e as Error).message));
      process.exit(1);
    }
  });
