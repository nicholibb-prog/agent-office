// Bridge hardening: Host allowlist, Origin, Content-Type, token/session gate.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { bridgeGate, bridgeRoutes } from '../src/server/http/routes/bridge.js';
import { issueSeatToken } from '../src/server/seat-tokens.js';
import { applyCrewPresence, writeCrewPush, type CrewHost } from '../src/server/workers/crew.js';
import type { Worker } from '../src/server/workers/types.js';
import type { WorkerInfo } from '../src/shared/protocol.js';

function fakeReq(partial: Partial<IncomingMessage> & { headers: Record<string, string | string[] | undefined>; method?: string }): IncomingMessage {
  return partial as IncomingMessage;
}

test('bridgeGate rejects foreign Host', async () => {
  const dir = path.join(tmpdir(), 'ao-bridge-' + Date.now());
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'bridge-token'), 'a'.repeat(64));
  const ctx = {
    cfg: { dataDir: dir },
    auth: { fromRequest: () => undefined, fromAnyCookie: () => false },
  } as never;
  let status = 0;
  let body = '';
  const res = {
    writeHead(s: number) { status = s; },
    end(b: string) { body = b; },
  } as unknown as ServerResponse;
  // monkey: send() uses writeHead+end via util — bridgeGate uses send which needs full res
  // Prefer integrating through status codes by stubbing carefully.
  const { send } = await import('../src/server/http/util.js');
  void send;
  const ok = bridgeGate(
    ctx,
    fakeReq({ headers: { host: 'evil.example:4600' }, method: 'GET' }),
    {
      writeHead(s: number, _h?: unknown) { status = s; },
      end(b?: unknown) { body = String(b ?? ''); },
    } as ServerResponse,
  );
  assert.equal(ok, false);
  assert.equal(status, 403);
  rmSync(dir, { recursive: true, force: true });
});

test('bridgeGate rejects foreign Origin', () => {
  const dir = path.join(tmpdir(), 'ao-bridge-o-' + Date.now());
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'bridge-token'), 'b'.repeat(64));
  const ctx = {
    cfg: { dataDir: dir },
    auth: { fromRequest: () => undefined, fromAnyCookie: () => false },
  } as never;
  let status = 0;
  const ok = bridgeGate(
    ctx,
    fakeReq({ headers: { host: '127.0.0.1:4600', origin: 'http://evil.example' }, method: 'GET' }),
    {
      writeHead(s: number) { status = s; },
      end() {},
    } as ServerResponse,
  );
  assert.equal(ok, false);
  assert.equal(status, 403);
  rmSync(dir, { recursive: true, force: true });
});

test('bridgeGate POST requires application/json', () => {
  const dir = path.join(tmpdir(), 'ao-bridge-ct-' + Date.now());
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'bridge-token'), 'c'.repeat(64));
  const ctx = {
    cfg: { dataDir: dir },
    auth: { fromRequest: () => undefined, fromAnyCookie: () => false },
  } as never;
  let status = 0;
  const ok = bridgeGate(
    ctx,
    fakeReq({ headers: { host: '127.0.0.1:4600', 'content-type': 'text/plain' }, method: 'POST' }),
    {
      writeHead(s: number) { status = s; },
      end() {},
    } as ServerResponse,
  );
  assert.equal(ok, false);
  assert.equal(status, 415);
  rmSync(dir, { recursive: true, force: true });
});

test('bridgeGate accepts the shared x-bridge-token for GET (read-only)', () => {
  const dir = path.join(tmpdir(), 'ao-bridge-t-' + Date.now());
  mkdirSync(dir, { recursive: true });
  const tok = 'd'.repeat(64);
  writeFileSync(path.join(dir, 'bridge-token'), tok);
  const ctx = {
    cfg: { dataDir: dir },
    auth: { fromRequest: () => undefined, fromAnyCookie: () => false },
  } as never;
  const ok = bridgeGate(
    ctx,
    fakeReq({
      headers: { host: '127.0.0.1:4600', 'content-type': 'application/json', 'x-bridge-token': tok },
      method: 'GET',
    }),
    { writeHead() {}, end() {} } as ServerResponse,
  );
  assert.equal(ok, true);
  rmSync(dir, { recursive: true, force: true });
});

