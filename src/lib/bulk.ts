import { readFileSync } from 'node:fs';

/**
 * Shared scaffolding for bulk CLI commands.
 *
 * Backend has no bulk endpoints — we just loop the per-item REST call and
 * surface progress + a per-item result array so `--json` is scriptable.
 */

export interface BulkResult {
  id: string;
  status: 'ok' | 'error';
  message?: string;
}

export interface BulkOptions {
  ids?: string;
  fromFile?: string;
  fromStdin?: boolean;
  json?: boolean;
}

/**
 * Resolve the list of IDs from `--ids`, `--from-file`, or `--from-stdin`.
 * Exits with a clear error when none are provided and stdin isn't piped.
 */
export async function resolveIds(opts: BulkOptions): Promise<string[]> {
  // 1. Explicit csv flag wins.
  if (opts.ids && opts.ids.trim()) {
    return splitIds(opts.ids);
  }
  // 2. File path.
  if (opts.fromFile) {
    const raw = readFileSync(opts.fromFile, 'utf8');
    return splitIds(raw);
  }
  // 3. Explicit stdin OR implicit (neither flag given AND stdin is piped).
  if (opts.fromStdin || (!opts.ids && !opts.fromFile && !process.stdin.isTTY)) {
    const raw = await readStdin();
    const ids = splitIds(raw);
    if (ids.length === 0) {
      throw new Error('No IDs provided on stdin.');
    }
    return ids;
  }
  throw new Error('No IDs provided. Pass --ids <csv>, --from-file <path>, or pipe IDs on stdin.');
}

function splitIds(raw: string): string[] {
  return raw
    .split(/[,\n\r]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let buf = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk: string) => { buf += chunk; });
    process.stdin.on('end', () => resolve(buf));
    process.stdin.on('error', reject);
  });
}

/**
 * Run `op` against each id, printing progress to stderr (so stdout stays
 * machine-readable when `--json` is set). Returns a results array suitable
 * for both human and JSON output. Exits non-zero is the caller's job —
 * inspect the returned array.
 */
export async function runBulk(
  ids: string[],
  op: (id: string) => Promise<void>,
  opts: { json?: boolean; verbAction: string } = { verbAction: 'processed' },
): Promise<BulkResult[]> {
  const results: BulkResult[] = [];
  const total = ids.length;
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i]!;
    const prefix = `[${i + 1}/${total}]`;
    try {
      await op(id);
      results.push({ id, status: 'ok' });
      if (!opts.json) console.log(`${prefix} ${opts.verbAction} ${id}`);
    } catch (e) {
      const message = (e as Error).message ?? String(e);
      results.push({ id, status: 'error', message });
      if (!opts.json) console.error(`${prefix} FAILED ${id}: ${message}`);
    }
  }
  return results;
}

/**
 * Render the final summary. Returns the exit code the caller should use.
 */
export function finishBulk(results: BulkResult[], opts: { json?: boolean }): number {
  if (opts.json) {
    console.log(JSON.stringify(results, null, 2));
  } else {
    const ok = results.filter((r) => r.status === 'ok').length;
    const failed = results.length - ok;
    if (failed === 0) {
      console.log(`Done. ${ok}/${results.length} succeeded.`);
    } else {
      console.error(`Done with errors. ${ok} ok, ${failed} failed (of ${results.length}).`);
    }
  }
  return results.some((r) => r.status === 'error') ? 1 : 0;
}
