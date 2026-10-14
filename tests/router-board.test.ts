// Funnel #5/#20 baseline + savings, #19 board, #34 drift, #35 scoreboard, §7 alert noise.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request, type Server } from 'node:http';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { baselinePerTask, logBaseline, savingsPct } from '../src/server/router/baseline.js';
import { boardFromLog } from '../src/server/router/board.js';
import { applyDrift, driftDue, freeModelDrift, WEEK_MS } from '../src/server/router/drift.js';
import { liveFreeModels } from '../src/server/router/cloud-send.js';
import { Scoreboard } from '../src/server/router/scoreboard.js';
import { AlertGate, PROVIDER_DOWN_MS } from '../src/server/router/alerts.js';
import { routingLogger } from '../src/server/router/routing-log.js';
import { route } from '../src/server/router/router.js';
import { boardLines, capLine } from '../src/shared/router-board.js';
import { cardView } from '../src/client/features/router-board/view.js';
import { OKKIN_REFUSALS_LOG } from '../src/server/hq/okkin-owner.js';
import { testOwner } from './support/okkin-owner.js';
import { requestHandler } from '../src/server/http/router.js';
import { routerBoardRoutes } from '../src/server/http/routes/router-board.js';
import { readRouterFlags } from '../src/server/router/flags.js';
import { flagsOff } from './support/router-fixtures.js';
import { testCtx, OFF_PEAK } from './support/router-ctx.js';

