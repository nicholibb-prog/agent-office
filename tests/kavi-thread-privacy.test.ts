// GET /api/kavi/thread is owner-only (same gate as Okkin's Ask, #58). Fake data and temp folders only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request, type Server } from 'node:http';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { requestHandler } from '../src/server/http/router.js';
import { kaviSendRoutes } from '../src/server/http/routes/kavi-send.js';
import { OKKIN_REFUSALS_LOG } from '../src/server/hq/okkin-owner.js';
import { testOwner, TEST_PASSPHRASE } from './support/okkin-owner.js';

const OWNER_SECRET = 'FAKE owner note to kavi 7f3a';
const KAVI_SECRET = 'FAKE kavi reply to george 9c1b';

function bridge() {
  const root = mkdtempSync(path.join(tmpdir(), 'ao-kpriv-'));
  mkdirSync(path.join(root, 'to-kavi'), { recursive: true });
  mkdirSync(path.join(root, 'to-george'), { recursive: true });
  writeFileSync(path.join(root, 'to-kavi', 'owner-to-kavi-2026-10-13.md'), OWNER_SECRET);
  writeFileSync(path.join(root, 'to-george', 'reply.txt'), KAVI_SECRET);
  return root;
}

async function withServer(dataDir: string, fn: (port: number) => Promise<void>) {
  const hasSession = (req: { headers: { cookie?: string } }) => /(^|;\s*)ao=session(;|$)/.test(req.headers.cookie || '');
  const ctx = {
    cfg: { port: 4600, tailnet: undefined, dataDir },
    services: { lookup: () => undefined },
    auth: {
      fromRequest: (req: never) => (hasSession(req) ? {} : undefined),
      fromAnyCookie: (req: never) => hasSession(req),
      sessionFromAnyCookie: (req: never) => (hasSession(req) ? {} : undefined),
    },
  } as never;
  const srv: Server = createServer(requestHandler(ctx, [kaviSendRoutes.thread]));
  await new Promise<void>((ok) => srv.listen(0, '127.0.0.1', ok));
  try {
    await fn((srv.address() as { port: number }).port);
  } finally {
    srv.close();
  }
}
function get(port: number, headers: Record<string, string>): Promise<{ status: number; body: string; json: any }> {
  return new Promise((ok, bad) => {
    const rq = request({ host: '127.0.0.1', port, path: '/api/kavi/thread', method: 'GET', headers: { host: '127.0.0.1:4600', ...headers } }, (res) => {
      let s = '';
      res.on('data', (c) => (s += c));
      res.on('end', () => ok({ status: res.statusCode || 0, body: s, json: s.startsWith('{') ? JSON.parse(s) : null }));
    });
    rq.on('error', bad);
    rq.end();
  });
}
const leaks = (s: string) => s.includes(OWNER_SECRET) || s.includes(KAVI_SECRET);

