// DeepSeek seat MCP aliases: GET /bridge/chat and POST /say share the /api/bridge handlers.
// Fake seats and fake lines only. Loopback Host allowlist and seat-token rules stay as they are.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request, type Server } from 'node:http';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { requestHandler } from '../src/server/http/router.js';
import { bridgeRoutes } from '../src/server/http/routes/bridge.js';
import { routes } from '../src/server/http/routes/index.js';
import { issueSeatToken } from '../src/server/seat-tokens.js';

const SHARED = 'a'.repeat(64);
const FOREIGN_HOST = '192.0.2.10:4600';

type Line = { name?: string; text?: string; account?: boolean };

function setup() {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'ao-bridge-alias-'));
  writeFileSync(path.join(dataDir, 'bridge-token'), SHARED);
  const seat = issueSeatToken(dataDir, 'seat-1');
  const lines: Line[] = [];
  const signedIn = (req: { headers: { cookie?: string } }) => /(^|;\s*)ao=session(;|$)/.test(req.headers.cookie || '');
  const ctx = {
    cfg: { port: 4600, tailnet: undefined, dataDir },
    services: { lookup: () => undefined },
    auth: {
      fromRequest: (req: { headers: { cookie?: string } }) => (signedIn(req) ? { id: 'fake' } : undefined),
      fromAnyCookie: (req: { headers: { cookie?: string } }) => signedIn(req),
      sessionFromAnyCookie: (req: { headers: { cookie?: string } }) => (signedIn(req) ? { id: 'fake' } : undefined),
    },
    chat: {
      add: (line: Line) => lines.push(line),
      recent: (n: number) => lines.slice(-n),
    },
    broadcast: () => {},
    floors: new Map(),
  };
  return { dataDir, seat, lines, ctx };
}

async function withServer(ctx: ReturnType<typeof setup>['ctx'], fn: (port: number) => Promise<void>) {
  const srv: Server = createServer(requestHandler(ctx as never, routes));
  await new Promise<void>((ok) => srv.listen(0, '127.0.0.1', ok));
  try {
    await fn((srv.address() as { port: number }).port);
  } finally {
    srv.close();
  }
}

function call(
  port: number,
  method: string,
  p: string,
  headers: Record<string, string> = {},
  body?: unknown,
): Promise<{ status: number; raw: string; json: { lines?: Line[]; ok?: boolean; name?: string; text?: string; error?: string } | null }> {
  return new Promise((ok, bad) => {
    const h: Record<string, string> = { host: '127.0.0.1:4600', ...headers };
    if (body !== undefined && !h['content-type']) h['content-type'] = 'application/json';
    const rq = request({ host: '127.0.0.1', port, path: p, method, headers: h }, (res) => {
      let s = '';
      res.on('data', (c) => (s += c));
      res.on('end', () => ok({ status: res.statusCode || 0, raw: s, json: s.startsWith('{') ? JSON.parse(s) : null }));
    });
    rq.on('error', bad);
    rq.end(body === undefined ? undefined : JSON.stringify(body));
  });
}

test('short crew-chat paths are the same route objects as /api/bridge/chat and /api/bridge/say', () => {
  assert.deepEqual(bridgeRoutes.chatRecent.path, ['/api/bridge/chat', '/bridge/chat']);
  assert.equal(bridgeRoutes.chatRecent.method, 'GET');
  assert.deepEqual(bridgeRoutes.say.path, ['/api/bridge/say', '/say']);
  assert.equal(bridgeRoutes.say.method, 'POST');
  assert.ok(routes.includes(bridgeRoutes.chatRecent));
  assert.ok(routes.includes(bridgeRoutes.say));
});

