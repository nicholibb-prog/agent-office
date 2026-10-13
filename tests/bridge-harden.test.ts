// Bridge hardening: Host allowlist, Origin, Content-Type, token/session gate.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { bridgeGate, bridgeRoutes } from '../src/server/http/routes/bridge.js';
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

test('bridge say with shared token does not stamp account:true for an arbitrary body name', async () => {
  const dir = path.join(tmpdir(), 'ao-bridge-say-' + Date.now());
  mkdirSync(dir, { recursive: true });
  const tok = 's'.repeat(64);
  writeFileSync(path.join(dir, 'bridge-token'), tok);
  const lines: Record<string, unknown>[] = [];
  const ctx = {
    cfg: { dataDir: dir },
    auth: { fromRequest: () => undefined, fromAnyCookie: () => false },
    chat: { add(line: Record<string, unknown>) { lines.push(line); } },
    broadcast() {},
    floors: new Map(),
  } as never;
  const { res, got } = captureRes();
  const req = fakeIncoming({
    headers: {
      host: '127.0.0.1:4600',
      'content-type': 'application/json',
      'x-bridge-token': tok,
    },
    body: { name: 'Dan', text: 'hello from bridge' },
  });
  await bridgeRoutes.say.handle(ctx, { req, res });
  assert.equal(got().status, 200);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].name, 'Dan');
  assert.equal(lines[0].account, undefined);
  assert.equal('account' in lines[0], false);
  rmSync(dir, { recursive: true, force: true });
});

test('status and crew-status cannot flip desks by display name alone on shared token', async () => {
  const dir = path.join(tmpdir(), 'ao-bridge-st-' + Date.now());
  mkdirSync(dir, { recursive: true });
  const tok = 't'.repeat(64);
  writeFileSync(path.join(dir, 'bridge-token'), tok);

  const dan = deskWorker('Dan', 'desk-1', 'idle');
  const workers = new Map<string, Worker>([[dan.info.id, dan]]);
  const host: CrewHost = {
    workers,
    setStatus(w, status) { w.info.status = status; },
    emitUpdate() {},
  };

  // Display label alone must not apply.
  const byName = applyCrewPresence(host, { Dan: 'working', dan: 'working' }, { seen: { Dan: Date.now(), dan: Date.now() } });
  assert.deepEqual(byName.applied, []);
  assert.equal(dan.info.status, 'idle');

  // Seat id with fresh seen binds via desk-N.
  const bySeat = applyCrewPresence(host, { 'seat-1': 'working' }, { seen: { 'seat-1': Date.now() } });
  assert.deepEqual(bySeat.applied, ['Dan=working']);
  assert.equal(dan.info.status, 'working');

  // WORKING without seen stays / returns idle.
  dan.info.status = 'idle';
  const noSeen = applyCrewPresence(host, { 'seat-1': 'working' }, {});
  assert.deepEqual(noSeen.applied, ['Dan=idle']);
  assert.equal(dan.info.status, 'idle');

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

  const bad = captureRes();
  await bridgeRoutes.status.handle(ctx, {
    req: fakeIncoming({
      headers: { host: '127.0.0.1:4600', 'content-type': 'application/json', 'x-bridge-token': tok },
      body: { name: 'Dan', status: 'working' },
    }),
    res: bad.res,
  });
  assert.equal(bad.got().status, 400);
  assert.match(String(bad.got().json().error), /seat id/);
  assert.equal(dan.info.status, 'idle');

  const good = captureRes();
  await bridgeRoutes.status.handle(ctx, {
    req: fakeIncoming({
      headers: { host: '127.0.0.1:4600', 'content-type': 'application/json', 'x-bridge-token': tok },
      body: { name: 'seat-1', status: 'working' },
    }),
    res: good.res,
  });
  assert.equal(good.got().status, 200);
  assert.equal(dan.info.status, 'working');

  const crew = captureRes();
  dan.info.status = 'idle';
  await bridgeRoutes.crewStatus.handle(ctx, {
    req: fakeIncoming({
      headers: { host: '127.0.0.1:4600', 'content-type': 'application/json', 'x-bridge-token': tok },
      body: { crew: { Dan: 'working', 'seat-1': 'working' } },
    }),
    res: crew.res,
  });
  assert.equal(crew.got().status, 200);
  const payload = crew.got().json();
  assert.equal((payload.crew as Record<string, string>).Dan, undefined);
  assert.equal((payload.crew as Record<string, string>)['seat-1'], 'working');
  assert.equal(dan.info.status, 'working');

  const pushed = writeCrewPush(dir, { Dan: 'idle', 'seat-2': 'idle' }, 'test');
  assert.equal(pushed.crew.Dan, undefined);
  assert.equal(pushed.crew['seat-2'], 'idle');
  assert.ok(typeof pushed.seen['seat-2'] === 'number');

  rmSync(dir, { recursive: true, force: true });
});
