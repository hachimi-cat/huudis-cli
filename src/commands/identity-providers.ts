import { Command } from 'commander';
import fs from 'node:fs';
import { rest, wrap, printJson } from '../lib/rest.js';

interface Idp {
  id: string; accountId: string; name: string;
  type: 'saml' | 'oidc'; metadata: Record<string, unknown>;
  createdAt: string;
}

export const identityProviders = new Command('identity-providers')
  .alias('idp')
  .description('External SAML / OIDC identity providers that federate into this workspace.');

identityProviders
  .command('list')
  .description('List configured identity providers.')
  .action(wrap(async () => {
    const rows = await rest<Idp[]>('GET', '/api/v1/iam/identity-providers');
    if (rows.length === 0) { console.log('(no identity providers)'); return; }
    for (const i of rows) {
      console.log(`${i.name.padEnd(30)}  ${i.type.toUpperCase().padEnd(6)}  added ${i.createdAt.slice(0, 10)}  ${i.id}`);
    }
  }));

identityProviders
  .command('get <id>')
  .description('Print a provider\'s full metadata JSON.')
  .action(wrap(async (id: string) => {
    const idp = await rest<Idp>('GET', `/api/v1/iam/identity-providers/${encodeURIComponent(id)}`);
    printJson(idp);
  }));

identityProviders
  .command('add <name>')
  .description('Register an identity provider.')
  .requiredOption('--type <type>', 'saml | oidc')
  .option('--metadata <path>', 'path to a JSON file with provider metadata (entityId, ssoUrl, cert, etc.)')
  .action(wrap(async (name: string, opts: { type: 'saml' | 'oidc'; metadata?: string }) => {
    let metadata: Record<string, unknown> = {};
    if (opts.metadata) {
      metadata = JSON.parse(fs.readFileSync(opts.metadata, 'utf8'));
    }
    const r = await rest<Idp>('POST', '/api/v1/iam/identity-providers', {
      name, type: opts.type, metadata,
    });
    console.log(`Added ${name} (${r.id})`);
  }));

identityProviders
  .command('update <id>')
  .description('Rename or replace metadata on a provider.')
  .option('--name <name>', 'new name')
  .option('--metadata <path>', 'path to a JSON file with new metadata')
  .action(wrap(async (id: string, opts: { name?: string; metadata?: string }) => {
    const body: Record<string, unknown> = {};
    if (opts.name) body.name = opts.name;
    if (opts.metadata) body.metadata = JSON.parse(fs.readFileSync(opts.metadata, 'utf8'));
    await rest('PATCH', `/api/v1/iam/identity-providers/${encodeURIComponent(id)}`, body);
    console.log(`Updated ${id}`);
  }));

identityProviders
  .command('remove <id>')
  .description('Delete an identity provider. Users who signed in through it need another way in.')
  .action(wrap(async (id: string) => {
    await rest('DELETE', `/api/v1/iam/identity-providers/${encodeURIComponent(id)}`);
    console.log(`Removed ${id}`);
  }));
