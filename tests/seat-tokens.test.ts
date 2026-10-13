// Per-seat bridge tokens. Fake seats and fake data only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { mkdirSync, writeFileSync, readFileSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { issueSeatToken, revokeSeatToken, seatForToken, listSeats } from '../src/server/seat-tokens.js';
import { bridgeRoutes } from '../src/server/http/routes/bridge.js';

const SHARED = 'c'.repeat(64);

function setup(session = false) {
  const dir = path.join(tmpdir(), 'ao-seat-' + process.pid + '-' + Math.random().toString(36).slice(2));
  mkdirSync(path.join(dir, '.agent-office'), { recursive: true });
  writeFileSync(path.join(dir, 'bridge-token'), SHARED);
  const chat: { name: string; account?: boolean }[] = [];
  const applied: Record<string, string>[] = [];
  const ctx = {
    cfg: { dataDir: dir },
    auth: { fromRequest: () => (session ? { id: 'fake' } : undefined), fromAnyCookie: () => session },
    chat: { add: (l: { name: string; account?: boolean }) => chat.push(l), recent: () => [] },
    broadcast: () => {},
    floors: new Map([['f', { id: 'f', dir, workers: { chatWorking() {}, applyCrewPresence: (c: Record<string, string>) => (applied.push(c), { applied: Object.keys(c) }) } }]]),
  } as never;
  return { dir, ctx, chat, applied };
}

function req(method: string, token: string | undefined, body?: unknown): IncomingMessage {
  const r = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]) as unknown as IncomingMessage;
  r.method = method;
  r.headers = { host: '127.0.0.1:4600', 'content-type': 'application/json', ...(token ? { 'x-bridge-token': token } : {}) };
  return r;
}

async function call(route: { handle: (...a: never[]) => unknown }, ctx: never, r: IncomingMessage) {
  let status = 0;
  let body = '';
  const res = { writeHead(s: number) { status = s; return res; }, setHeader() {}, end(b?: unknown) { body = String(b ?? ''); } } as unknown as ServerResponse;
  await (route.handle as (c: never, a: unknown) => unknown)(ctx, { req: r, res, url: new URL('http://127.0.0.1:4600/') });
  return { status, body };
}

test('store keeps only a hash in a 0600 file, rotates and revokes per seat', () => {
  const { dir } = setup();
  const a = issueSeatToken(dir, 'seat-a');
  const b = issueSeatToken(dir, 'seat-b');
  assert.ok(Buffer.from(a, 'base64url').length >= 32);
  const raw = readFileSync(path.join(dir, 'seat-tokens.json'), 'utf8');
  assert.ok(!raw.includes(a) && !raw.includes(b));
  assert.equal(statSync(path.join(dir, 'seat-tokens.json')).mode & 0o777, 0o600);
  assert.equal(seatForToken(dir, a), 'seat-a');
  const a2 = issueSeatToken(dir, 'seat-a');
  assert.equal(seatForToken(dir, a), null, 'rotated token is dead');
  assert.equal(seatForToken(dir, a2), 'seat-a');
  assert.ok(revokeSeatToken(dir, 'seat-a'));
  assert.equal(seatForToken(dir, a2), null);
  assert.equal(seatForToken(dir, b), 'seat-b', 'other seat unaffected');
  assert.deepEqual(listSeats(dir).map((s) => s.seat), ['seat-b']);
  assert.ok(!JSON.stringify(listSeats(dir)).includes(b));
  assert.throws(() => issueSeatToken(dir, 'Bad Seat!'));
  rmSync(dir, { recursive: true, force: true });
});

test('bad, missing, or revoked token gets 401', async () => {
  const { dir, ctx } = setup();
  const t = issueSeatToken(dir, 'seat-a');
  revokeSeatToken(dir, 'seat-a');
  for (const tok of ['nope', undefined, t]) {
    const r = await call(bridgeRoutes.say, ctx, req('POST', tok, { text: 'hi' }));
    assert.equal(r.status, 401, String(tok));
    assert.ok(!r.body.includes(t));
  }
  rmSync(dir, { recursive: true, force: true });
});

test('bad token is 401 even with a session cookie', async () => {
  const { dir, ctx } = setup(true);
  assert.equal((await call(bridgeRoutes.chatRecent, ctx, req('GET', 'nope'))).status, 401);
  rmSync(dir, { recursive: true, force: true });
});

test('say stamps account only from the token seat and rejects a body claiming another name', async () => {
  const { dir, ctx, chat } = setup();
  const t = issueSeatToken(dir, 'seat-a');
  const bad = await call(bridgeRoutes.say, ctx, req('POST', t, { name: 'george', text: 'hi' }));
  assert.equal(bad.status, 403);
  assert.equal(chat.length, 0);
  const ok = await call(bridgeRoutes.say, ctx, req('POST', t, { text: 'hi' }));
  assert.equal(ok.status, 200);
  assert.equal(chat[0].name, 'seat-a');
  assert.equal(chat[0].account, true);
  assert.ok(!ok.body.includes(t), 'token never echoed');
  rmSync(dir, { recursive: true, force: true });
});

test('seat A cannot set seat B status', async () => {
  const { dir, ctx, applied } = setup();
  const a = issueSeatToken(dir, 'seat-1');
  issueSeatToken(dir, 'seat-2');
  assert.equal((await call(bridgeRoutes.status, ctx, req('POST', a, { name: 'seat-2', status: 'working' }))).status, 403);
  assert.equal((await call(bridgeRoutes.crewStatus, ctx, req('POST', a, { crew: { 'seat-2': 'working' } }))).status, 403);
  assert.equal(applied.length, 0);
  assert.equal((await call(bridgeRoutes.status, ctx, req('POST', a, { status: 'idle' }))).status, 200);
  assert.deepEqual(applied.at(-1), { 'seat-1': 'idle' });
  rmSync(dir, { recursive: true, force: true });
});

test('shared token is GET only and can never post as anyone', async () => {
  const { dir, ctx, chat } = setup();
  assert.equal((await call(bridgeRoutes.chatRecent, ctx, req('GET', SHARED))).status, 200);
  for (const [route, body] of [
    [bridgeRoutes.say, { name: 'george', text: 'hi' }],
    [bridgeRoutes.status, { name: 'george', status: 'working' }],
    [bridgeRoutes.crewStatus, { crew: { george: 'working' } }],
    [bridgeRoutes.kaviOutbox, { text: 'x' }],
  ] as const) {
    assert.equal((await call(route, ctx, req('POST', SHARED, body))).status, 403);
  }
  assert.equal(chat.length, 0);
  rmSync(dir, { recursive: true, force: true });
});

test('a signed-in session cannot speak or set presence through the bridge', async () => {
  const { dir, ctx, chat } = setup(true);
  assert.equal((await call(bridgeRoutes.say, ctx, req('POST', undefined, { name: 'george', text: 'hi' }))).status, 403);
  assert.equal(chat.length, 0);
  rmSync(dir, { recursive: true, force: true });
});

test('seat token code never logs', () => {
  for (const f of ['src/server/seat-tokens.ts', 'src/server/http/routes/bridge.ts']) {
    assert.ok(!readFileSync(path.join(process.cwd(), f), 'utf8').includes('console.'), f);
  }
});
