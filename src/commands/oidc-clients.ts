import { Command } from 'commander';
import { rest, wrap } from '../lib/rest.js';

interface OidcClient {
  id: string; accountId: string | null; clientId: string; name: string;
  redirectUris: string[]; scopes: string[];
  isFirstParty: boolean; hasSecret: boolean;
  createdAt: string;
}

export const oidcClients = new Command('oidc-clients')
  .alias('oidc-client')
  .description('Register and manage OIDC client apps that sign users in through Huudis.');

oidcClients
  .command('list')
  .description('List clients visible to the active workspace (your own + first-party).')
  .action(wrap(async () => {
    const rows = await rest<OidcClient[]>('GET', '/api/v1/oidc/clients');
    if (rows.length === 0) { console.log('(no clients)'); return; }
    for (const c of rows) {
      const tag = [c.isFirstParty ? 'system' : '', c.hasSecret ? 'confidential' : 'public'].filter(Boolean).join(',');
      console.log(`${c.name.padEnd(28)}  ${c.clientId.padEnd(20)}  [${tag}]  ${c.redirectUris.length} redirect_uris  ${c.id}`);
    }
  }));

oidcClients
  .command('create <name>')
  .description('Register a confidential client. Client secret is shown once.')
  .option('--redirect <uri...>', 'one or more redirect URIs')
  .option('--scope <scope...>', 'scopes (default: openid profile email)')
  .option('--public', 'public client — no secret is minted (for CLIs, mobile, SPAs)')
  .option('--logo <url>', 'optional logo URL')
  .action(wrap(async (name: string, opts: { redirect?: string[]; scope?: string[]; public?: boolean; logo?: string }) => {
    const r = await rest<OidcClient & { clientSecret: string | null }>('POST', '/api/v1/oidc/clients', {
      name,
      redirectUris: opts.redirect ?? [],
      scopes: opts.scope ?? ['openid', 'profile', 'email'],
      public: !!opts.public,
      ...(opts.logo ? { logoUrl: opts.logo } : {}),
    });
    console.log('Save these credentials now.');
    console.log(`client_id:     ${r.clientId}`);
    if (r.clientSecret) console.log(`client_secret: ${r.clientSecret}`);
    else console.log('(public client — no secret)');
  }));

oidcClients
  .command('update <id>')
  .description('Edit a client\'s name, redirect URIs, or scopes.')
  .option('--name <name>', 'new display name')
  .option('--redirect <uri...>', 'replace the redirect URI list entirely')
  .option('--scope <scope...>', 'replace the scope list entirely')
  .option('--logo <url>', 'new logo URL (pass empty string to clear)')
  .action(wrap(async (id: string, opts: { name?: string; redirect?: string[]; scope?: string[]; logo?: string }) => {
    const body: Record<string, unknown> = {};
    if (opts.name) body.name = opts.name;
    if (opts.redirect) body.redirectUris = opts.redirect;
    if (opts.scope) body.scopes = opts.scope;
    if (opts.logo !== undefined) body.logoUrl = opts.logo === '' ? null : opts.logo;
    await rest('PATCH', `/api/v1/oidc/clients/${encodeURIComponent(id)}`, body);
    console.log(`Updated ${id}`);
  }));

oidcClients
  .command('rotate-secret <id>')
  .description('Rotate a confidential client\'s secret. Old secret stops working immediately.')
  .action(wrap(async (id: string) => {
    const r = await rest<{ clientSecret: string }>(
      'POST', `/api/v1/oidc/clients/${encodeURIComponent(id)}/rotate-secret`,
    );
    console.log('Save the new secret now. The old one is invalidated.');
    console.log(`client_secret: ${r.clientSecret}`);
  }));

oidcClients
  .command('delete <id>')
  .description('Delete an OIDC client. Any app using its client_id stops working.')
  .action(wrap(async (id: string) => {
    await rest('DELETE', `/api/v1/oidc/clients/${encodeURIComponent(id)}`);
    console.log(`Deleted ${id}`);
  }));
