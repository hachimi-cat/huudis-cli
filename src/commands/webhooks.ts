import { Command } from 'commander';
import { loadSession } from '../lib/session.js';

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

function pickData(out: unknown): unknown {
  return (out as any)?.data ?? out;
}

export const webhooks = new Command('webhooks').description('Manage outbound webhook subscriptions.');

webhooks
  .command('list')
  .description('List webhook subscriptions in the active workspace.')
  .action(async () => {
    try {
      const out = await api('GET', '/api/v1/account/webhook-subscriptions');
      console.log(JSON.stringify(pickData(out), null, 2));
    } catch (e) {
      console.error(String((e as Error).message));
      process.exit(1);
    }
  });

webhooks
  .command('create')
  .description('Create a subscription. Prints the signing secret once — store it now.')
  .requiredOption('--url <url>', 'https://... receiver endpoint')
  .requiredOption('--events <types>', 'comma-separated event types, e.g. huudis.user.created.v1,huudis.session.created.v1')
  .option('--description <text>', 'human-readable label')
  .option('--inactive', 'create paused (events accumulate but no deliveries)')
  .action(async (opts) => {
    try {
      const events: string[] = String(opts.events).split(',').map((s) => s.trim()).filter(Boolean);
      const out = await api('POST', '/api/v1/account/webhook-subscriptions', {
        url: opts.url,
        events,
        description: opts.description,
        active: !opts.inactive,
      });
      console.log(JSON.stringify(pickData(out), null, 2));
    } catch (e) {
      console.error(String((e as Error).message));
      process.exit(1);
    }
  });

webhooks
  .command('show <id>')
  .description('Show a single subscription by id.')
  .action(async (id: string) => {
    try {
      const out = await api('GET', `/api/v1/account/webhook-subscriptions/${encodeURIComponent(id)}`);
      console.log(JSON.stringify(pickData(out), null, 2));
    } catch (e) {
      console.error(String((e as Error).message));
      process.exit(1);
    }
  });

webhooks
  .command('update <id>')
  .description('Update url, events, description, or active flag.')
  .option('--url <url>')
  .option('--events <types>', 'comma-separated replacement list')
  .option('--description <text>')
  .option('--active <bool>', 'true or false')
  .action(async (id: string, opts) => {
    try {
      const body: Record<string, unknown> = {};
      if (opts.url) body.url = opts.url;
      if (opts.events) body.events = String(opts.events).split(',').map((s) => s.trim()).filter(Boolean);
      if (opts.description !== undefined) body.description = opts.description || null;
      if (opts.active !== undefined) body.active = opts.active === 'true';
      const out = await api('PATCH', `/api/v1/account/webhook-subscriptions/${encodeURIComponent(id)}`, body);
      console.log(JSON.stringify(pickData(out), null, 2));
    } catch (e) {
      console.error(String((e as Error).message));
      process.exit(1);
    }
  });

webhooks
  .command('delete <id>')
  .description('Delete a subscription permanently.')
  .action(async (id: string) => {
    try {
      await api('DELETE', `/api/v1/account/webhook-subscriptions/${encodeURIComponent(id)}`);
      console.log('deleted');
    } catch (e) {
      console.error(String((e as Error).message));
      process.exit(1);
    }
  });

webhooks
  .command('rotate-secret <id>')
  .description('Rotate the signing secret. Old secret stops working immediately.')
  .action(async (id: string) => {
    try {
      const out = await api('POST', `/api/v1/account/webhook-subscriptions/${encodeURIComponent(id)}/rotate-secret`);
      console.log(JSON.stringify(pickData(out), null, 2));
    } catch (e) {
      console.error(String((e as Error).message));
      process.exit(1);
    }
  });

webhooks
  .command('deliveries <subscription-id>')
  .description('List recent deliveries for a subscription.')
  .option('--status <status>', 'pending | delivered | failed | dead')
  .action(async (id: string, opts) => {
    try {
      const q = opts.status ? `?status=${encodeURIComponent(opts.status)}` : '';
      const out = await api('GET', `/api/v1/account/webhook-subscriptions/${encodeURIComponent(id)}/deliveries${q}`);
      console.log(JSON.stringify(pickData(out), null, 2));
    } catch (e) {
      console.error(String((e as Error).message));
      process.exit(1);
    }
  });

webhooks
  .command('replay <delivery-id>')
  .description('Re-attempt a single failed delivery.')
  .action(async (id: string) => {
    try {
      const out = await api('POST', `/api/v1/account/webhook-subscriptions/deliveries/${encodeURIComponent(id)}/replay`);
      console.log(JSON.stringify(pickData(out), null, 2));
    } catch (e) {
      console.error(String((e as Error).message));
      process.exit(1);
    }
  });

webhooks
  .command('catalog')
  .description('Print the catalog of event types this Huudis instance emits.')
  .action(async () => {
    try {
      const out = await api('GET', '/api/v1/account/webhook-subscriptions/events/catalog');
      console.log(JSON.stringify(pickData(out), null, 2));
    } catch (e) {
      console.error(String((e as Error).message));
      process.exit(1);
    }
  });
