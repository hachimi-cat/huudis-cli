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

const brand = process.env.FORJIO_BRAND ?? 'huudis';

const program = new Command()
  .name(brand)
  .description(`CLI for ${brand} — part of the Forjio commerce suite.`)
  .version('0.5.0');

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

program.parseAsync(process.argv).catch((e) => {
  console.error(e);
  process.exit(1);
});
