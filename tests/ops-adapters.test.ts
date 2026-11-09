// Ops adapters: missing files, staleness, path refusal, scrubbed secrets. No network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { tileById, type OpsEnv } from '../src/server/ops/adapters.js';
import { safeRead } from '../src/server/ops/safe-path.js';
import { RAM_IDLE_PCT, RAM_STOP_PCT, RAM_WARN_PCT, ramBand } from '../src/shared/ops.js';

const NOW = Date.parse('2026-11-09T16:32:00Z');

function env(dataDir: string, over: Partial<OpsEnv> = {}): OpsEnv {
  return {
    dataDir,
    floorDirs: [],
    routerOn: false,
    capUsd: 3,
    now: NOW,
    ps: async () => [],
    mem: { total: 1000, free: 464, load: [0, 0, 0], rss: 118 * 1048576 },
    ...over,
  };
}

function tmp(prefix: string) {
  return mkdtempSync(path.join(tmpdir(), prefix));
}

function usage(dir: string, ageH: number, over: Record<string, unknown> = {}) {
  const ops = path.join(dir, 'ops');
  mkdirSync(ops, { recursive: true });
  const body = {
    schema: 1,
    capturedAt: new Date(NOW - ageH * 3600_000).toISOString(),
    source: 'CheckSubscriptionUsage',
    grokWeekly: { pct: 40.1, resetsAt: '2026-11-10T18:32:00Z' },
    onDemand: { usedUsd: 30.11, limitUsd: 30, resetsAt: '2026-11-24T19:32:00Z' },
    ...over,
  };
  writeFileSync(path.join(ops, 'usage-snapshot.json'), JSON.stringify(body));
}

