import { Command } from 'commander';
import chalk from 'chalk';
import open from 'open';
import {
  startDeviceFlow,
  pollDeviceToken,
  refreshAccessToken,
  fetchUserinfo,
  HuudisApiError,
} from '../lib/api.js';
import { saveSession, loadSession, clearSession, isAccessTokenStale, type StoredSession } from '../lib/session.js';

/**
 * `huudis auth login` — RFC 8628 device authorization grant.
 *
 * Steps: display user_code, open verification_uri in a browser, poll the
 * token endpoint at `interval` seconds until the user approves, store the
 * tokens under ~/.huudis/session.json.
 */

function issuerUrl(): string {
  return process.env.HUUDIS_ISSUER ?? 'https://huudis.com';
}

function clientIdForCli(): string {
  return process.env.HUUDIS_CLI_CLIENT_ID ?? 'huudis-cli';
}

const DEFAULT_SCOPE = 'openid profile email huudis:admin';

export const auth = new Command('auth').description('Authenticate against Huudis');

auth
  .command('login')
  .description('Sign in via OIDC device flow')
  .option('--scope <scope>', 'OAuth scope string', DEFAULT_SCOPE)
  .option('--no-browser', 'Skip automatic browser launch — print the URL only')
  .action(async (opts: { scope?: string; browser?: boolean }) => {
    const issuer = issuerUrl();
    const clientId = clientIdForCli();
    const scope = opts.scope ?? DEFAULT_SCOPE;
    try {
      const init = await startDeviceFlow({ issuer, clientId, scope });
      console.log(chalk.bold(`\nEnter this code at ${chalk.cyan(init.verification_uri)}:\n`));
      console.log(`  ${chalk.bold.green(init.user_code)}\n`);
      console.log(chalk.dim(`Or open: ${init.verification_uri_complete}`));
      if (opts.browser !== false) {
        await open(init.verification_uri_complete).catch(() => { /* user sees URL */ });
      }
      console.log(chalk.dim(`\nWaiting for approval (expires in ${Math.floor(init.expires_in / 60)} min)…`));

      const deadline = Date.now() + init.expires_in * 1000;
      let interval = init.interval;
      while (Date.now() < deadline) {
        await sleep(interval * 1000);
        const res = await pollDeviceToken({ issuer, clientId, deviceCode: init.device_code });
        if (res.ready) {
          const s: StoredSession = {
            accessToken: res.tokens.access_token,
            refreshToken: res.tokens.refresh_token,
            idToken: res.tokens.id_token,
            accessTokenExpiresAt: new Date(Date.now() + res.tokens.expires_in * 1000).toISOString(),
            scope: res.tokens.scope,
            issuer,
            clientId,
          };
          saveSession(s);
          const info = await fetchUserinfo({ issuer, accessToken: s.accessToken });
          console.log(chalk.green(`\n✓ Signed in as ${info.email ?? info.sub}.`));
          return;
        }
        if (res.error === 'authorization_pending') continue;
        if (res.error === 'slow_down') { interval = interval + 5; continue; }
        if (res.error === 'access_denied') { console.error(chalk.red('Access denied.')); process.exit(1); }
        if (res.error === 'expired_token') { console.error(chalk.red('Device code expired — run `huudis auth login` again.')); process.exit(1); }
        console.error(chalk.red(`Unexpected: ${res.error}`));
        process.exit(1);
      }
      console.error(chalk.red('Timed out waiting for approval.'));
      process.exit(1);
    } catch (e) {
      errExit(e);
    }
  });

auth
  .command('whoami')
  .description('Show the currently signed-in identity')
  .action(async () => {
    const s = loadSession();
    if (!s) {
      console.log(chalk.yellow('Not signed in. Run `huudis auth login`.'));
      return;
    }
    try {
      let access = s.accessToken;
      if (isAccessTokenStale(s)) {
        const refreshed = await refreshAccessToken({ issuer: s.issuer, clientId: s.clientId, refreshToken: s.refreshToken });
        saveSession({
          ...s,
          accessToken: refreshed.access_token,
          refreshToken: refreshed.refresh_token,
          idToken: refreshed.id_token,
          accessTokenExpiresAt: new Date(Date.now() + refreshed.expires_in * 1000).toISOString(),
        });
        access = refreshed.access_token;
      }
      const info = await fetchUserinfo({ issuer: s.issuer, accessToken: access });
      console.log(`Issuer:      ${s.issuer}`);
      console.log(`User ID:     ${info.sub}`);
      console.log(`Email:       ${info.email}${info.email_verified ? ' (verified)' : ''}`);
      if (info.name) console.log(`Name:        ${info.name}`);
      if (info.locale) console.log(`Locale:      ${info.locale}`);
      console.log(`Scopes:      ${s.scope}`);
      console.log(`Access TTL:  ${new Date(s.accessTokenExpiresAt).toLocaleString()}`);
    } catch (e) {
      if (e instanceof HuudisApiError && /invalid_grant|unauthorized/i.test(e.error)) {
        clearSession();
        console.error(chalk.yellow('Session invalid or expired. Run `huudis auth login` again.'));
        process.exit(1);
      }
      errExit(e);
    }
  });

auth
  .command('logout')
  .description('Clear the local session')
  .action(() => {
    const s = loadSession();
    if (!s) {
      console.log(chalk.dim('No session to clear.'));
      return;
    }
    clearSession();
    console.log(chalk.green('✓ Signed out.'));
  });

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function errExit(e: unknown): never {
  if (e instanceof HuudisApiError) console.error(chalk.red(`Error: ${e.message}`));
  else console.error(chalk.red(`Error: ${(e as Error).message}`));
  process.exit(1);
}
