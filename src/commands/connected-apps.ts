import { Command } from 'commander';
import { rest, wrap } from '../lib/rest.js';

interface ConnectedApp {
  id: string;
  client: { clientId: string; name: string; logoUrl: string | null; isFirstParty: boolean };
  scopes: string[];
  consentedAt: string;
}

export const connectedApps = new Command('connected-apps')
  .alias('connected-app')
  .description('Apps you\'ve signed in to with Huudis — view or revoke their access to YOUR account.');

connectedApps
  .command('list')
  .description('List apps connected to the current user.')
  .action(wrap(async () => {
    const rows = await rest<ConnectedApp[]>('GET', '/api/v1/account/connected-apps');
    if (rows.length === 0) { console.log('(no connected apps)'); return; }
    for (const c of rows) {
      const tag = c.client.isFirstParty ? 'official' : '';
      console.log(`${c.client.name.padEnd(28)}  ${c.client.clientId.padEnd(18)}  ${tag.padEnd(8)}  [${c.scopes.join(' ')}]  connected ${c.consentedAt.slice(0, 10)}  ${c.id}`);
    }
  }));

connectedApps
  .command('revoke <id>')
  .description('Revoke an app\'s access to your account — it loses you immediately.')
  .action(wrap(async (id: string) => {
    await rest('DELETE', `/api/v1/account/connected-apps/${encodeURIComponent(id)}`);
    console.log(`Revoked ${id}`);
  }));
