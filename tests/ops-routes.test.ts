// /api/ops and /api/ops/history: owner gate, redaction, and one sampler for every tab.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest, type Server } from 'node:http';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { requestHandler } from '../src/server/http/router.js';
import { opsRoutes } from '../src/server/http/routes/ops.js';
import { routes } from '../src/server/http/routes/index.js';
import { OKKIN_REFUSALS_LOG } from '../src/server/hq/okkin-owner.js';
import { opsTick, startOpsSampler } from '../src/server/ops/sampler.js';
import type { OpsAdapter } from '../src/server/ops/adapters.js';
import { testOwner } from './support/okkin-owner.js';

function hasUsd(value: unknown, seen = new Set<object>()): boolean {
  if (!value || typeof value !== 'object') return false;
  if (seen.has(value)) return false;
  seen.add(value);
  for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
    if (key.toLowerCase().includes('usd')) return true;
    if (hasUsd(inner, seen)) return true;
  }
  return false;
}

function office(dataDir: string) {
  const has = (req: { headers: { cookie?: string } }) => /(^|;\s*)ao=session(;|$)/.test(req.headers.cookie || '');
  return {
    cfg: { port: 4600, dataDir },
    publicDir: path.join(import.meta.dirname, '../src/client'),
    services: { lookup: () => undefined },
    building: { list: () => [] as { dir: string }[] },
    auth: {
      fromRequest: (r: { headers: { cookie?: string } }) => (has(r) ? {} : undefined),
      fromAnyCookie: (r: { headers: { cookie?: string } }) => has(r),
      sessionFromAnyCookie: (r: { headers: { cookie?: string } }) => (has(r) ? {} : undefined),
    },
  };
}

async function listen(handler: (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => void) {
  const srv: Server = createServer(handler);
  await new Promise<void>((ok) => srv.listen(0, '127.0.0.1', ok));
  const port = (srv.address() as { port: number }).port;
  const hit = (method: string, urlPath: string, headers: Record<string, string> = {}) => new Promise<{ status: number; body: string; cache: string | undefined }>((ok, bad) => {
    const rq = httpRequest({ host: '127.0.0.1', port, method, path: urlPath, headers: { host: '127.0.0.1:4600', ...headers } }, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => ok({ status: res.statusCode || 0, body, cache: res.headers['cache-control'] as string | undefined }));
    });
    rq.on('error', bad);
    rq.end();
  });
  return { srv, hit };
}

test('the ops registry marks the API and the page as session routes', () => {
  assert.equal(opsRoutes.api.auth, 'session');
  assert.equal(opsRoutes.history.auth, 'session');
  assert.equal(opsRoutes.page.auth, 'session');
  const session = routes.filter((route) => route.auth === 'session');
  const apiAt = session.indexOf(opsRoutes.api);
  assert.ok(apiAt >= 0);
  assert.equal(session[apiAt + 1], opsRoutes.history);
  assert.equal(session[apiAt + 2], opsRoutes.page);
});

