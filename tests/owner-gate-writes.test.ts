// Owner-only writes (Dan, bf64a4c0 sweep): POST /api/kavi/message, POST /api/kavi/file and
// POST /api/bridge/unblock/answer need an office session plus a live owner unlock. Every bot
// credential is a logged 403, even alongside an owner cookie. Also: hook tokens are kept only as
// sha256, verified in constant time, and re-minted on every launch. Fake data and temp folders only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request, type Server } from 'node:http';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { requestHandler } from '../src/server/http/router.js';
import { kaviSendRoutes } from '../src/server/http/routes/kavi-send.js';
import { hqBriefRoutes } from '../src/server/http/routes/hq-brief.js';
import { OKKIN_REFUSALS_LOG } from '../src/server/hq/okkin-owner.js';
import { titleHash } from '../src/shared/hq-brief.js';
import type { WorkerInfo } from '../src/shared/protocol.js';
import { hashHookToken, hookTokenOk, mintHookToken, newWorker } from '../src/server/workers/worker.js';
import { restoreWorkers, saveWorkers } from '../src/server/workers/persist.js';
import { testOwner } from './support/okkin-owner.js';
import { BRIDGE_ID_MARKER } from '../src/server/kavi-send.js';

const FOLDER_ID = 'FAKE_folder_id_for_tests_0002';

const BRIDGE_TOKEN = 'b'.repeat(64);
const BEARER = 'Bearer ' + 'c'.repeat(64);
const SEAT_TOKEN = 'd'.repeat(64);

type Writes = { id: string; data: string }[];
function office(dataDir: string, writes: Writes) {
  const has = (req: { headers: { cookie?: string } }) => /(^|;\s*)ao=session(;|$)/.test(req.headers.cookie || '');
  const info = { id: 'w1', deskId: 'desk-1', name: 'desk-1', status: 'needs_input', activity: 'Approve npm test', waitingSince: 1000, createdAt: 1 } as WorkerInfo;
  return {
    cfg: { port: 4600, tailnet: undefined, dataDir },
    services: { lookup: () => undefined },
    auth: {
      fromRequest: (req: never) => (has(req) ? { account: { id: 'acct-1' } } : undefined),
      fromAnyCookie: (req: never) => has(req),
      sessionFromAnyCookie: (req: never) => (has(req) ? { account: { id: 'acct-1' } } : undefined),
    },
    floors: new Map([['home', { workers: { list: () => [info], write: (id: string, data: string) => writes.push({ id, data }) }, queue: { state: () => ({ tasks: [] }) } }]]),
  } as never;
}

function call(port: number, p: string, headers: Record<string, string>, body: string): Promise<{ status: number; body: string }> {
  return new Promise((ok, bad) => {
    const rq = request({ host: '127.0.0.1', port, path: p, method: 'POST', headers: { host: '127.0.0.1:4600', 'content-length': String(Buffer.byteLength(body)), ...headers } }, (res) => {
      let s = '';
      res.on('data', (c) => (s += c));
      res.on('end', () => ok({ status: res.statusCode || 0, body: s }));
    });
    rq.on('error', bad);
    rq.end(body);
  });
}

const ROUTES = [
  { path: '/api/kavi/message', ct: 'application/json', body: () => JSON.stringify({ text: 'FAKE owner note' }) },
  { path: '/api/kavi/file', ct: 'application/octet-stream', extra: { 'x-file-name': 'fake.txt' }, body: () => 'FAKE file body' },
  { path: '/api/bridge/unblock/answer', ct: 'application/json', body: () => JSON.stringify({ id: 'live:w1', answer: 'yes', at: 1000, titleHash: titleHash('Approve npm test') }) },
] as const;

