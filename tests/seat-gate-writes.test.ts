// Dan's #28 FIX: hq-brief writes and kavi-feed/outbox POSTs need a #20 seat token and record the seat.
// Fake seats and fake data only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { issueSeatToken } from '../src/server/seat-tokens.js';
import { bridgeRoutes } from '../src/server/http/routes/bridge.js';
import { hqBriefRoutes } from '../src/server/http/routes/hq-brief.js';

const SHARED = 'd'.repeat(64);

function setup() {
  const dir = path.join(tmpdir(), 'ao-seatgate-' + process.pid + '-' + Math.random().toString(36).slice(2));
  mkdirSync(path.join(dir, '.agent-office'), { recursive: true });
  writeFileSync(path.join(dir, 'bridge-token'), SHARED);
  const ctx = {
    cfg: { dataDir: dir },
    auth: { fromRequest: () => undefined, fromAnyCookie: () => false },
    chat: { add() {}, recent: () => [] },
    broadcast: () => {},
    floors: new Map(),
  } as never;
  return { dir, ctx };
}

function req(token: string | undefined, body: unknown): IncomingMessage {
  const r = Readable.from([Buffer.from(JSON.stringify(body))]) as unknown as IncomingMessage;
  r.method = 'POST';
  r.headers = { host: '127.0.0.1:4600', 'content-type': 'application/json', ...(token ? { 'x-bridge-token': token } : {}) };
  return r;
}

async function call(route: { handle: (...a: never[]) => unknown }, ctx: never, r: IncomingMessage) {
  let status = 0;
  let body = '';
  const res = { statusCode: 0, writeHead(s: number) { status = s; return res; }, setHeader() {}, end(b?: unknown) { body = String(b ?? ''); } } as unknown as ServerResponse;
  await (route.handle as (c: never, a: unknown) => unknown)(ctx, { req: r, res, url: new URL('http://127.0.0.1:4600/') });
  return { status: status || (res as { statusCode: number }).statusCode, body };
}

const read = (f: string) => JSON.parse(readFileSync(f, 'utf8')) as Record<string, unknown>;

const CASES = [
  { name: 'hq-brief seen', route: hqBriefRoutes.seen, body: { at: 1 }, file: 'last-visit.json', seatOf: (j: Record<string, unknown>) => j.seat },
  { name: 'unblock', route: hqBriefRoutes.needs, body: { blocks: [] }, file: 'unblock.json', seatOf: (j: Record<string, unknown>) => j.seat },
  { name: 'board-status', route: hqBriefRoutes.board, body: { items: [] }, file: 'board-status.json', seatOf: (j: Record<string, unknown>) => j.seat },
  { name: 'kavi-feed', route: bridgeRoutes.kaviFeed, body: { titles: [{ name: 'a doc' }] }, file: 'kavi-feed.json', seatOf: (j: Record<string, unknown>) => j.seat },
  { name: 'kavi-outbox', route: bridgeRoutes.kaviOutbox, body: { text: 'hello' }, file: 'kavi-outbox.json', seatOf: (j: Record<string, unknown>) => (j.items as { seat?: string }[]).at(-1)?.seat },
] as const;

for (const c of CASES) {
  test(`${c.name}: no token 401, shared token 403, seat token works and the seat is recorded`, async () => {
    const { dir, ctx } = setup();
    const file = path.join(dir, c.file);
    assert.equal((await call(c.route, ctx, req(undefined, c.body))).status, 401);
    assert.equal((await call(c.route, ctx, req(SHARED, c.body))).status, 403);
    assert.equal(existsSync(file), false, 'nothing written before a seat token');
    const tok = issueSeatToken(dir, 'seat-7');
    const ok = await call(c.route, ctx, req(tok, c.body));
    assert.equal(ok.status, 200, ok.body);
    assert.equal(JSON.parse(ok.body).seat, 'seat-7');
    assert.ok(!ok.body.includes(tok), 'token never echoed');
    assert.equal(c.seatOf(read(file)), 'seat-7');
    rmSync(dir, { recursive: true, force: true });
  });
}
