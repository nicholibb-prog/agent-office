// One sampler, JSONL history, retention, and the in-flight guard.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { mtDate } from '../src/shared/ops.js';
import { opsBag, opsSkipped, opsTick, readOpsHistory, startOpsSampler } from '../src/server/ops/sampler.js';
import type { OpsAdapter } from '../src/server/ops/adapters.js';

const mem = () => ({ total: 1000, free: 464, load: [0, 0, 0] as const, rss: 118 * 1048576 });

function dirOf(prefix: string) {
  return mkdtempSync(path.join(tmpdir(), prefix));
}

function host(dataDir: string) {
  return { cfg: { dataDir }, building: { list: () => [] as { dir: string }[] } };
}

test('two ticks append two private history lines and omit not-wired metrics', async () => {
  const dir = dirOf('ao-ops-hist-');
  const ctx = host(dir);
  const stop = startOpsSampler(ctx, { env: { OPS_ON: '1' }, auto: false, ps: async () => [], mem });
  try {
    await opsTick(ctx);
    await opsTick(ctx);
    const file = path.join(dir, 'ops', 'history', `${mtDate(Date.now())}.jsonl`);
    const lines = readFileSync(file, 'utf8').trim().split('\n');
    assert.equal(lines.length, 2);
    const row = JSON.parse(lines[0]!) as Record<string, unknown>;
    assert.equal(typeof row.t, 'number');
    assert.equal(row.ramPct, 53.6);
    assert.equal(row.officeRssMB, 118);
    assert.equal('grokWeeklyPct' in row, false);
    assert.equal('dsTurnsToday' in row, false);
    assert.equal('okkinJobs' in row, false);
    assert.equal(lines[0]!.includes('"grokWeeklyPct":0'), false);
    if (process.platform !== 'win32') {
      assert.equal(statSync(file).mode & 0o777, 0o600);
      assert.equal(statSync(path.dirname(file)).mode & 0o777, 0o700);
    }
  } finally {
    stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a stale usage metric is omitted from the history line', async () => {
  const dir = dirOf('ao-ops-stale-');
  const ctx = host(dir);
  const now = Date.parse('2026-11-09T16:32:00Z');
  mkdirSync(path.join(dir, 'ops'), { recursive: true });
  writeFileSync(path.join(dir, 'ops', 'usage-snapshot.json'), JSON.stringify({
    schema: 1,
    capturedAt: new Date(now - 15 * 3600_000).toISOString(),
    grokWeekly: { pct: 40.1, resetsAt: '2026-11-10T18:32:00Z' },
    onDemand: { usedUsd: 30.11, limitUsd: 30, resetsAt: '2026-11-24T19:32:00Z' },
  }));
  const stop = startOpsSampler(ctx, { env: { OPS_ON: '1' }, auto: false, now: () => now, ps: async () => [], mem });
  try {
    await opsTick(ctx);
    const file = path.join(dir, 'ops', 'history', '2026-11-09.jsonl');
    const row = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
    assert.equal('grokWeeklyPct' in row, false);
    assert.equal('onDemandUsd' in row, false);
  } finally {
    stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a new day rotates the file, drops a 31-day-old log, and keeps other names', async () => {
  const dir = dirOf('ao-ops-roll-');
  const ctx = host(dir);
  let now = Date.parse('2026-10-01T18:00:00Z');
  const stop = startOpsSampler(ctx, { env: { OPS_ON: '1', OPS_HISTORY_DAYS: '30' }, auto: false, now: () => now, ps: async () => [], mem });
  try {
    await opsTick(ctx);
    const hist = path.join(dir, 'ops', 'history');
    writeFileSync(path.join(hist, 'notes.txt'), 'keep');
    writeFileSync(path.join(hist, 'foo.txt'), 'keep');
    assert.equal(existsSync(path.join(hist, '2026-10-01.jsonl')), true);
    now = Date.parse('2026-11-01T18:00:00Z');
    await opsTick(ctx);
    assert.equal(existsSync(path.join(hist, '2026-10-01.jsonl')), false);
    assert.equal(existsSync(path.join(hist, '2026-11-01.jsonl')), true);
    assert.equal(readFileSync(path.join(hist, 'notes.txt'), 'utf8'), 'keep');
    assert.equal(existsSync(path.join(hist, 'foo.txt')), true);
  } finally {
    stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a history directory that is a symlink outside is not written, and the refusal is logged once', async (t) => {
  const dir = dirOf('ao-ops-symlink-');
  const outside = dirOf('ao-ops-away-');
  const ctx = host(dir);
  const logs: string[] = [];
  mkdirSync(path.join(dir, 'ops'));
  try {
    symlinkSync(outside, path.join(dir, 'ops', 'history'));
  } catch (err) {
    rmSync(dir, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
    if ((err as NodeJS.ErrnoException).code === 'EPERM') return t.skip('symlink not permitted');
    throw err;
  }
  const stop = startOpsSampler(ctx, { env: { OPS_ON: '1' }, auto: false, log: (message) => logs.push(message), ps: async () => [], mem });
  try {
    await opsTick(ctx);
    await opsTick(ctx);
    assert.equal(logs.length, 1);
    assert.match(logs[0]!, /refused/);
    assert.deepEqual(readdirSync(outside), []);
  } finally {
    stop();
    rmSync(dir, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test('a slow adapter is cut off at 2s and an overlapping tick is skipped', async () => {
  const dir = dirOf('ao-ops-slow-');
  const ctx = host(dir);
  let calls = 0;
  const adapters: OpsAdapter[] = [{
    id: 'slow',
    run: () => new Promise((resolve) => {
      calls += 1;
      const timer = setTimeout(() => resolve({ id: 'slow', state: 'ok' }), 3000);
      timer.unref();
    }),
  }];
  const stop = startOpsSampler(ctx, { env: { OPS_ON: '1' }, auto: false, adapters });
  try {
    const first = opsTick(ctx);
    await opsTick(ctx);
    assert.equal(calls, 1);
    assert.ok(opsSkipped(ctx) >= 1);
    await first;
    assert.equal(opsBag(ctx)?.latest?.tiles.slow?.state, 'not-wired');
    assert.equal(opsBag(ctx)?.latest?.tiles.slow?.reason, 'timed out');
  } finally {
    stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a new sampler reads history written before it started', async () => {
  const dir = dirOf('ao-ops-restart-');
  const first = host(dir);
  const stop = startOpsSampler(first, { env: { OPS_ON: '1' }, auto: false, ps: async () => [], mem });
  try {
    await opsTick(first);
    stop();
    const second = host(dir);
    const stop2 = startOpsSampler(second, { env: { OPS_ON: '1' }, auto: false, ps: async () => [], mem });
    try {
      const points = readOpsHistory(dir, 'ramPct', 0, Date.now() + 1000);
      assert.ok(points.length >= 1);
      assert.equal(points[0]![1], 53.6);
      assert.ok(points.every((point, i) => i === 0 || point[0] >= points[i - 1]![0]));
    } finally {
      stop2();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