test('owner-gated writes: every caller type, refusals logged without secrets', async () => {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'ao-ogw-data-'));
  const bridge = mkdtempSync(path.join(tmpdir(), 'ao-ogw-bridge-'));
  mkdirSync(path.join(bridge, 'to-kavi'), { recursive: true });
  mkdirSync(path.join(bridge, 'to-george'), { recursive: true });
  require_write(path.join(bridge, BRIDGE_ID_MARKER), FOLDER_ID + '\n');
  const prevId = process.env.AGENT_OFFICE_KAVI_BRIDGE_FOLDER_ID;
  process.env.AGENT_OFFICE_KAVI_BRIDGE_FOLDER_ID = FOLDER_ID;
  const prev = process.env.AGENT_OFFICE_KAVI_BRIDGE_DIR;
  process.env.AGENT_OFFICE_KAVI_BRIDGE_DIR = bridge;
  const { cookie } = await testOwner();
  const writes: Writes = [];
  const srv: Server = createServer(requestHandler(office(dataDir, writes), [kaviSendRoutes.message, kaviSendRoutes.file, hqBriefRoutes.answer]));
  await new Promise<void>((ok) => srv.listen(0, '127.0.0.1', ok));
  const port = (srv.address() as { port: number }).port;
  const log = path.join(dataDir, OKKIN_REFUSALS_LOG);
  const sent = () => readdirSync(path.join(bridge, 'to-kavi')).length;
  try {
    for (const r of ROUTES) {
      const h = (more: Record<string, string>) => ({ 'content-type': r.ct, ...('extra' in r ? r.extra : {}), ...more });
      const owner = `ao=session; ${cookie()}`;
      // Bot credentials, alone and alongside an owner session + cookie: 403, logged.
      for (const bot of [{ 'x-bridge-token': BRIDGE_TOKEN }, { 'x-bridge-token': SEAT_TOKEN }, { authorization: BEARER }, { 'x-pool-caller': 'pool-bot' }]) {
        const alone = await call(port, r.path, h(bot), r.body());
        assert.equal(alone.status, 403, `${r.path} ${Object.keys(bot)[0]} alone`);
        const withOwner = await call(port, r.path, h({ ...bot, cookie: owner }), r.body());
        assert.equal(withOwner.status, 403, `${r.path} ${Object.keys(bot)[0]} with owner cookie`);
        assert.match(withOwner.body, /owner only/);
      }
      // No session: 401.
      assert.equal((await call(port, r.path, h({}), r.body())).status, 401, `${r.path} no session`);
      // Shared-password office session, not owner: 403 'owner only', logged.
      const pw = await call(port, r.path, h({ cookie: 'ao=session' }), r.body());
      assert.equal(pw.status, 403, `${r.path} password session`);
      assert.match(pw.body, /owner only/);
      // Owner cookie without an office session: still refused.
      assert.equal((await call(port, r.path, h({ cookie: cookie() }), r.body())).status, 401, `${r.path} owner cookie only`);
      // A stale or forged owner cookie with a session: not owner.
      assert.equal((await call(port, r.path, h({ cookie: 'ao=session; ' + cookie().replace(/=.*/, '=forged') }), r.body())).status, 403);
      assert.equal(writes.length + sent(), 0, `${r.path}: nothing written before the owner`);
    }
    // The owner, unlocked: 200 on each.
    for (const r of ROUTES) {
      const res = await call(port, r.path, { 'content-type': r.ct, ...('extra' in r ? r.extra : {}), cookie: `ao=session; ${cookie()}` }, r.body());
      assert.equal(res.status, 200, `${r.path} owner: ${res.body}`);
    }
    assert.equal(sent(), 2);
    assert.equal(writes.length, 1);

    const text = readFileSync(log, 'utf8');
    for (const route of ['POST /api/kavi/message', 'POST /api/kavi/file', 'POST /api/bridge/unblock/answer']) {
      assert.ok(text.includes(route), route);
    }
    for (const caller of ['bridge-token', 'bearer', 'pool-caller', 'not-owner']) assert.ok(text.includes(caller), caller);
    // No secrets in the log: no tokens, cookies, passphrases or bodies.
    for (const secret of [BRIDGE_TOKEN, SEAT_TOKEN, 'c'.repeat(64), 'pool-bot', 'FAKE owner note', 'FAKE file body', 'ao=session', 'correct horse']) {
      assert.ok(!text.includes(secret), `log leaks ${secret}`);
    }
    assert.ok(!/=[0-9a-f]{32,}/.test(text), 'no cookie value in the log');
  } finally {
    srv.close();
    if (prev === undefined) delete process.env.AGENT_OFFICE_KAVI_BRIDGE_DIR;
    else process.env.AGENT_OFFICE_KAVI_BRIDGE_DIR = prev;
    if (prevId === undefined) delete process.env.AGENT_OFFICE_KAVI_BRIDGE_FOLDER_ID;
    else process.env.AGENT_OFFICE_KAVI_BRIDGE_FOLDER_ID = prevId;
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(bridge, { recursive: true, force: true });
  }
});

const info = (id: string) => ({ id, kind: 'shell', provider: 'claude', deskId: 'desk-1', name: id, createdAt: 1 }) as unknown as WorkerInfo;

test('hook tokens: only the sha256 is stored, verified by hash; a relaunch voids the old token', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ao-hook-'));
  const file = path.join(dir, 'workers.json');
  try {
    const w = newWorker(info('w-hook'), {} as never);
    // Before any launch there is no usable token.
    assert.equal(hookTokenOk(w, ''), false);
    const first = mintHookToken(w);
    assert.equal(w.hookTokenHash, hashHookToken(first));
    assert.equal(hookTokenOk(w, first), true);
    assert.equal(hookTokenOk(w, 'not-the-token'), false);
    assert.equal(hookTokenOk(w, first.slice(0, -1)), false);
    assert.equal(hookTokenOk(w, undefined), false);

    saveWorkers(file, [w], false);
    const raw = readFileSync(file, 'utf8');
    assert.ok(!raw.includes(first), 'workers.json never holds the raw token');
    assert.ok(!/"hookToken"/.test(raw));
    assert.ok(raw.includes(hashHookToken(first)));

    // Restored (a terminal still running in the host): its existing token verifies by hash.
    const back = new Map();
    restoreWorkers(file, back, 'claude', () => false);
    const r = back.get('w-hook');
    assert.ok(r);
    assert.equal(r.hookToken, undefined);
    assert.equal(hookTokenOk(r, first), true);

    // A relaunch mints a fresh token: the pre-relaunch one stops working.
    const second = mintHookToken(r);
    assert.notEqual(second, first);
    assert.equal(hookTokenOk(r, second), true);
    assert.equal(hookTokenOk(r, first), false);
    saveWorkers(file, back.values(), false);
    const raw2 = readFileSync(file, 'utf8');
    assert.ok(!raw2.includes(second) && !raw2.includes(first));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('hook tokens: a legacy workers.json with a raw token is migrated to its hash', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ao-hook-legacy-'));
  const file = path.join(dir, 'workers.json');
  try {
    const legacy = 'e'.repeat(32);
    saveWorkers(file, [], false);
    require_write(file, JSON.stringify([{ ...info('w-old'), hookToken: legacy }]));
    const back = new Map();
    restoreWorkers(file, back, 'claude', () => false);
    const w = back.get('w-old');
    assert.ok(w);
    assert.equal(hookTokenOk(w, legacy), true);
    saveWorkers(file, back.values(), false);
    assert.ok(!readFileSync(file, 'utf8').includes(legacy), 'the raw legacy token is dropped on the next save');
    assert.ok(existsSync(file));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

import { writeFileSync as require_write } from 'node:fs';
