// Seat text is private: kavi-outbox, talk (crew seats) and desk writes, per caller type. Fake data only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request, type Server } from 'node:http';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { requestHandler } from '../src/server/http/router.js';
import { bridgeRoutes } from '../src/server/http/routes/bridge.js';
import { hqRoutes } from '../src/server/http/routes/hq.js';
import { OKKIN_REFUSALS_LOG } from '../src/server/hq/okkin-owner.js';
import { issueSeatToken } from '../src/server/seat-tokens.js';
import { appendThread } from '../src/server/hq/relay.js';
import { writeOutboxFile } from '../src/server/outbox.js';
import { resetHqLimitsForTests } from '../src/server/hq/limits.js';
import { SeatBoard } from '../src/server/seat-provider.js';
import { testOwner, TEST_PASSPHRASE } from './support/okkin-owner.js';

const SHARED = 's'.repeat(64);
const A_TEXT = 'FAKE seat-1 private line 41aa';
const B_TEXT = 'FAKE seat-2 private line 52bb';

async function setup() {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'ao-seatpriv-'));
  const { writeFileSync } = await import('node:fs');
  writeFileSync(path.join(dataDir, 'bridge-token'), SHARED);
  const tokA = issueSeatToken(dataDir, 'seat-1');
  const tokB = issueSeatToken(dataDir, 'seat-2');
  appendThread(dataDir, 'seat-1', { id: 'a1', role: 'bot', text: A_TEXT, at: 1 });
  appendThread(dataDir, 'seat-2', { id: 'b1', role: 'bot', text: B_TEXT, at: 2 });
  writeOutboxFile(path.join(dataDir, 'kavi-outbox.json'), [
    { title: 'office-chat', text: A_TEXT, at: 'x', seat: 'seat-1' },
    { title: 'office-chat', text: B_TEXT, at: 'y', seat: 'seat-2' },
    { title: 'legacy', text: 'FAKE unstamped item', at: 'z' },
  ]);
  return { dataDir, tokA, tokB };
}

async function withServer(dataDir: string, fn: (port: number) => Promise<void>) {
  const has = (req: { headers: { cookie?: string } }) => /(^|;\s*)ao=session(;|$)/.test(req.headers.cookie || '');
  const ctx = {
    cfg: { port: 4600, tailnet: undefined, dataDir },
    services: { lookup: () => undefined },
    auth: {
      fromRequest: (req: never) => (has(req) ? { account: { id: 'nick', role: 'admin' } } : undefined),
      fromAnyCookie: (req: never) => has(req),
      sessionFromAnyCookie: (req: never) => (has(req) ? { account: { id: 'nick', role: 'admin' } } : undefined),
    },
    meOf: () => ({ admin: true }),
    floors: new Map(),
    chat: { add() {} },
    broadcast() {},
  } as never;
  const srv: Server = createServer(requestHandler(ctx, [bridgeRoutes.kaviOutboxGet, hqRoutes.talkGet, hqRoutes.talk, hqRoutes.desk]));
  await new Promise<void>((ok) => srv.listen(0, '127.0.0.1', ok));
  try {
    await fn((srv.address() as { port: number }).port);
  } finally {
    srv.close();
  }
}
function call(port: number, method: string, p: string, headers: Record<string, string>, body?: unknown): Promise<{ status: number; raw: string; json: any }> {
  return new Promise((ok, bad) => {
    const h: Record<string, string> = { host: '127.0.0.1:4600', ...headers };
    if (body !== undefined) h['content-type'] = 'application/json';
    const rq = request({ host: '127.0.0.1', port, path: p, method, headers: h }, (res) => {
      let s = '';
      res.on('data', (c) => (s += c));
      res.on('end', () => ok({ status: res.statusCode || 0, raw: s, json: s.startsWith('{') ? JSON.parse(s) : null }));
    });
    rq.on('error', bad);
    rq.end(body === undefined ? undefined : JSON.stringify(body));
  });
}
const tok = (t: string) => ({ 'x-bridge-token': t });
const logLines = (dataDir: string) => {
  const f = path.join(dataDir, OKKIN_REFUSALS_LOG);
  return existsSync(f) ? readFileSync(f, 'utf8') : '';
};
function noSecrets(raw: string, secrets: string[]) {
  for (const s of secrets) assert.ok(!raw.includes(s), 'refusal log carries a secret');
}

