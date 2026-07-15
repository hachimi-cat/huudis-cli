import { describe, it, expect, vi, afterEach } from 'vitest';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveIds, runBulk, finishBulk } from '../lib/bulk.js';

afterEach(() => { vi.restoreAllMocks(); });

describe('resolveIds', () => {
  it('splits --ids csv', async () => {
    const ids = await resolveIds({ ids: 'mem_a, mem_b ,mem_c' });
    expect(ids).toEqual(['mem_a', 'mem_b', 'mem_c']);
  });

  it('reads --from-file (newline separated)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bulk-test-'));
    const path = join(dir, 'ids.txt');
    writeFileSync(path, 'mem_x\nmem_y\n\nmem_z\n');
    try {
      const ids = await resolveIds({ fromFile: path });
      expect(ids).toEqual(['mem_x', 'mem_y', 'mem_z']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('errors clearly when nothing is provided and stdin is a TTY', async () => {
    const orig = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
    try {
      await expect(resolveIds({})).rejects.toThrow(/No IDs provided/);
    } finally {
      if (orig) Object.defineProperty(process.stdin, 'isTTY', orig);
    }
  });
});

describe('runBulk', () => {
  it('records ok for each successful op', async () => {
    const op = vi.fn().mockResolvedValue(undefined);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const results = await runBulk(['a', 'b', 'c'], op, { json: false, verbAction: 'removed' });
    expect(op).toHaveBeenCalledTimes(3);
    expect(results).toEqual([
      { id: 'a', status: 'ok' },
      { id: 'b', status: 'ok' },
      { id: 'c', status: 'ok' },
    ]);
    expect(logSpy).toHaveBeenCalledWith('[1/3] removed a');
    expect(logSpy).toHaveBeenCalledWith('[3/3] removed c');
  });

  it('captures the per-item error and continues', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const op = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(undefined);
    const results = await runBulk(['a', 'b', 'c'], op, { json: false, verbAction: 'processed' });
    expect(results).toEqual([
      { id: 'a', status: 'ok' },
      { id: 'b', status: 'error', message: 'boom' },
      { id: 'c', status: 'ok' },
    ]);
  });

  it('does not print progress when --json is set', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const op = vi.fn().mockResolvedValue(undefined);
    await runBulk(['a'], op, { json: true, verbAction: 'removed' });
    expect(logSpy).not.toHaveBeenCalled();
  });
});

describe('finishBulk', () => {
  it('returns 0 when all ok and prints summary', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const code = finishBulk([{ id: 'a', status: 'ok' }, { id: 'b', status: 'ok' }], { json: false });
    expect(code).toBe(0);
    expect(logSpy).toHaveBeenCalledWith('Done. 2/2 succeeded.');
  });

  it('returns 1 on any failure', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const code = finishBulk([{ id: 'a', status: 'ok' }, { id: 'b', status: 'error', message: 'x' }], { json: false });
    expect(code).toBe(1);
  });

  it('emits a JSON array when --json is set', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const results = [{ id: 'a', status: 'ok' as const }, { id: 'b', status: 'error' as const, message: 'x' }];
    finishBulk(results, { json: true });
    expect(logSpy).toHaveBeenCalledTimes(1);
    const out = logSpy.mock.calls[0]![0] as string;
    expect(JSON.parse(out)).toEqual(results);
  });
});
