import { Command } from 'commander';
import { loadSession } from '../lib/session.js';

/**
 * `huudis iam ...` — manage IAM via the huudis API using the bearer token
 * from `huudis login`. The dashboard API is session-cookie-based; from the
 * CLI we hit the same routes with an `Authorization: Bearer <access_token>`
 * header. The backend's session middleware is cookie-only, so any IAM route
 * that requires a huudis session is not reachable via Bearer auth — but the
 * /authz/check and /authz/assume-role routes accept either, and they're the
 * ones a CLI actually uses day-to-day.
 *
 * Management commands (create-user / create-group / …) are intentionally
 * thin: they call the REST endpoints and print JSON. The full dashboard
 * UI lives at https://huudis.com/dashboard/iam.
 */

function baseUrl(): string {
  return process.env.HUUDIS_API_BASE ?? 'https://huudis.com';
}

function bearer(): string {
  const session = loadSession();
  if (!session) {
    console.error("Not signed in. Run 'huudis login' first.");
    process.exit(1);
  }
  return session.accessToken;
}

async function api(method: string, path: string, body?: unknown): Promise<unknown> {
  const res = await fetch(`${baseUrl()}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${bearer()}`,
    },
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

export const iam = new Command('iam').description('Manage IAM — groups, roles, service accounts, policies, access keys.');

// ─── authz check ──────────────────────────────────────────────────────────

iam
  .command('check')
  .description('Ask huudis whether a principal can perform an action on a resource.')
  .requiredOption('--principal-type <type>', 'user | group | role | service_account')
  .requiredOption('--principal-id <id>', 'usr_/grp_/rol_/svc_ id')
  .requiredOption('--account-id <id>', 'acc_<ulid>')
  .requiredOption('--action <action>', 'e.g. plugipay:CreateCheckoutSession')
  .requiredOption('--resource <arn>', 'e.g. forjio:plugipay::acc_x:checkout-session/cs_abc')
  .option('--mfa', 'mark principal as MFA-verified')
  .action(async (opts) => {
    try {
      const out = await api('POST', '/api/v1/authz/check', {
        principal: { type: opts.principalType, id: opts.principalId, accountId: opts.accountId, mfaVerified: !!opts.mfa },
        action: opts.action,
        resource: opts.resource,
      });
      console.log(JSON.stringify((out as any)?.data ?? out, null, 2));
    } catch (e) {
      console.error(String((e as Error).message));
      process.exit(1);
    }
  });

// ─── assume-role ──────────────────────────────────────────────────────────

iam
  .command('assume-role')
  .description('Mint short-lived credentials from an IAM role.')
  .requiredOption('--role-id <id>', 'rol_<ulid>')
  .option('--session-name <name>', 'human-readable tag for the assumed session')
  .option('--duration <seconds>', 'session duration in seconds (within role\'s max)', parseInt)
  .action(async (opts) => {
    try {
      const body: Record<string, unknown> = { roleId: opts.roleId };
      if (opts.sessionName) body.sessionName = opts.sessionName;
      if (opts.duration) body.durationSeconds = opts.duration;
      const out = await api('POST', '/api/v1/authz/assume-role', body);
      console.log(JSON.stringify((out as any)?.data ?? out, null, 2));
    } catch (e) {
      console.error(String((e as Error).message));
      process.exit(1);
    }
  });

// ─── list/get utilities ───────────────────────────────────────────────────

iam
  .command('list-policies')
  .description('List every IAM policy visible to the caller (custom + system canned).')
  .action(async () => {
    try {
      const out = await api('GET', '/api/v1/iam/policies');
      const rows = ((out as any)?.data ?? []) as Array<{ id: string; name: string; scope: string; version: number }>;
      if (rows.length === 0) { console.log('(no policies)'); return; }
      for (const p of rows) console.log(`${p.scope === 'system' ? '*' : ' '} ${p.name.padEnd(30)}  v${p.version}  ${p.id}`);
    } catch (e) {
      console.error(String((e as Error).message));
      process.exit(1);
    }
  });

iam
  .command('list-groups')
  .description('List IAM groups in the caller\'s account.')
  .action(async () => {
    try {
      const out = await api('GET', '/api/v1/iam/groups');
      const rows = ((out as any)?.data ?? []) as Array<{ id: string; name: string; _count?: { members: number } }>;
      if (rows.length === 0) { console.log('(no groups)'); return; }
      for (const g of rows) console.log(`${g.name.padEnd(30)}  ${(g._count?.members ?? 0)} members  ${g.id}`);
    } catch (e) {
      console.error(String((e as Error).message));
      process.exit(1);
    }
  });

iam
  .command('list-roles')
  .description('List IAM roles in the caller\'s account.')
  .action(async () => {
    try {
      const out = await api('GET', '/api/v1/iam/roles');
      const rows = ((out as any)?.data ?? []) as Array<{ id: string; name: string; maxSessionDurationSec: number }>;
      if (rows.length === 0) { console.log('(no roles)'); return; }
      for (const r of rows) console.log(`${r.name.padEnd(30)}  max ${Math.round(r.maxSessionDurationSec / 60)}min  ${r.id}`);
    } catch (e) {
      console.error(String((e as Error).message));
      process.exit(1);
    }
  });

iam
  .command('list-service-accounts')
  .description('List service accounts in the caller\'s account.')
  .action(async () => {
    try {
      const out = await api('GET', '/api/v1/iam/service-accounts');
      const rows = ((out as any)?.data ?? []) as Array<{ id: string; name: string; disabled: boolean }>;
      if (rows.length === 0) { console.log('(no service accounts)'); return; }
      for (const s of rows) console.log(`${s.name.padEnd(30)}  ${s.disabled ? 'DISABLED' : 'active'}  ${s.id}`);
    } catch (e) {
      console.error(String((e as Error).message));
      process.exit(1);
    }
  });

iam
  .command('list-access-keys')
  .description('List access keys for a principal.')
  .requiredOption('--principal-type <type>', 'user | service_account')
  .requiredOption('--principal-id <id>', 'usr_/svc_ id')
  .action(async (opts) => {
    try {
      const out = await api('GET', `/api/v1/iam/access-keys?principalType=${opts.principalType}&principalId=${encodeURIComponent(opts.principalId)}`);
      const rows = ((out as any)?.data ?? []) as Array<{ id: string; accessKeyId: string; label: string | null; disabled: boolean; createdAt: string; lastUsedAt: string | null }>;
      if (rows.length === 0) { console.log('(no access keys)'); return; }
      for (const k of rows) console.log(`${k.accessKeyId}  ${(k.label ?? '').padEnd(20)}  ${k.disabled ? 'REVOKED' : 'active'}  created ${k.createdAt.slice(0, 10)}  last_used ${k.lastUsedAt ? k.lastUsedAt.slice(0, 10) : 'never'}  ${k.id}`);
    } catch (e) {
      console.error(String((e as Error).message));
      process.exit(1);
    }
  });

iam
  .command('create-access-key')
  .description('Create an access key — secret is shown once.')
  .requiredOption('--principal-type <type>', 'user | service_account')
  .requiredOption('--principal-id <id>', 'usr_/svc_ id')
  .option('--label <label>', 'human-readable label')
  .action(async (opts) => {
    try {
      const out = await api('POST', '/api/v1/iam/access-keys', {
        principalType: opts.principalType,
        principalId: opts.principalId,
        ...(opts.label ? { label: opts.label } : {}),
      });
      const data = ((out as any)?.data ?? {}) as { accessKeyId: string; secret: string };
      console.log('Save these credentials now. The secret will not be shown again.');
      console.log(`Access Key ID: ${data.accessKeyId}`);
      console.log(`Secret:        ${data.secret}`);
    } catch (e) {
      console.error(String((e as Error).message));
      process.exit(1);
    }
  });

iam
  .command('revoke-access-key')
  .description('Disable an access key without deleting it.')
  .requiredOption('--id <id>', 'akid_<ulid>')
  .action(async (opts) => {
    try {
      await api('POST', `/api/v1/iam/access-keys/${opts.id}/revoke`);
      console.log(`Revoked ${opts.id}`);
    } catch (e) {
      console.error(String((e as Error).message));
      process.exit(1);
    }
  });

iam
  .command('delete-access-key')
  .description('Permanently delete an access key.')
  .requiredOption('--id <id>', 'akid_<ulid>')
  .action(async (opts) => {
    try {
      await api('DELETE', `/api/v1/iam/access-keys/${opts.id}`);
      console.log(`Deleted ${opts.id}`);
    } catch (e) { console.error(String((e as Error).message)); process.exit(1); }
  });

// ─── Groups CRUD + membership ────────────────────────────────────────────

iam
  .command('create-group')
  .requiredOption('--name <name>')
  .option('--description <text>')
  .description('Create an IAM group.')
  .action(async (opts) => {
    try {
      const out = await api('POST', '/api/v1/iam/groups', {
        name: opts.name, ...(opts.description ? { description: opts.description } : {}),
      });
      console.log(JSON.stringify((out as { data?: unknown })?.data ?? out, null, 2));
    } catch (e) { console.error(String((e as Error).message)); process.exit(1); }
  });

iam
  .command('delete-group')
  .requiredOption('--id <id>', 'grp_<ulid>')
  .description('Delete an IAM group.')
  .action(async (opts) => {
    try {
      await api('DELETE', `/api/v1/iam/groups/${opts.id}`);
      console.log(`Deleted ${opts.id}`);
    } catch (e) { console.error(String((e as Error).message)); process.exit(1); }
  });

iam
  .command('add-group-member')
  .requiredOption('--group-id <id>', 'grp_<ulid>')
  .requiredOption('--user-id <id>', 'usr_<ulid>')
  .description('Add a user to a group.')
  .action(async (opts) => {
    try {
      await api('POST', `/api/v1/iam/groups/${opts.groupId}/members`, { userId: opts.userId });
      console.log(`Added ${opts.userId} to ${opts.groupId}`);
    } catch (e) { console.error(String((e as Error).message)); process.exit(1); }
  });

iam
  .command('remove-group-member')
  .requiredOption('--group-id <id>', 'grp_<ulid>')
  .requiredOption('--user-id <id>', 'usr_<ulid>')
  .description('Remove a user from a group.')
  .action(async (opts) => {
    try {
      await api('DELETE', `/api/v1/iam/groups/${opts.groupId}/members/${opts.userId}`);
      console.log(`Removed ${opts.userId} from ${opts.groupId}`);
    } catch (e) { console.error(String((e as Error).message)); process.exit(1); }
  });

// ─── Roles CRUD ──────────────────────────────────────────────────────────

iam
  .command('create-role')
  .requiredOption('--name <name>')
  .option('--description <text>')
  .requiredOption('--trust-policy <path>', 'path to a JSON file with the trust policy document')
  .option('--max-session-sec <seconds>', 'cap the session duration', parseInt)
  .description('Create an assumable IAM role.')
  .action(async (opts) => {
    try {
      const fs = await import('node:fs');
      const trustPolicy = JSON.parse(fs.readFileSync(opts.trustPolicy, 'utf8'));
      const out = await api('POST', '/api/v1/iam/roles', {
        name: opts.name,
        ...(opts.description ? { description: opts.description } : {}),
        trustPolicy,
        ...(opts.maxSessionSec ? { maxSessionDurationSec: opts.maxSessionSec } : {}),
      });
      console.log(JSON.stringify((out as { data?: unknown })?.data ?? out, null, 2));
    } catch (e) { console.error(String((e as Error).message)); process.exit(1); }
  });

iam
  .command('delete-role')
  .requiredOption('--id <id>', 'rol_<ulid>')
  .description('Delete an IAM role.')
  .action(async (opts) => {
    try {
      await api('DELETE', `/api/v1/iam/roles/${opts.id}`);
      console.log(`Deleted ${opts.id}`);
    } catch (e) { console.error(String((e as Error).message)); process.exit(1); }
  });

// ─── Service accounts CRUD ──────────────────────────────────────────────

iam
  .command('create-service-account')
  .requiredOption('--name <name>')
  .option('--description <text>')
  .description('Create a service account (M2M identity).')
  .action(async (opts) => {
    try {
      const out = await api('POST', '/api/v1/iam/service-accounts', {
        name: opts.name, ...(opts.description ? { description: opts.description } : {}),
      });
      console.log(JSON.stringify((out as { data?: unknown })?.data ?? out, null, 2));
    } catch (e) { console.error(String((e as Error).message)); process.exit(1); }
  });

iam
  .command('delete-service-account')
  .requiredOption('--id <id>', 'svc_<ulid>')
  .description('Delete a service account. Its access keys are removed.')
  .action(async (opts) => {
    try {
      await api('DELETE', `/api/v1/iam/service-accounts/${opts.id}`);
      console.log(`Deleted ${opts.id}`);
    } catch (e) { console.error(String((e as Error).message)); process.exit(1); }
  });

// ─── Policies CRUD ───────────────────────────────────────────────────────

iam
  .command('create-policy')
  .requiredOption('--name <name>')
  .option('--description <text>')
  .requiredOption('--document <path>', 'path to a JSON file with the policy document')
  .description('Create a custom IAM policy.')
  .action(async (opts) => {
    try {
      const fs = await import('node:fs');
      const document = JSON.parse(fs.readFileSync(opts.document, 'utf8'));
      const out = await api('POST', '/api/v1/iam/policies', {
        name: opts.name,
        ...(opts.description ? { description: opts.description } : {}),
        document,
      });
      console.log(JSON.stringify((out as { data?: unknown })?.data ?? out, null, 2));
    } catch (e) { console.error(String((e as Error).message)); process.exit(1); }
  });

iam
  .command('update-policy')
  .requiredOption('--id <id>', 'pol_<ulid>')
  .option('--description <text>')
  .option('--document <path>', 'path to a JSON file with the new policy document')
  .description('Update a custom policy (system policies are immutable).')
  .action(async (opts) => {
    try {
      const body: Record<string, unknown> = {};
      if (opts.description) body.description = opts.description;
      if (opts.document) {
        const fs = await import('node:fs');
        body.document = JSON.parse(fs.readFileSync(opts.document, 'utf8'));
      }
      await api('PATCH', `/api/v1/iam/policies/${opts.id}`, body);
      console.log(`Updated ${opts.id}`);
    } catch (e) { console.error(String((e as Error).message)); process.exit(1); }
  });

iam
  .command('delete-policy')
  .requiredOption('--id <id>', 'pol_<ulid>')
  .description('Delete a custom policy (system policies are immutable).')
  .action(async (opts) => {
    try {
      await api('DELETE', `/api/v1/iam/policies/${opts.id}`);
      console.log(`Deleted ${opts.id}`);
    } catch (e) { console.error(String((e as Error).message)); process.exit(1); }
  });

// ─── Policy attachments ──────────────────────────────────────────────────

iam
  .command('list-attachments')
  .option('--policy-id <id>', 'pol_<ulid>')
  .option('--principal-type <type>', 'user | group | role | service_account')
  .option('--principal-id <id>', 'usr_/grp_/rol_/svc_ id')
  .description('List policy attachments, optionally filtered.')
  .action(async (opts) => {
    try {
      const q = new URLSearchParams();
      if (opts.policyId) q.set('policyId', opts.policyId);
      if (opts.principalType) q.set('principalType', opts.principalType);
      if (opts.principalId) q.set('principalId', opts.principalId);
      const qs = q.toString();
      const out = await api('GET', `/api/v1/iam/policy-attachments${qs ? `?${qs}` : ''}`);
      const rows = ((out as { data?: Array<{ id: string; policyId: string; principalType: string; principalId: string; policy: { name: string } }> })?.data ?? []);
      if (rows.length === 0) { console.log('(no attachments)'); return; }
      for (const a of rows) {
        console.log(`${a.policy.name.padEnd(24)}  ${a.principalType.padEnd(16)}  ${a.principalId.padEnd(32)}  ${a.id}`);
      }
    } catch (e) { console.error(String((e as Error).message)); process.exit(1); }
  });

iam
  .command('attach-policy')
  .requiredOption('--policy-id <id>', 'pol_<ulid>')
  .requiredOption('--principal-type <type>', 'user | group | role | service_account')
  .requiredOption('--principal-id <id>', 'usr_/grp_/rol_/svc_ id')
  .description('Attach a policy to a principal.')
  .action(async (opts) => {
    try {
      const out = await api('POST', '/api/v1/iam/policy-attachments', {
        policyId: opts.policyId,
        principalType: opts.principalType,
        principalId: opts.principalId,
      });
      const data = (out as { data?: { id: string } })?.data;
      console.log(`Attached (${data?.id})`);
    } catch (e) { console.error(String((e as Error).message)); process.exit(1); }
  });

iam
  .command('detach-policy')
  .requiredOption('--id <id>', 'pat_<ulid>')
  .description('Detach a policy from a principal.')
  .action(async (opts) => {
    try {
      await api('DELETE', `/api/v1/iam/policy-attachments/${opts.id}`);
      console.log(`Detached ${opts.id}`);
    } catch (e) { console.error(String((e as Error).message)); process.exit(1); }
  });
