import { Command } from 'commander';
import { rest, printJson, wrap } from '../lib/rest.js';

interface Workspace {
  id: string; name: string; slug: string; role: string;
  isActive: boolean; isForjioInternal: boolean;
  joinedAt: string; createdAt: string;
}

export const workspaces = new Command('workspaces')
  .alias('workspace')
  .description('List, create, rename, or switch the active workspace.');

workspaces
  .command('list')
  .description('List every workspace the current user belongs to.')
  .action(wrap(async () => {
    const rows = await rest<Workspace[]>('GET', '/api/v1/account/workspaces/');
    if (rows.length === 0) { console.log('(no workspaces)'); return; }
    for (const w of rows) {
      const tag = [
        w.isActive ? 'active' : '',
        w.isForjioInternal ? 'forjio' : '',
      ].filter(Boolean).join(',');
      console.log(`${w.name.padEnd(30)}  ${w.role.padEnd(8)}  ${tag.padEnd(14)}  ${w.slug.padEnd(24)}  ${w.id}`);
    }
  }));

workspaces
  .command('create <name>')
  .description('Create a new workspace and switch the session into it.')
  .action(wrap(async (name: string) => {
    const w = await rest<Workspace>('POST', '/api/v1/account/workspaces/', { name });
    console.log(`Created ${w.name} (${w.id})`);
  }));

workspaces
  .command('rename <id> <name>')
  .description('Rename a workspace. Owner / admin only.')
  .action(wrap(async (id: string, name: string) => {
    const w = await rest<{ id: string; name: string; slug: string }>(
      'PATCH', `/api/v1/account/workspaces/${encodeURIComponent(id)}`, { name },
    );
    console.log(`Renamed → ${w.name}`);
  }));

workspaces
  .command('switch <id>')
  .description('Set the session\'s active workspace.')
  .action(wrap(async (id: string) => {
    const r = await rest<{ activeAccountId: string }>(
      'POST', `/api/v1/account/workspaces/${encodeURIComponent(id)}/switch`,
    );
    console.log(`Active → ${r.activeAccountId}`);
  }));

workspaces
  .command('services')
  .description('Print the opt-in service list (huudis + enabled Forjio products).')
  .action(wrap(async () => {
    const r = await rest<{ services: string[] }>('GET', '/api/v1/account/services');
    for (const s of r.services) console.log(s);
  }));

workspaces
  .command('enable-services <services...>')
  .description('Opt this workspace into one or more Forjio services.')
  .action(wrap(async (services: string[]) => {
    const r = await rest<{ services: string[] }>(
      'POST', '/api/v1/account/services/enable', { services },
    );
    console.log(`Now enabled: ${r.services.join(', ')}`);
  }));

workspaces
  .command('disable-services <services...>')
  .description('Opt this workspace out of one or more services (huudis is always baseline).')
  .action(wrap(async (services: string[]) => {
    const r = await rest<{ services: string[] }>(
      'POST', '/api/v1/account/services/disable', { services },
    );
    console.log(`Still enabled: ${r.services.join(', ')}`);
  }));