test('bridgeGate accepts Authorization Bearer', () => {
  const dir = path.join(tmpdir(), 'ao-bridge-b-' + Date.now());
  mkdirSync(dir, { recursive: true });
  const tok = 'e'.repeat(64);
  writeFileSync(path.join(dir, 'bridge-token'), tok);
  const ctx = {
    cfg: { dataDir: dir },
    auth: { fromRequest: () => undefined, fromAnyCookie: () => false },
  } as never;
  const ok = bridgeGate(
    ctx,
    fakeReq({
      headers: { host: 'localhost:5173', authorization: 'Bearer ' + tok },
      method: 'GET',
    }),
    { writeHead() {}, end() {} } as ServerResponse,
  );
  assert.equal(ok, true);
  rmSync(dir, { recursive: true, force: true });
});

test('bridgeGate accepts office session cookie without token', () => {
  const dir = path.join(tmpdir(), 'ao-bridge-s-' + Date.now());
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'bridge-token'), 'f'.repeat(64));
  const ctx = {
    cfg: { dataDir: dir },
    auth: { fromRequest: () => ({ accountId: 'x' }), fromAnyCookie: () => true },
  } as never;
  const ok = bridgeGate(
    ctx,
    fakeReq({ headers: { host: '127.0.0.1:4600' }, method: 'GET' }),
    { writeHead() {}, end() {} } as ServerResponse,
  );
  assert.equal(ok, true);
  rmSync(dir, { recursive: true, force: true });
});

test('bridgeGate rejects when no token and no session (loopback Host alone insufficient)', () => {
  const dir = path.join(tmpdir(), 'ao-bridge-n-' + Date.now());
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'bridge-token'), 'g'.repeat(64));
  const ctx = {
    cfg: { dataDir: dir },
    auth: { fromRequest: () => undefined, fromAnyCookie: () => false },
  } as never;
  let status = 0;
  const ok = bridgeGate(
    ctx,
    fakeReq({ headers: { host: '127.0.0.1:4600' }, method: 'GET' }),
    {
      writeHead(s: number) { status = s; },
      end() {},
    } as ServerResponse,
  );
  assert.equal(ok, false);
  assert.equal(status, 401);
  rmSync(dir, { recursive: true, force: true });
});

function captureRes() {
  let status = 0;
  let body = '';
  const res = {
    writeHead(s: number) { status = s; },
    end(b?: unknown) { body = String(b ?? ''); },
  } as unknown as ServerResponse;
  return {
    res,
    got: () => ({ status, body, json: () => JSON.parse(body || '{}') as Record<string, unknown> }),
  };
}

function fakeIncoming(partial: {
  method?: string;
  headers?: Record<string, string>;
  body?: object;
}): IncomingMessage {
  const headers = partial.headers || {};
  const req = {
    method: partial.method || 'POST',
    headers,
    on(event: string, cb: (...args: unknown[]) => void) {
      if (event === 'data') cb(Buffer.from(JSON.stringify(partial.body ?? {})));
      if (event === 'end') cb();
      return req;
    },
  };
  return req as unknown as IncomingMessage;
}

function deskWorker(name: string, deskId: string, status: WorkerInfo['status'] = 'idle'): Worker {
  const info = {
    id: 'w-' + deskId,
    kind: 'shell' as const,
    deskId,
    name,
    color: '#fff',
    status,
    acked: true,
    createdBy: 'test',
    createdAt: 1,
    cols: 80,
    rows: 24,
    viewers: [],
    viewerIds: [],
  };
  return { info, viewers: new Map(), screenDirty: false, lastLines: [], leftNeedsInputAt: 0, keyframeAt: 0, hookToken: 'x', state: null } as unknown as Worker;
}

test('bridge say: shared token cannot post, seat token speaks only as its seat with account:true', async () => {
  const dir = path.join(tmpdir(), 'ao-bridge-say-' + Date.now());
  mkdirSync(dir, { recursive: true });
  const tok = 's'.repeat(64);
  writeFileSync(path.join(dir, 'bridge-token'), tok);
  const seatTok = issueSeatToken(dir, 'seat-1');
  const lines: Record<string, unknown>[] = [];
  const ctx = {
    cfg: { dataDir: dir },
    auth: { fromRequest: () => undefined, fromAnyCookie: () => false },
    chat: { add(line: Record<string, unknown>) { lines.push(line); } },
    broadcast() {},
    floors: new Map(),
  } as never;
  const say = async (token: string | undefined, body: Record<string, unknown>) => {
    const { res, got } = captureRes();
    const headers: Record<string, string> = { host: '127.0.0.1:4600', 'content-type': 'application/json' };
    if (token) headers['x-bridge-token'] = token;
    await bridgeRoutes.say.handle(ctx, { req: fakeIncoming({ headers, body }), res });
    return got();
  };
  assert.equal((await say(tok, { name: 'Dan', text: 'hello' })).status, 403);
  assert.equal((await say(seatTok, { name: 'Dan', text: 'hello' })).status, 403);
  assert.equal((await say(undefined, { name: 'Dan', text: 'hello' })).status, 401);
  assert.equal(lines.length, 0);
  assert.equal((await say(seatTok, { text: 'hello' })).status, 200);
  assert.equal(lines[0].name, 'seat-1');
  assert.equal(lines[0].account, true);
  rmSync(dir, { recursive: true, force: true });
});