test('kavi thread privacy: every caller type', async () => {
  const r = bridge();
  const dataDir = mkdtempSync(path.join(tmpdir(), 'ao-kpriv-data-'));
  const prev = process.env.AGENT_OFFICE_KAVI_BRIDGE_DIR;
  process.env.AGENT_OFFICE_KAVI_BRIDGE_DIR = r;
  const { cookie } = await testOwner();
  const owner = cookie();
  const log = path.join(dataDir, OKKIN_REFUSALS_LOG);
  try {
    await withServer(dataDir, async (port) => {
      // No session at all: 401, no text.
      const none = await get(port, {});
      assert.equal(none.status, 401);
      assert.ok(!leaks(none.body));

      // Owner cookie with no office session: still 401.
      const ownerOnly = await get(port, { cookie: owner });
      assert.equal(ownerOnly.status, 401);
      assert.ok(!leaks(ownerOnly.body));

      // Password (office) session that is not owner: 200, empty and private.
      const pw = await get(port, { cookie: 'ao=session' });
      assert.equal(pw.status, 200);
      assert.deepEqual(pw.json.messages, []);
      assert.deepEqual(pw.json.items, []);
      assert.equal(pw.json.private, true);
      assert.ok(!leaks(pw.body));

      // Owner: full text, private false.
      const own = await get(port, { cookie: `ao=session; ${owner}` });
      assert.equal(own.status, 200);
      assert.equal(own.json.private, false);
      assert.equal(own.json.state, 'ok');
      assert.ok(own.body.includes(OWNER_SECRET) && own.body.includes(KAVI_SECRET));

      // Bot credentials, alone and alongside session + owner cookie: 403, logged, no text.
      const bots: Record<string, string>[] = [
        { 'x-bridge-token': 'a'.repeat(64) },
        { authorization: 'Bearer ' + 'b'.repeat(64) },
        { 'x-pool-caller': 'pool-seat-1' },
      ];
      for (const b of bots) {
        for (const extra of [{}, { cookie: `ao=session; ${owner}` }]) {
          const res = await get(port, { ...b, ...extra });
          assert.equal(res.status, 403, JSON.stringify(b) + JSON.stringify(extra));
          assert.equal(res.json.error, 'owner only');
          assert.ok(!leaks(res.body));
        }
      }
      assert.ok(existsSync(log));
      const lines = readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
      assert.equal(lines.length, 6);
      for (const l of lines) assert.equal(l.route, 'GET /api/kavi/thread');
      assert.deepEqual([...new Set(lines.map((l) => l.caller))].sort(), ['bearer', 'bridge-token', 'pool-caller']);
      const raw = readFileSync(log, 'utf8');
      for (const secret of ['a'.repeat(64), 'b'.repeat(64), 'pool-seat-1', TEST_PASSPHRASE, owner.split('=')[1]]) {
        assert.ok(!raw.includes(secret), 'log must not carry secrets');
      }
    });
  } finally {
    if (prev === undefined) delete process.env.AGENT_OFFICE_KAVI_BRIDGE_DIR;
    else process.env.AGENT_OFFICE_KAVI_BRIDGE_DIR = prev;
    rmSync(r, { recursive: true, force: true });
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('kavi thread fs-spy: a non-owner GET reads nothing from the bridge folder; the owner does', async () => {
  const { threadFs } = await import('../src/server/kavi-thread.js');
  const r = bridge();
  const dataDir = mkdtempSync(path.join(tmpdir(), 'ao-kpriv-spy-'));
  const prev = process.env.AGENT_OFFICE_KAVI_BRIDGE_DIR;
  process.env.AGENT_OFFICE_KAVI_BRIDGE_DIR = r;
  const { cookie } = await testOwner();
  const owner = cookie();
  const orig = { ...threadFs };
  const calls: string[] = [];
  threadFs.realpathSync = (p: string) => (calls.push('realpath:' + p), orig.realpathSync(p));
  threadFs.listNames = (p: string, max: number) => (calls.push('list:' + p), orig.listNames(p, max));
  try {
    await withServer(dataDir, async (port) => {
      const pw = await get(port, { cookie: 'ao=session' });
      assert.equal(pw.status, 200);
      assert.equal(pw.json.private, true);
      assert.deepEqual(calls, [], 'non-owner must not touch the bridge folder');
      for (const b of [{ 'x-bridge-token': 'a'.repeat(64) }, { authorization: 'Bearer x' }, { 'x-pool-caller': 'p' }]) {
        assert.equal((await get(port, { ...b, cookie: `ao=session; ${owner}` })).status, 403);
      }
      assert.equal((await get(port, {})).status, 401);
      assert.deepEqual(calls, [], 'refused callers must not touch the bridge folder');
      // Positive control: the spy does see the owner's read.
      const own = await get(port, { cookie: `ao=session; ${owner}` });
      assert.equal(own.status, 200);
      assert.ok(calls.some((c) => c.startsWith('realpath:')) && calls.some((c) => c.startsWith('list:')));
    });
  } finally {
    Object.assign(threadFs, orig);
    if (prev === undefined) delete process.env.AGENT_OFFICE_KAVI_BRIDGE_DIR;
    else process.env.AGENT_OFFICE_KAVI_BRIDGE_DIR = prev;
    rmSync(r, { recursive: true, force: true });
    rmSync(dataDir, { recursive: true, force: true });
  }
});
