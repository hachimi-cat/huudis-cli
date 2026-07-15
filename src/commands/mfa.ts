import { Command } from 'commander';
import { rest, wrap, printJson } from '../lib/rest.js';

/**
 * `huudis mfa ...` — manage MFA devices on the current Huudis identity.
 *
 * Surface mirrors `@forjio/huudis-node`'s `client.mfa.*` namespace:
 *   - list/delete devices
 *   - start enrollment (totp | webauthn | sms)
 *   - confirm enrollment with a one-time code
 *
 * Operates on the signed-in identity (`/api/v1/mfa/*`) — no workspace
 * scoping needed; the access token already identifies the user.
 */

interface MfaDevice {
  id: string;
  type: 'totp' | 'webauthn' | 'sms';
  label: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  confirmed: boolean;
}

interface EnrollmentResponse {
  deviceId: string;
  type: 'totp' | 'webauthn' | 'sms';
  // totp: provisioning URI + secret; webauthn: challenge; sms: phone hint
  secret?: string;
  otpauthUrl?: string;
  challenge?: string;
  hint?: string;
}

const ALLOWED_TYPES = new Set(['totp', 'webauthn', 'sms']);

export const mfa = new Command('mfa')
  .description('Manage multi-factor authentication devices on your Huudis account.');

// ─── devices ──────────────────────────────────────────────────────────────

const devices = mfa
  .command('devices')
  .description('MFA devices enrolled on the current account.');

devices
  .command('list')
  .description('List MFA devices on the current account.')
  .option('--json', 'print raw JSON instead of a summary')
  .action(wrap(async (opts: { json?: boolean }) => {
    const rows = await rest<MfaDevice[]>('GET', '/api/v1/mfa/devices');
    if (opts.json) { printJson(rows); return; }
    if (!rows || rows.length === 0) { console.log('(no MFA devices)'); return; }
    for (const d of rows) {
      const status = d.confirmed ? 'active' : 'pending';
      const label = d.label ?? '(no label)';
      const last = d.lastUsedAt ? d.lastUsedAt.slice(0, 10) : 'never';
      console.log(`${d.type.padEnd(9)} ${label.padEnd(24)} added ${d.createdAt.slice(0, 10)}  last ${last}  [${status}]  ${d.id}`);
    }
  }));

devices
  .command('delete <id>')
  .description('Remove an MFA device. If it\'s your only factor, account MFA is disabled.')
  .action(wrap(async (id: string) => {
    await rest('DELETE', `/api/v1/mfa/devices/${encodeURIComponent(id)}`);
    console.log(`Deleted ${id}`);
  }));

// ─── enroll ───────────────────────────────────────────────────────────────

mfa
  .command('enroll <type>')
  .description('Start MFA enrollment. type = totp | webauthn | sms.')
  .option('--label <name>', 'human-readable label for the device')
  .action(wrap(async (type: string, opts: { label?: string }) => {
    if (!ALLOWED_TYPES.has(type)) {
      throw new Error(`unknown type "${type}" — expected one of: totp, webauthn, sms`);
    }
    const body: Record<string, unknown> = { type };
    if (opts.label) body.label = opts.label;
    const r = await rest<EnrollmentResponse>('POST', '/api/v1/mfa/enroll', body);
    console.log(`Enrollment started for ${r.type}: device ${r.deviceId}`);
    if (r.otpauthUrl) {
      console.log(`\nScan this URL in your authenticator app:`);
      console.log(`  ${r.otpauthUrl}`);
    }
    if (r.secret) console.log(`Secret: ${r.secret}`);
    if (r.challenge) console.log(`Challenge: ${r.challenge}`);
    if (r.hint) console.log(`Sent code to: ${r.hint}`);
    console.log(`\nConfirm with:  huudis mfa verify ${r.deviceId} <code>`);
  }));

// ─── verify ───────────────────────────────────────────────────────────────

mfa
  .command('verify <device-id> <code>')
  .description('Confirm an in-progress enrollment with the one-time code.')
  .action(wrap(async (deviceId: string, code: string) => {
    await rest('POST', '/api/v1/mfa/verify-enrollment', { deviceId, code });
    console.log(`Verified ${deviceId}.`);
  }));
