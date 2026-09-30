import { readFileSync } from 'node:fs';
import { Command } from 'commander';
import { auth } from './commands/auth.js';
import { iam } from './commands/iam.js';
import { account } from './commands/account.js';
import { audit } from './commands/audit.js';
import { workspaces } from './commands/workspaces.js';
import { members } from './commands/members.js';
import { endUsers } from './commands/end-users.js';
import { oidcClients } from './commands/oidc-clients.js';
import { identityProviders } from './commands/identity-providers.js';
import { assumedSessions } from './commands/assumed-sessions.js';
import { connectedApps } from './commands/connected-apps.js';
import { webhooks } from './commands/webhooks.js';
import { mfa } from './commands/mfa.js';
import { consents } from './commands/consents.js';
import { billing } from './commands/billing.js';
import { buildApiCommand } from './commands/api.generated.js';

const brand = process.env.FORJIO_BRAND ?? 'huudis';
// The version is the package's own (package.json ships with the CLI, one level up from
// dist/ and src/).
const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };

const program = new Command()
  .name(brand)
  .description(`CLI for ${brand} — part of the Forjio commerce suite.`)
  .version(version);

program.addCommand(auth);
program.addCommand(workspaces);
program.addCommand(members);
program.addCommand(endUsers);
program.addCommand(iam);
program.addCommand(oidcClients);
program.addCommand(identityProviders);
program.addCommand(assumedSessions);
program.addCommand(connectedApps);
program.addCommand(webhooks);
program.addCommand(account);
program.addCommand(audit);
program.addCommand(mfa);
program.addCommand(consents);
program.addCommand(billing);
// Every route of the API, one command each (generated from the API spec: scripts/apigen.sh)
program.addCommand(buildApiCommand());

program.parseAsync(process.argv).catch((e) => {
  console.error(e);
  process.exit(1);
});