test('GET /api/bridge/kavi-outbox: shared 403 logged, seat sees own, owner all, session none', async () => {
  const { dataDir, tokA, tokB } = await setup();
  const { cookie } = await testOwner();
  const owner = cookie();
  await withServer(dataDir, async (port) => {
    const p = '/api/bridge/kavi-outbox';
    const shared = await call(port, 'GET', p, tok(SHARED));
    assert.equal(shared.status, 403);
    assert.ok(!shared.raw.includes('FAKE'));
    const pool = await call(port, 'GET', p, { 'x-pool-caller': 'pool-x', cookie: `ao=session; ${owner}` });
    assert.equal(pool.status, 403);
    assert.equal((await call(port, 'GET', p, tok('u'.repeat(64)))).status, 401);
    assert.equal((await call(port, 'GET', p, {})).status, 401);
    const a = await call(port, 'GET', p, tok(tokA));
    assert.equal(a.status, 200);
    assert.deepEqual(a.json.items.map((i: { text: string }) => i.text), [A_TEXT]);
    const b = await call(port, 'GET', p, tok(tokB));
    assert.deepEqual(b.json.items.map((i: { text: string }) => i.text), [B_TEXT]);
    // A seat token beats an owner cookie: still its own seat only.
    const aOwner = await call(port, 'GET', p, { ...tok(tokA), cookie: `ao=session; ${owner}` });
    assert.deepEqual(aOwner.json.items.map((i: { text: string }) => i.text), [A_TEXT]);
    const sess = await call(port, 'GET', p, { cookie: 'ao=session' });
    assert.equal(sess.status, 200);
    assert.deepEqual(sess.json.items, []);
    assert.equal(sess.json.private, true);
    const own = await call(port, 'GET', p, { cookie: `ao=session; ${owner}` });
    assert.equal(own.json.items.length, 3);
    assert.equal(own.json.private, false);
    const log = logLines(dataDir);
    assert.match(log, /"route":"GET \/api\/bridge\/kavi-outbox","caller":"shared-bridge-token"/);
    assert.match(log, /"caller":"pool-caller"/);
    noSecrets(log, [SHARED, tokA, tokB, 'pool-x', TEST_PASSPHRASE, owner.split('=')[1]]);
  });
  rmSync(dataDir, { recursive: true, force: true });
});

test('seat-provider queue stamps its target seat on outbox items', async () => {
  const { dataDir } = await setup();
  const board = new SeatBoard(dataDir, { detect: () => ({}) as never });
  assert.equal(board.queue('floor-1', 'seat-3', 'FAKE task'), true);
  const items = JSON.parse(readFileSync(path.join(dataDir, 'kavi-outbox.json'), 'utf8')).items as { title: string; seat?: string }[];
  assert.equal(items.at(-1)?.seat, 'seat-3');
  assert.equal(items.at(-1)?.title, 'seat:floor-1:seat-3');
  rmSync(dataDir, { recursive: true, force: true });
});

test('GET /api/bridge/talk (crew seat): own seat only, shared 403, owner reads, session private', async () => {
  const { dataDir, tokA } = await setup();
  const { cookie } = await testOwner();
  const owner = cookie();
  await withServer(dataDir, async (port) => {
    const p = (s: string) => `/api/bridge/talk?seat=${s}`;
    const own = await call(port, 'GET', p('seat-1'), tok(tokA));
    assert.equal(own.status, 200);
    assert.ok(own.raw.includes(A_TEXT));
    assert.equal(own.json.private, false);
    const other = await call(port, 'GET', p('seat-2'), tok(tokA));
    assert.equal(other.status, 403);
    assert.ok(!other.raw.includes(B_TEXT));
    const shared = await call(port, 'GET', p('seat-1'), tok(SHARED));
    assert.equal(shared.status, 403);
    assert.ok(!shared.raw.includes(A_TEXT));
    assert.equal((await call(port, 'GET', p('seat-1'), {})).status, 401);
    const sess = await call(port, 'GET', p('seat-2'), { cookie: 'ao=session' });
    assert.equal(sess.status, 200);
    assert.deepEqual(sess.json.messages, []);
    assert.equal(sess.json.private, true);
    const ownr = await call(port, 'GET', p('seat-2'), { cookie: `ao=session; ${owner}` });
    assert.ok(ownr.raw.includes(B_TEXT));
    assert.equal(ownr.json.private, false);
    const log = logLines(dataDir);
    assert.match(log, /"route":"GET \/api\/bridge\/talk","caller":"shared-bridge-token"/);
    assert.match(log, /"route":"GET \/api\/bridge\/talk \(other seat\)","caller":"seat-token"/);
    noSecrets(log, [SHARED, tokA, TEST_PASSPHRASE, owner.split('=')[1]]);
  });
  rmSync(dataDir, { recursive: true, force: true });
});

