import { Command } from 'commander';
import { rest, wrap, printJson } from '../lib/rest.js';
import readline from 'node:readline';

/**
 * `huudis billing ...` — merchant billing for the current workspace:
 * plan info, usage snapshot, invoices, hosted checkout, cancellation.
 *
 * Mirrors the `client.billing.*` namespace in `@forjio/huudis-node`,
 * but called through the existing rest.ts helper rather than the SDK
 * (the rest of this CLI already shapes itself around rest.ts; no point
 * dragging in `@forjio/huudis-node` for one command group).
 */

interface BillingSummary {
  plan: { id: string; name: string; price: { amount: number; currency: string; interval: 'month' | 'year' } | null };
  status: 'active' | 'trialing' | 'past_due' | 'canceled' | 'incomplete';
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  usage: { metric: string; used: number; limit: number | null }[];
}

interface BillingPlan {
  id: string;
  name: string;
  description: string | null;
  price: { amount: number; currency: string; interval: 'month' | 'year' } | null;
  features: string[];
}

interface BillingUsage {
  periodStart: string;
  periodEnd: string;
  metrics: { metric: string; used: number; limit: number | null; unit: string | null }[];
}

interface Invoice {
  id: string;
  number: string | null;
  status: 'paid' | 'open' | 'void' | 'uncollectible' | 'draft';
  total: { amount: number; currency: string };
  issuedAt: string;
  paidAt: string | null;
  hostedInvoiceUrl: string | null;
}

interface CheckoutResponse {
  url: string;
  sessionId?: string;
}

interface CancelResponse {
  status: string;
  effectiveAt: string | null;
  cancelAtPeriodEnd: boolean;
}

function fmtMoney(m: { amount: number; currency: string } | null | undefined): string {
  if (!m) return '—';
  // Amounts are minor units (cents) by convention across the Forjio stack.
  const major = (m.amount / 100).toFixed(2);
  return `${m.currency.toUpperCase()} ${major}`;
}

function confirmTty(prompt: string): Promise<boolean> {
  return new Promise((resolve) => {
    if (!process.stdin.isTTY) {
      // Non-interactive: refuse rather than guess.
      resolve(false);
      return;
    }
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(/^y(es)?$/i.test(answer.trim()));
    });
  });
}

export const billing = new Command('billing')
  .description('Plan, usage, invoices, and checkout for the current Huudis workspace.');

// ─── summary ──────────────────────────────────────────────────────────────

billing
  .command('summary')
  .description('Show the current plan + a usage snapshot.')
  .option('--json', 'print raw JSON instead of a summary')
  .action(wrap(async (opts: { json?: boolean }) => {
    const s = await rest<BillingSummary>('GET', '/api/v1/account/billing');
    if (opts.json) { printJson(s); return; }
    console.log(`plan:     ${s.plan?.name ?? '?'}  (${s.plan?.id ?? '?'})`);
    console.log(`price:    ${fmtMoney(s.plan?.price ?? null)}${s.plan?.price?.interval ? ` / ${s.plan.price.interval}` : ''}`);
    console.log(`status:   ${s.status}${s.cancelAtPeriodEnd ? '  (cancels at period end)' : ''}`);
    if (s.currentPeriodEnd) console.log(`renews:   ${s.currentPeriodEnd.slice(0, 10)}`);
    if (s.usage && s.usage.length) {
      console.log('usage:');
      for (const u of s.usage) {
        const cap = u.limit == null ? '∞' : String(u.limit);
        console.log(`  ${u.metric.padEnd(20)} ${String(u.used).padStart(10)} / ${cap}`);
      }
    }
  }));

// ─── plans ────────────────────────────────────────────────────────────────

billing
  .command('plans')
  .description('List plans you can switch to.')
  .option('--json', 'print raw JSON instead of a summary')
  .action(wrap(async (opts: { json?: boolean }) => {
    const rows = await rest<BillingPlan[]>('GET', '/api/v1/account/billing/plans');
    if (opts.json) { printJson(rows); return; }
    if (!rows || rows.length === 0) { console.log('(no plans available)'); return; }
    for (const p of rows) {
      const price = fmtMoney(p.price);
      const interval = p.price?.interval ? ` / ${p.price.interval}` : '';
      console.log(`${p.id.padEnd(20)} ${p.name.padEnd(24)} ${price}${interval}`);
      if (p.description) console.log(`  ${p.description}`);
      if (p.features?.length) {
        for (const f of p.features) console.log(`    • ${f}`);
      }
    }
  }));