test('bridge/status and crew-status take the seat from the #20 seat token, never the body name', async () => {
  const dir = path.join(tmpdir(), 'ao-bridge-st-' + Date.now());
  mkdirSync(dir, { recursive: true });
  const tok = 't'.repeat(64);
  writeFileSync(path.join(dir, 'bridge-token'), tok);
  const seatTok = issueSeatToken(dir, 'seat-1');

  const dan = deskWorker('Dan', 'desk-1', 'idle');
  const workers = new Map<string, Worker>([[dan.info.id, dan]]);
  const host: CrewHost = {
    workers,
    setStatus(w, status) { w.info.status = status; },
    emitUpdate() {},
  };
  const ctx = {
    cfg: { dataDir: dir },
    auth: { fromRequest: () => undefined, fromAnyCookie: () => false },
    floors: new Map([['main', {
      id: 'main',
      workers: {
        applyCrewPresence: (crew: Record<string, string>, opts?: { seen?: Record<string, number> }) =>
          applyCrewPresence(host, crew, opts),
      },
    }]]),
  } as never;
  const hit = async (route: 'status' | 'crewStatus', token: string | undefined, body: Record<string, unknown>) => {
    const { res, got } = captureRes();
    const headers: Record<string, string> = { host: '127.0.0.1:4600', 'content-type': 'application/json' };
    if (token) headers['x-bridge-token'] = token;
    await bridgeRoutes[route].handle(ctx, { req: fakeIncoming({ headers, body }), res });
    return got();
  };

  // Display labels alone never apply.
  assert.deepEqual(applyCrewPresence(host, { Dan: 'working' }, { seen: { Dan: Date.now() } }).applied, []);
  assert.equal(dan.info.status, 'idle');

  // Mismatched body name -> 403, even with a valid seat token.
  const bad = await hit('status', seatTok, { name: 'Dan', status: 'working' });
  assert.equal(bad.status, 403);
  assert.equal((await hit('status', seatTok, { name: 'seat-2', status: 'working' })).status, 403);
  assert.equal(dan.info.status, 'idle');

  // No token -> existing auth refusal; shared token -> read-only refusal.
  assert.equal((await hit('status', undefined, { status: 'working' })).status, 401);
  assert.equal((await hit('status', tok, { name: 'seat-1', status: 'working' })).status, 403);
  assert.equal(dan.info.status, 'idle');

  // Token seat used: no name, or the matching name, binds seat-1 -> desk-1.
  const good = await hit('status', seatTok, { status: 'working' });
  assert.equal(good.status, 200);
  assert.equal(good.json().name, 'seat-1');
  assert.equal(dan.info.status, 'working');
  dan.info.status = 'idle';
  assert.equal((await hit('status', seatTok, { name: 'SEAT-1', status: 'working' })).status, 200);
  assert.equal(dan.info.status, 'working');

  // crew-status: only the token's own seat key.
  dan.info.status = 'idle';
  assert.equal((await hit('crewStatus', seatTok, { crew: { Dan: 'working', 'seat-1': 'working' } })).status, 403);
  assert.equal(dan.info.status, 'idle');
  const crew = await hit('crewStatus', seatTok, { crew: { 'seat-1': 'working' } });
  assert.equal(crew.status, 200);
  assert.equal((crew.json().crew as Record<string, string>)['seat-1'], 'working');
  assert.equal(dan.info.status, 'working');

  const pushed = writeCrewPush(dir, { Dan: 'idle', 'seat-2': 'idle' }, 'test');
  assert.equal(pushed.crew.Dan, undefined);
  assert.equal(pushed.crew['seat-2'], 'idle');
  assert.ok(typeof pushed.seen['seat-2'] === 'number');

  rmSync(dir, { recursive: true, force: true });
});