test('POST /api/bridge/desk: seat token writes its own seat, spoof 403, session must be owner', async () => {
  const { dataDir, tokA } = await setup();
  const { cookie } = await testOwner();
  const owner = cookie();
  await withServer(dataDir, async (port) => {
    const p = '/api/bridge/desk';
    const mine = await call(port, 'POST', p, tok(tokA), { task: 'FAKE own task' });
    assert.equal(mine.status, 200);
    assert.equal(mine.json.seat, 'seat-1');
    assert.equal((await call(port, 'POST', p, tok(tokA), { seat: 'seat-1', task: 'x' })).json.seat, 'seat-1');
    const spoof = await call(port, 'POST', p, tok(tokA), { seat: 'seat-2', task: 'FAKE spoof' });
    assert.equal(spoof.status, 403);
    assert.equal((await call(port, 'POST', p, tok(SHARED), { seat: 'seat-1', task: 'x' })).status, 403);
    assert.equal((await call(port, 'POST', p, { cookie: 'ao=session' }, { seat: 'seat-2', task: 'x' })).status, 403);
    assert.equal((await call(port, 'POST', p, {}, { seat: 'seat-2', task: 'x' })).status, 401);
    const ownr = await call(port, 'POST', p, { cookie: `ao=session; ${owner}` }, { seat: 'seat-2', task: 'FAKE owner task' });
    assert.equal(ownr.status, 200);
    assert.equal(ownr.json.seat, 'seat-2');
    const log = logLines(dataDir);
    assert.match(log, /"route":"POST \/api\/bridge\/desk \(other seat\)","caller":"seat-token"/);
    assert.match(log, /"route":"POST \/api\/bridge\/desk","caller":"not-owner"/);
    noSecrets(log, [SHARED, tokA, TEST_PASSPHRASE, owner.split('=')[1]]);
  });
  rmSync(dataDir, { recursive: true, force: true });
});

test('POST /api/bridge/talk (crew seat): owner only; tokens and plain sessions refused', async () => {
  const { dataDir, tokA } = await setup();
  const { cookie } = await testOwner();
  const owner = cookie();
  resetHqLimitsForTests();
  await withServer(dataDir, async (port) => {
    const p = '/api/bridge/talk';
    const body = { seat: 'seat-1', text: 'FAKE hello' };
    assert.equal((await call(port, 'POST', p, tok(tokA), body)).status, 403);
    assert.equal((await call(port, 'POST', p, { ...tok(tokA), cookie: `ao=session; ${owner}` }, body)).status, 403);
    assert.equal((await call(port, 'POST', p, { cookie: 'ao=session' }, body)).status, 403);
    assert.equal((await call(port, 'POST', p, {}, body)).status, 401);
    const ok = await call(port, 'POST', p, { cookie: `ao=session; ${owner}` }, body);
    assert.equal(ok.status, 200);
    assert.ok(ok.raw.includes('FAKE hello'));
    const log = logLines(dataDir);
    assert.match(log, /"route":"POST \/api\/bridge\/talk","caller":"not-owner"/);
    noSecrets(log, [tokA, TEST_PASSPHRASE, owner.split('=')[1]]);
  });
  rmSync(dataDir, { recursive: true, force: true });
});