// ─── usage ────────────────────────────────────────────────────────────────

billing
  .command('usage')
  .description('Current period usage by metric.')
  .option('--json', 'print raw JSON instead of a summary')
  .action(wrap(async (opts: { json?: boolean }) => {
    const u = await rest<BillingUsage>('GET', '/api/v1/account/billing/usage');
    if (opts.json) { printJson(u); return; }
    console.log(`period: ${u.periodStart.slice(0, 10)} → ${u.periodEnd.slice(0, 10)}`);
    if (!u.metrics || u.metrics.length === 0) { console.log('(no usage recorded)'); return; }
    for (const m of u.metrics) {
      const cap = m.limit == null ? '∞' : String(m.limit);
      const unit = m.unit ? ` ${m.unit}` : '';
      console.log(`  ${m.metric.padEnd(20)} ${String(m.used).padStart(10)} / ${cap}${unit}`);
    }
  }));

// ─── invoices ─────────────────────────────────────────────────────────────

billing
  .command('invoices')
  .description('List recent invoices.')
  .option('--limit <n>', 'max invoices to return (default 20)', (v) => parseInt(v, 10))
  .option('--json', 'print raw JSON instead of a summary')
  .action(wrap(async (opts: { limit?: number; json?: boolean }) => {
    const q = opts.limit ? `?limit=${encodeURIComponent(String(opts.limit))}` : '';
    const rows = await rest<Invoice[]>('GET', `/api/v1/account/billing/invoices${q}`);
    if (opts.json) { printJson(rows); return; }
    if (!rows || rows.length === 0) { console.log('(no invoices)'); return; }
    for (const inv of rows) {
      const number = inv.number ?? inv.id;
      const paid = inv.paidAt ? inv.paidAt.slice(0, 10) : '—';
      console.log(`${number.padEnd(18)}  ${inv.status.padEnd(14)}  ${fmtMoney(inv.total).padEnd(14)}  issued ${inv.issuedAt.slice(0, 10)}  paid ${paid}`);
      if (inv.hostedInvoiceUrl) console.log(`  ${inv.hostedInvoiceUrl}`);
    }
  }));

// ─── checkout ─────────────────────────────────────────────────────────────

billing
  .command('checkout <plan-id>')
  .description('Start hosted checkout for a plan. Prints the URL — open it in a browser.')
  .option('--success-url <url>', 'URL to return to after successful payment')
  .option('--cancel-url <url>', 'URL to return to if the user cancels')
  .action(wrap(async (planId: string, opts: { successUrl?: string; cancelUrl?: string }) => {
    const body: Record<string, unknown> = { planId };
    if (opts.successUrl) body.successUrl = opts.successUrl;
    if (opts.cancelUrl) body.cancelUrl = opts.cancelUrl;
    const r = await rest<CheckoutResponse>('POST', '/api/v1/account/billing/checkout', body);
    console.log(r.url);
  }));

// ─── cancel ───────────────────────────────────────────────────────────────

billing
  .command('cancel')
  .description('Cancel the current subscription (cancels at period end by default).')
  .option('--yes', 'skip the TTY confirmation prompt')
  .option('--immediate', 'cancel immediately instead of at period end')
  .action(wrap(async (opts: { yes?: boolean; immediate?: boolean }) => {
    if (!opts.yes) {
      const ok = await confirmTty('Cancel the current subscription? [y/N] ');
      if (!ok) {
        console.error('Aborted. (Use --yes to skip the prompt in non-TTY contexts.)');
        process.exit(1);
      }
    }
    const body: Record<string, unknown> = {};
    if (opts.immediate) body.immediate = true;
    const r = await rest<CancelResponse>('POST', '/api/v1/account/billing/cancel', body);
    console.log(`status: ${r.status}${r.cancelAtPeriodEnd ? '  (cancels at period end)' : ''}`);
    if (r.effectiveAt) console.log(`effective: ${r.effectiveAt}`);
  }));