test('GET /bridge/chat matches GET /api/bridge/chat for seat, shared, session, and refusals', async () => {
  const { dataDir, seat, lines, ctx } = setup();
  lines.push({ name: 'seat-1', text: 'FAKE earlier line', account: true });
  const paths = ['/api/bridge/chat', '/bridge/chat'] as const;
  try {
    await withServer(ctx, async (port) => {
      for (const p of paths) {
        const seatGet = await call(port, 'GET', `${p}?n=1`, { 'x-bridge-token': seat });
        assert.equal(seatGet.status, 200, p);
        assert.deepEqual(seatGet.json?.lines, [{ name: 'seat-1', text: 'FAKE earlier line', account: true }]);
        assert.ok(!seatGet.raw.includes(seat), p);

        const shared = await call(port, 'GET', p, { 'x-bridge-token': SHARED });
        assert.equal(shared.status, 200, p);
        assert.equal(shared.json?.lines?.length, 1);

        const session = await call(port, 'GET', p, { cookie: 'ao=session' });
        assert.equal(session.status, 200, p);

        const anon = await call(port, 'GET', p, {});
        assert.equal(anon.status, 401, p);

        const bad = await call(port, 'GET', p, { 'x-bridge-token': 'nope' });
        assert.equal(bad.status, 401, p);
        assert.ok(!bad.raw.includes(seat));

        const foreign = await call(port, 'GET', p, { host: FOREIGN_HOST, 'x-bridge-token': seat });
        assert.equal(foreign.status, 403, p);
        assert.equal(foreign.json?.error, 'host not allowed');
        assert.ok(!foreign.raw.includes(seat));

        const origin = await call(port, 'GET', p, { origin: 'http://192.0.2.10:4600', 'x-bridge-token': seat });
        assert.equal(origin.status, 403, p);
        assert.equal(origin.json?.error, 'origin not allowed');
      }
    });
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('POST /say matches POST /api/bridge/say: seat token speaks, shared and session cannot', async () => {
  const { dataDir, seat, lines, ctx } = setup();
  const paths = ['/api/bridge/say', '/say'] as const;
  try {
    await withServer(ctx, async (port) => {
      for (const p of paths) {
        const before = lines.length;
        const shared = await call(port, 'POST', p, { 'x-bridge-token': SHARED }, { name: 'seat-2', text: 'FAKE shared' });
        assert.equal(shared.status, 403, p);
        assert.equal(lines.length, before, p);

        const session = await call(port, 'POST', p, { cookie: 'ao=session' }, { text: 'FAKE session' });
        assert.equal(session.status, 403, p);
        assert.equal(session.json?.error, 'seat token required');
        assert.equal(lines.length, before, p);

        const anon = await call(port, 'POST', p, {}, { text: 'FAKE anon' });
        assert.equal(anon.status, 401, p);

        const mismatch = await call(port, 'POST', p, { 'x-bridge-token': seat }, { name: 'seat-2', text: 'FAKE other' });
        assert.equal(mismatch.status, 403, p);
        assert.equal(lines.length, before, p);

        const foreign = await call(port, 'POST', p, { host: FOREIGN_HOST, 'x-bridge-token': seat }, { text: 'FAKE lan' });
        assert.equal(foreign.status, 403, p);
        assert.equal(foreign.json?.error, 'host not allowed');
        assert.equal(lines.length, before, p);

        const said = await call(port, 'POST', p, { 'x-bridge-token': seat }, { text: `FAKE via ${p}` });
        assert.equal(said.status, 200, p);
        assert.equal(said.json?.ok, true);
        assert.equal(said.json?.name, 'seat-1');
        assert.equal(said.json?.text, `FAKE via ${p}`);
        assert.ok(!said.raw.includes(seat), p);
        assert.equal(lines.at(-1)?.name, 'seat-1');
        assert.equal(lines.at(-1)?.account, true);
        assert.equal(lines.at(-1)?.text, `FAKE via ${p}`);
      }

      const seen = await call(port, 'GET', '/bridge/chat', { 'x-bridge-token': SHARED });
      assert.equal(seen.status, 200);
      assert.deepEqual(
        seen.json?.lines?.map((l) => l.text),
        ['FAKE via /api/bridge/say', 'FAKE via /say'],
      );

      const notSay = await call(port, 'POST', '/bridge/say', { 'x-bridge-token': seat }, { text: 'FAKE wrong path' });
      assert.notEqual(notSay.status, 200);
      assert.equal(lines.length, 2);
    });
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});