test('a bridge token is a logged 403 and a missing session is 401', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ao-ops-gate-'));
  const ctx = office(dir);
  const { srv, hit } = await listen(requestHandler(ctx as never, [opsRoutes.api, opsRoutes.history]));
  const prev = process.env.AGENT_OFFICE_OWNER_FILE;
  const { cookie } = await testOwner();
  try {
    assert.equal((await hit('GET', '/api/ops')).status, 401);
    const owner = `ao=session; ${cookie()}`;
    const refused = await hit('GET', '/api/ops', { 'x-bridge-token': 'b'.repeat(64), cookie: owner });
    assert.equal(refused.status, 403);
    assert.equal(refused.body.includes('b'.repeat(64)), false);
    const log = readFileSync(path.join(dir, OKKIN_REFUSALS_LOG), 'utf8');
    assert.ok(log.includes('GET /api/ops'));
    assert.ok(log.includes('bridge-token'));
  } finally {
    if (prev === undefined) delete process.env.AGENT_OFFICE_OWNER_FILE;
    else process.env.AGENT_OFFICE_OWNER_FILE = prev;
    srv.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('OPS_ON unset answers on:false', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ao-ops-off-'));
  const ctx = office(dir);
  const { srv, hit } = await listen(requestHandler(ctx as never, [opsRoutes.api]));
  try {
    const res = await hit('GET', '/api/ops', { cookie: 'ao=session' });
    assert.equal(res.status, 200);
    assert.deepEqual(JSON.parse(res.body), { on: false });
  } finally {
    srv.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the owner sees dollar fields and another session does not', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ao-ops-usd-'));
  mkdirSync(path.join(dir, 'ops'), { recursive: true });
  writeFileSync(path.join(dir, 'ops', 'usage-snapshot.json'), JSON.stringify({
    schema: 1,
    capturedAt: new Date().toISOString(),
    grokWeekly: { pct: 40.1, resetsAt: '2026-11-10T18:32:00Z' },
    onDemand: { usedUsd: 30.11, limitUsd: 30, resetsAt: '2026-11-24T19:32:00Z' },
  }));
  const ctx = office(dir);
  const stop = startOpsSampler(ctx, { env: { OPS_ON: '1' }, auto: false, ps: async () => [] });
  await opsTick(ctx);
  const { srv, hit } = await listen(requestHandler(ctx as never, [opsRoutes.api, opsRoutes.history]));
  const prev = process.env.AGENT_OFFICE_OWNER_FILE;
  const { cookie } = await testOwner();
  try {
    const owner = JSON.parse((await hit('GET', '/api/ops', { cookie: `ao=session; ${cookie()}` })).body);
    assert.equal(owner.on, true);
    assert.equal(owner.tiles['grok.usage'].data.onDemandUsd, 30.11);
    assert.equal(owner.tiles['proart.gpu'].state, 'not-wired');
    const otherRes = await hit('GET', '/api/ops', { cookie: 'ao=session' });
    const other = JSON.parse(otherRes.body);
    assert.deepEqual(other.redacted, ['usd']);
    assert.equal(hasUsd(other), false, JSON.stringify(other));
    assert.equal(other.tiles['grok.usage'].data.weeklyPct, 40.1);
    assert.equal(otherRes.cache, 'no-store');
    const hidden = JSON.parse((await hit('GET', '/api/ops/history?metric=onDemandUsd', { cookie: 'ao=session' })).body);
    assert.deepEqual(hidden, { metric: 'onDemandUsd', private: true });
  } finally {
    stop();
    if (prev === undefined) delete process.env.AGENT_OFFICE_OWNER_FILE;
    else process.env.AGENT_OFFICE_OWNER_FILE = prev;
    srv.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('history rejects a bad metric or since and returns points in time order', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ao-ops-h-'));
  const ctx = office(dir);
  let now = Date.now() - 10_000;
  const stop = startOpsSampler(ctx, { env: { OPS_ON: '1' }, auto: false, now: () => now, ps: async () => [], mem: () => ({ total: 1000, free: 500, load: [0, 0, 0], rss: 50 * 1048576 }) });
  const { srv, hit } = await listen(requestHandler(ctx as never, [opsRoutes.api, opsRoutes.history]));
  try {
    await opsTick(ctx);
    now += 1000;
    await opsTick(ctx);
    const badMetric = await hit('GET', '/api/ops/history?metric=nope', { cookie: 'ao=session' });
    assert.equal(badMetric.status, 400);
    assert.deepEqual(JSON.parse(badMetric.body), { error: 'bad metric' });
    const badSince = await hit('GET', '/api/ops/history?metric=ramPct&since=garbage', { cookie: 'ao=session' });
    assert.equal(badSince.status, 400);
    assert.deepEqual(JSON.parse(badSince.body), { error: 'bad since' });
    const ok = JSON.parse((await hit('GET', '/api/ops/history?metric=ramPct', { cookie: 'ao=session' })).body) as { points: [number, number][] };
    assert.ok(ok.points.length >= 2);
    for (let i = 1; i < ok.points.length; i++) assert.ok(ok.points[i]![0] >= ok.points[i - 1]![0]);
  } finally {
    stop();
    srv.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('parallel polls do not run adapters again', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ao-ops-con-'));
  const ctx = office(dir);
  let calls = 0;
  const adapters: OpsAdapter[] = [{
    id: 'crew',
    run: async () => {
      calls += 1;
      return { id: 'crew', state: 'ok', data: { seats: [], queue: { waiting: 0, running: 0, doneToday: 0 } } };
    },
  }];
  const stop = startOpsSampler(ctx, { env: { OPS_ON: '1' }, auto: false, adapters });
  await opsTick(ctx);
  const afterTick = calls;
  const { srv, hit } = await listen(requestHandler(ctx as never, [opsRoutes.api, opsRoutes.history]));
  try {
    const cookies = Array.from({ length: 10 }, (_, i) => ({ cookie: `ao=session; seat=${i}` }));
    const ops = Array.from({ length: 50 }, (_, i) => hit('GET', '/api/ops', cookies[i % cookies.length]!));
    const history = Array.from({ length: 20 }, (_, i) => hit('GET', '/api/ops/history?metric=ramPct', cookies[i % cookies.length]!));
    const all = await Promise.all([...ops, ...history]);
    assert.equal(calls, afterTick);
    assert.ok(all.every((res) => res.status === 200));
    const stamps = all.slice(0, 50).map((res) => (JSON.parse(res.body) as { sampledAt: number }).sampledAt);
    assert.ok(stamps.every((stamp) => stamp === stamps[0]));
  } finally {
    stop();
    srv.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('many samples and route calls stay within the rss growth budget', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ao-ops-mem-'));
  const ctx = office(dir);
  const adapters: OpsAdapter[] = [{ id: 'crew', run: async () => ({ id: 'crew', state: 'ok' }) }];
  const stop = startOpsSampler(ctx, { env: { OPS_ON: '1' }, auto: false, adapters });
  const { srv, hit } = await listen(requestHandler(ctx as never, [opsRoutes.api, opsRoutes.history]));
  const before = process.memoryUsage().rss;
  try {
    for (let i = 0; i < 200; i++) await opsTick(ctx);
    for (let i = 0; i < 500; i++) await hit('GET', i % 2 ? '/api/ops' : '/api/ops/history?metric=ramPct', { cookie: 'ao=session' });
    const growth = process.memoryUsage().rss - before;
    assert.ok(growth < 30 * 1024 * 1024, `rss grew ${growth} bytes`);
  } finally {
    stop();
    srv.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the office still binds with a single listen on cfg.host', () => {
  const src = readFileSync(path.join(import.meta.dirname, '../src/server/server.ts'), 'utf8');
  assert.equal(src.split('server.listen(cfg.port, cfg.host').length - 1, 1);
  const ops = ['src/server/ops/sampler.ts', 'src/server/ops/adapters.ts', 'src/server/http/routes/ops.ts', 'src/client/ops.ts'];
  for (const file of ops) {
    const text = readFileSync(path.join(import.meta.dirname, '..', file), 'utf8');
    assert.equal(text.includes('0.0.0.0'), false, file);
    assert.equal(/\blisten\(/.test(text), false, file);
  }
});