test('#5/#20 baseline logging per task type, and the savings formula (repair included)', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ao-base-'));
  try {
    logBaseline(dir, { task_type: 'summary', provider: 'forgel', cost_usd: 0.2 }, OFF_PEAK);
    logBaseline(dir, { task_type: 'summary', provider: 'forgel', cost_usd: 0.4 }, OFF_PEAK + 86_400_000);
    logBaseline(dir, { task_type: 'code-edit', provider: 'forgel', cost_usd: 1, prompt: 'never kept' } as never, OFF_PEAK);
    const b = baselinePerTask(dir);
    assert.equal(b.summary.tasks, 2);
    assert.ok(Math.abs(b.summary.costPerTask - 0.3) < 1e-9);
    const raw = readFileSync(path.join(dir, 'logs', 'routing', 'baseline-2026-10-13.jsonl'), 'utf8');
    assert.ok(!raw.includes('never kept'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  assert.equal(savingsPct(0.3, 100, 6, 3), 70);
  assert.equal(savingsPct(0, 100, 1), null);
  assert.ok(savingsPct(0.1, 10, 2)! < 0, 'negative when spending more');
});

test('#19 board: spend vs cap, % free, caps left, failures, scan blocks, queue (counts only)', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ao-board-'));
  try {
    const log = routingLogger(dir, () => OFF_PEAK);
    log({ task_id: 'a', provider: 'okkin', result: 'ok' });
    log({ task_id: 'b', provider: 'groq', result: 'ok' });
    log({ task_id: 'c', provider: 'deepseek', result: 'ok', cost_usd: 0.25 });
    log({ task_id: 'd', provider: 'groq', result: 'fail' });
    log({ task_id: 'e', provider: 'groq', result: 'blocked', scan_hits: [{ type: 'EMAIL', sha8: 'deadbeef', offset_bucket: 0 }] });
    log({ task_id: 'e', provider: '', result: 'queued' });
    const b = boardFromLog(dir, 3, OFF_PEAK);
    assert.equal(b.spentUsd, 0.25);
    assert.equal(b.pctFree, 67);
    assert.equal(b.failures, 1);
    assert.equal(b.scanBlocks, 1);
    assert.equal(b.queued, 1);
    assert.equal(b.capsLeft.groq, 1000 - 3);
    assert.equal(b.capsLeft.nim, null);
    assert.deepEqual(boardLines(b)[0], 'Paid today $0.25 of $3.00');
    assert.ok(boardLines(b).includes('NVIDIA: — limit unknown'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('#19 board route: owner only like #60; bots a logged 403; non-owners no spend; off says off', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ao-board-r-'));
  const has = (req: { headers: { cookie?: string } }) => /(^|;\s*)ao=session(;|$)/.test(req.headers.cookie || '');
  const ctx = { cfg: { port: 4600, dataDir: dir }, services: { lookup: () => undefined }, auth: { fromRequest: (r: never) => (has(r) ? {} : undefined), fromAnyCookie: (r: never) => has(r), sessionFromAnyCookie: (r: never) => (has(r) ? {} : undefined) } } as never;
  const srv: Server = createServer(requestHandler(ctx, [routerBoardRoutes.board]));
  await new Promise<void>((ok) => srv.listen(0, '127.0.0.1', ok));
  const port = (srv.address() as { port: number }).port;
  const get = (headers: Record<string, string>) => new Promise<{ status: number; body: string }>((ok, bad) => {
    const rq = request({ host: '127.0.0.1', port, path: '/api/router/board', headers: { host: '127.0.0.1:4600', ...headers } }, (res) => {
      let b = '';
      res.on('data', (c) => (b += c));
      res.on('end', () => ok({ status: res.statusCode || 0, body: b }));
    });
    rq.on('error', bad);
    rq.end();
  });
  const prev = process.env.ROUTER_ON;
  const { cookie } = await testOwner();
  try {
    routingLogger(dir)({ task_id: 'a', provider: 'deepseek', result: 'ok', cost_usd: 0.5 });
    const owner = `ao=session; ${cookie()}`;
    assert.equal((await get({})).status, 401);
    // Non-owner office session: 200 private, no spend data.
    const pw = await get({ cookie: 'ao=session' });
    assert.equal(pw.status, 200);
    assert.deepEqual(JSON.parse(pw.body), { private: true });
    // Bot credentials, even with an owner cookie: logged 403.
    for (const bot of [{ 'x-bridge-token': 'b'.repeat(64) }, { authorization: 'Bearer ' + 'c'.repeat(40) }, { 'x-pool-caller': 'x' }]) {
      const r = await get({ ...bot, cookie: owner });
      assert.equal(r.status, 403);
      assert.ok(!r.body.includes('spent'));
    }
    const log = readFileSync(path.join(dir, OKKIN_REFUSALS_LOG), 'utf8');
    assert.ok(log.includes('GET /api/router/board') && log.includes('bridge-token') && log.includes('pool-caller'));
    assert.ok(!log.includes('b'.repeat(64)));
    // Owner, router off (default): an honest off reply, no numbers.
    delete process.env.ROUTER_ON;
    assert.deepEqual(JSON.parse((await get({ cookie: owner })).body), { on: false });
    process.env.ROUTER_ON = '1';
    const on = JSON.parse((await get({ cookie: owner })).body);
    assert.equal(on.on, true);
    assert.equal(on.spentUsd, 0.5);
  } finally {
    if (prev === undefined) delete process.env.ROUTER_ON;
    else process.env.ROUTER_ON = prev;
    srv.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('#19 card view: hidden for non-owners/errors, "Model routing is off", friendly names, no ∞', () => {
  assert.deepEqual(cardView(200, { private: true }), { hidden: true });
  assert.deepEqual(cardView(403, null), { hidden: true });
  assert.deepEqual(cardView(0, null), { hidden: true });
  assert.deepEqual(cardView(200, { on: false }), { hidden: false, title: 'Model use today', lines: ['Model routing is off'], note: true });
  const v = cardView(200, { on: true, day: '2026-10-14', spentUsd: 0, capUsd: 3, pctFree: null, capsLeft: { groq: 997, nim: null, deepseek: null, openrouter: 50 }, failures: 0, scanBlocks: 0, queued: 0 });
  assert.equal(v.hidden, false);
  const text = (v as { lines: string[] }).lines.join('\n');
  assert.ok(!text.includes('∞'));
  assert.ok(!/\b(groq|nim|deepseek|openrouter)\b/.test(text), text);
  assert.match(text, /Groq: 997 left/);
  assert.match(text, /NVIDIA: — limit unknown/);
  assert.match(text, /Routed free: nothing routed yet today/);
  assert.equal(capLine('mystery', 3), 'mystery: 3 left');
});

test('router flags ROUTER_ON and ROUTER_DRIFT_FETCH default OFF', () => {
  assert.equal(readRouterFlags({}).routerOn, false);
  assert.equal(readRouterFlags({}).driftFetch, false);
  assert.equal(readRouterFlags({ ROUTER_ON: 'yes' }).routerOn, false);
  assert.equal(readRouterFlags({ ROUTER_ON: '1', ROUTER_DRIFT_FETCH: '1' }).driftFetch, true);
});

test('#34 weekly drift: dead free models are removed, new ones only reported; a bad fetch never empties the list', async () => {
  const conf = ['poolside/laguna:free', 'dead/model:free', 'other:free'];
  const live = ['poolside/laguna:free', 'other:free', 'brand-new:free', 'paid-model'];
  assert.deepEqual(freeModelDrift(conf, live), { removed: ['dead/model:free'], added: ['brand-new:free'], kept: ['poolside/laguna:free', 'other:free'] });
  assert.deepEqual(applyDrift(conf, live), ['poolside/laguna:free', 'other:free']);
  assert.deepEqual(applyDrift(conf, []), conf);
  assert.equal(driftDue(undefined, 0), true);
  assert.equal(driftDue(0, WEEK_MS - 1), false);
  // The live list is fetched only when the OpenRouter route (flag a) is on; stubbed here.
  let calls = 0;
  const fetchImpl = async () => (calls++, { status: 200, text: async () => JSON.stringify({ data: [{ id: 'a:free' }, { id: 'bad id;' }] }) });
  assert.deepEqual(await liveFreeModels(flagsOff, fetchImpl), []);
  // OpenRouter on but the drift-fetch flag OFF (default): no GET to openrouter.ai.
  assert.deepEqual(await liveFreeModels(readRouterFlags({ ROUTER_OPENROUTER_CREDIT: '1', OPENROUTER_API_KEY: 'x' }), fetchImpl), []);
  assert.deepEqual(await liveFreeModels(readRouterFlags({ ROUTER_DRIFT_FETCH: '1' }), fetchImpl), [], 'drift flag alone is not enough');
  assert.equal(calls, 0);
  assert.deepEqual(await liveFreeModels(readRouterFlags({ ROUTER_OPENROUTER_CREDIT: '1', OPENROUTER_API_KEY: 'x', ROUTER_DRIFT_FETCH: '1' }), fetchImpl), ['a:free']);
  assert.equal(calls, 1);
});

test('#35 scoreboard: per model and level per month; under 60% at a level drops the model there', () => {
  let now = OFF_PEAK;
  const s = new Scoreboard(() => now);
  for (let i = 0; i < 5; i++) s.record('g', 3, i < 2, { ok: i < 4 });
  assert.equal(s.rate('g', 3), 0.4);
  assert.equal(s.allowed('g', 3), false);
  assert.equal(s.allowed('g', 4), true, 'other levels unaffected');
  assert.equal(s.table()[0].toolCallRate, 0.8);
  const t = testCtx();
  t.ctx.scoreOk = (m, l) => s.allowed(m, l);
  assert.equal(route({ id: 'x', level: 3, repo: 'nicholibb-prog/agent-office', prompt: 'p' }, t.ctx).provider, 'nim', 'Groq model g dropped at level 3');
  now = Date.parse('2026-11-02T16:00:00Z');
  assert.equal(s.allowed('g', 3), true, 'new month, new board');
});

test('§7 alert noise: only cap/P0/scan-block/provider-down alert now; the rest wait for the 8 PM MT digest', () => {
  let now = OFF_PEAK; // 10 AM MT
  const sent: { kind: string; items?: number }[] = [];
  const g = new AlertGate((a) => sent.push(a), () => now);
  g.push({ kind: 'cap-80' });
  g.push({ kind: 'scan-block', taskId: 't1', types: ['EMAIL'], count: 1 });
  g.push({ kind: 'scan-block', taskId: 't1', types: ['EMAIL'], count: 1 });
  g.push({ kind: 'queued-for-owner', taskId: 't2' });
  assert.deepEqual(sent.map((s) => s.kind), ['cap-80', 'scan-block']);
  g.providers(['groq']);
  now += PROVIDER_DOWN_MS + 1;
  g.providers(['groq']);
  g.providers(['groq']);
  assert.equal(sent.filter((s) => s.kind === 'provider-down').length, 1);
  g.tick();
  assert.equal(sent.some((s) => s.kind === 'digest'), false, 'before 8 PM');
  now = Date.parse('2026-10-14T02:30:00Z'); // 8:30 PM MT on the 13th
  g.tick();
  g.tick();
  const d = sent.filter((s) => s.kind === 'digest');
  assert.equal(d.length, 1);
  assert.equal(d[0].items, 1);
});