test('a missing source file is not wired, with reason missing', async () => {
  const dir = tmp('ao-ops-miss-');
  try {
    for (const id of ['grok.usage', 'projects', 'crew', 'deepseek', 'okkin', 'notion.loop']) {
      const tile = await tileById(id, env(dir));
      assert.equal(tile.state, 'not-wired', id);
      assert.equal(tile.reason, 'missing', id);
      assert.equal(tile.data, undefined, id);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('usage snapshot: 15h is stale with values kept, 1h is ok, a string pct is malformed', async () => {
  const dir = tmp('ao-ops-usage-');
  try {
    usage(dir, 15);
    const stale = await tileById('grok.usage', env(dir));
    assert.equal(stale.state, 'stale');
    assert.ok(Math.abs((stale.ageSec ?? 0) - 54_000) < 2, String(stale.ageSec));
    assert.equal((stale.data as { weeklyPct: number }).weeklyPct, 40.1);
    usage(dir, 1);
    const fresh = await tileById('grok.usage', env(dir));
    assert.equal(fresh.state, 'ok');
    usage(dir, 1, { grokWeekly: { pct: '40', resetsAt: '2026-11-10T18:32:00Z' } });
    const bad = await tileById('grok.usage', env(dir));
    assert.equal(bad.state, 'not-wired');
    assert.equal(bad.reason, 'malformed');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the 9:32 snapshot is over the on-demand limit', async () => {
  const dir = tmp('ao-ops-over-');
  try {
    usage(dir, 0);
    const tile = await tileById('grok.usage', env(dir));
    const data = tile.data as { over: boolean; onDemandUsd: number; onDemandLimitUsd: number; weeklyPct: number };
    assert.equal(data.weeklyPct, 40.1);
    assert.equal(data.onDemandUsd, 30.11);
    assert.equal(data.onDemandLimitUsd, 30);
    assert.equal(data.over, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('symlink escapes are refused and a symlink inside the root is allowed', async (t) => {
  const root = tmp('ao-ops-link-');
  const outside = tmp('ao-ops-out-');
  try {
    mkdirSync(path.join(root, 'ops'), { recursive: true });
    writeFileSync(path.join(outside, 'secret.json'), JSON.stringify({ schema: 1, token: 'ghp_shouldnotappear' }));
    try {
      symlinkSync(path.join(outside, 'secret.json'), path.join(root, 'ops', 'usage-snapshot.json'));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EPERM') return t.skip('symlink not permitted');
      throw err;
    }
    const escaped = await tileById('grok.usage', env(root));
    assert.equal(escaped.state, 'not-wired');
    assert.equal(escaped.reason, 'path refused');
    rmSync(path.join(root, 'ops'), { recursive: true, force: true });
    symlinkSync(outside, path.join(root, 'ops'));
    writeFileSync(path.join(outside, 'usage-snapshot.json'), '{"schema":1}');
    const dirEscape = await tileById('grok.usage', env(root));
    assert.equal(dirEscape.reason, 'path refused');
    rmSync(path.join(root, 'ops'), { force: true });
    mkdirSync(path.join(root, 'ops'));
    const real = { schema: 1, capturedAt: new Date(NOW).toISOString(), grokWeekly: { pct: 10, resetsAt: '2026-11-10T18:32:00Z' }, onDemand: { usedUsd: 1, limitUsd: 30, resetsAt: '2026-11-24T19:32:00Z' } };
    writeFileSync(path.join(root, 'ops', 'real.json'), JSON.stringify(real));
    symlinkSync('real.json', path.join(root, 'ops', 'usage-snapshot.json'));
    const inside = await tileById('grok.usage', env(root));
    assert.equal(inside.state, 'ok');
    assert.equal((inside.data as { weeklyPct: number }).weeklyPct, 10);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test('dot, empty, and traversal candidates are refused, and a directory is not a file', () => {
  const root = tmp('ao-ops-dot-');
  try {
    assert.equal(safeRead('', [root]).ok, false);
    assert.equal((safeRead('', [root]) as { reason: string }).reason, 'path refused');
    assert.equal((safeRead('.', [root]) as { reason: string }).reason, 'not a file');
    assert.equal((safeRead('ops/../../x', [root]) as { reason: string }).reason, 'path refused');
    assert.equal((safeRead('ops/./usage-snapshot.json', [root]) as { reason: string }).reason, 'path refused');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('deepseek turns today sum cost, and a malformed spend line nulls the month', async () => {
  const dir = tmp('ao-ops-ds-');
  const home = path.join(dir, 'router-home');
  try {
    mkdirSync(path.join(home, 'data', 'spend'), { recursive: true });
    const lines = [
      { ts: '2026-11-09T15:00:00Z', type: 'cloud-reply', model: 'deepseek-v3', cost_usd: 0.001 },
      { ts: '2026-11-09T16:00:00Z', type: 'cloud-reply', model: 'DeepSeek-V4', cost_usd: 0.002 },
      { ts: '2026-11-09T16:30:00Z', type: 'cloud-reply', model: 'deepseek-chat', cost_usd: 0.0001 },
      { ts: '2026-11-08T16:00:00Z', type: 'cloud-reply', model: 'deepseek-chat', cost_usd: 0.5 },
      { ts: '2026-11-09T16:10:00Z', type: 'cloud-reply', model: 'grok-2', cost_usd: 9 },
      'not json',
    ];
    writeFileSync(path.join(home, 'data', 'log.jsonl'), lines.map((row) => (typeof row === 'string' ? row : JSON.stringify(row))).join('\n') + '\n');
    writeFileSync(path.join(home, 'data', 'spend', '2026-11.jsonl'), '{"usd":0.2}\n{"usd":0.21}\n');
    const tile = await tileById('deepseek', env(dir, { crewRouterHome: home }));
    const data = tile.data as { turnsToday: number; usdToday: number; usdMonth: number | null };
    assert.equal(tile.state, 'ok');
    assert.equal(data.turnsToday, 3);
    assert.ok(Math.abs(data.usdToday - 0.0031) < 1e-9);
    assert.ok(Math.abs((data.usdMonth ?? 0) - 0.41) < 1e-9);
    writeFileSync(path.join(home, 'data', 'spend', '2026-11.jsonl'), '{"usd":0.2}\n{bad\n');
    const bad = await tileById('deepseek', env(dir, { crewRouterHome: home }));
    assert.equal((bad.data as { usdMonth: number | null }).usdMonth, null);
    assert.match(bad.reason ?? '', /malformed/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('secrets, extra key fields, and long digit runs never appear on a tile', async () => {
  const dir = tmp('ao-ops-sec-');
  const home = path.join(dir, 'router-home');
  try {
    writeFileSync(path.join(dir, 'crew-status.json'), JSON.stringify({
      updatedAt: new Date(NOW).toISOString(),
      crew: { 'seat-1': 'WORKING ghp_abcdefghijklmnop', 'seat-2': 'WORKING 4111111111111111' },
      seen: { 'seat-1': NOW, 'seat-2': NOW },
      source: 'test',
    }));
    mkdirSync(path.join(home, 'data'), { recursive: true });
    writeFileSync(path.join(home, 'data', 'log.jsonl'), JSON.stringify({
      ts: '2026-11-09T16:00:00Z', type: 'cloud-reply', model: 'deepseek-chat', cost_usd: 0.001, api_key: 'sk-shouldnotappear',
    }) + '\n');
    const crew = await tileById('crew', env(dir));
    const deepseek = await tileById('deepseek', env(dir, { crewRouterHome: home }));
    const text = JSON.stringify(crew) + JSON.stringify(deepseek);
    assert.equal(text.includes('ghp_abcdefghijklmnop'), false);
    assert.equal(text.includes('4111111111111111'), false);
    assert.equal(text.includes('sk-shouldnotappear'), false);
    assert.equal(text.includes('api_key'), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('okkin.json alone is a partial ok tile, and both sources missing is not wired', async () => {
  const dir = tmp('ao-ops-ok-');
  const home = path.join(dir, 'router-home');
  try {
    mkdirSync(path.join(home, 'data'), { recursive: true });
    writeFileSync(path.join(home, 'data', 'okkin.json'), JSON.stringify({ jobs: 4, batches: 1, rests: 2, totalJobMs: 4000, maxJobMs: 1500, restUntil: null }));
    const partial = await tileById('okkin', env(dir, { crewRouterHome: home, ps: async () => { throw new Error('ollama off'); } }));
    assert.equal(partial.state, 'ok');
    assert.deepEqual((partial.data as { loaded: unknown[] }).loaded, []);
    assert.equal((partial.data as { jobs: number }).jobs, 4);
    assert.ok(partial.reason);
    const none = await tileById('okkin', env(dir, { ps: async () => [] }));
    assert.equal(none.state, 'not-wired');
    assert.equal(none.reason, 'missing');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('ProArt RAM warns at 85 and is red only above 90; 72 is idle and not a limit', async () => {
  assert.equal(RAM_IDLE_PCT, 72);
  assert.equal(RAM_WARN_PCT, 85);
  assert.equal(RAM_STOP_PCT, 90);
  assert.equal(ramBand(72), 'ok');
  assert.equal(ramBand(84.9), 'ok');
  assert.equal(ramBand(85), 'warn');
  assert.equal(ramBand(90), 'warn');
  assert.equal(ramBand(90.1), 'stop');
  const dir = tmp('ao-ops-ram-');
  try {
    const tile = await tileById('proart.host', env(dir, { mem: { total: 1000, free: 80, load: [0, 0, 0], rss: 100 * 1048576 } }));
    const data = tile.data as { ramPct: number; ramWarnPct: number; ramStopPct: number };
    assert.equal(tile.state, 'ok');
    assert.equal(data.ramPct, 92);
    assert.equal(data.ramWarnPct, 85);
    assert.equal(data.ramStopPct, 90);
    assert.equal(ramBand(data.ramPct), 'stop');
    assert.equal('ramLimitPct' in (tile.data as object), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('gpu and cloud agents stay not wired', async () => {
  const dir = tmp('ao-ops-gap-');
  try {
    const gpu = await tileById('proart.gpu', env(dir));
    const cloud = await tileById('cloud.agents', env(dir));
    assert.equal(gpu.state, 'not-wired');
    assert.match(gpu.reason ?? '', /nvidia-smi/);
    assert.equal(cloud.state, 'not-wired');
    assert.match(cloud.reason ?? '', /no local cloud-agent ledger/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
