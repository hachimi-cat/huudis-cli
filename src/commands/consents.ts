import { Command } from 'commander';
import { rest, wrap, printJson } from '../lib/rest.js';

/**
 * `huudis consents ...` — view + revoke OAuth consents the current
 * user has granted to apps via Huudis SSO.
 *
 * Same backend surface as `huudis connected-apps` (`/api/v1/account/connected-apps`);
 * this group is the user-facing "consents" vocabulary that matches the
 * `client.connectedApps.*` namespace in `@forjio/huudis-node` and the
 * privacy/portal language abang ships in the dashboard.
 */

interface ConnectedApp {
  id: string;
  client: { clientId: string; name: string; logoUrl: string | null; isFirstParty: boolean };
  scopes: string[];
  consentedAt: string;
}

export const consents = new Command('consents')
  .alias('consent')
  .description('OAuth consents you\'ve granted to apps via Huudis — view or revoke.');

consents
  .command('list')
  .description('List apps you\'ve granted access to your Huudis account.')
  .option('--json', 'print raw JSON instead of a summary')
  .action(wrap(async (opts: { json?: boolean }) => {
    const rows = await rest<ConnectedApp[]>('GET', '/api/v1/account/connected-apps');
    if (opts.json) { printJson(rows); return; }
    if (!rows || rows.length === 0) { console.log('(no consents granted)'); return; }
    for (const c of rows) {
      const tag = c.client.isFirstParty ? 'official' : '';
      console.log(`${c.client.name.padEnd(28)}  ${c.client.clientId.padEnd(18)}  ${tag.padEnd(8)}  [${c.scopes.join(' ')}]  consented ${c.consentedAt.slice(0, 10)}  ${c.id}`);
    }
  }));

consents
  .command('revoke <id>')
  .description('Revoke a consent — the app loses access to your account immediately.')
  .action(wrap(async (id: string) => {
    await rest('DELETE', `/api/v1/account/connected-apps/${encodeURIComponent(id)}`);
    console.log(`Revoked ${id}`);
  }));
