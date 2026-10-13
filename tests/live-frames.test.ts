// Live desk feed: seat from token, session-only viewing, off by default, size and rate caps.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { mkdirSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { issueSeatToken } from '../src/server/seat-tokens.js';
import { LiveFrames } from '../src/server/live-frames.js';
import { liveRoutesFor } from '../src/server/http/routes/live.js';

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, 1)]);

function setup(session = false) {
  const dir = path.join(tmpdir(), 'ao-live-' + process.pid + '-' + Math.random().toString(36).slice(2));
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'bridge-token'), 'c'.repeat(64));
  const ctx = { cfg: { dataDir: dir }, auth: { fromRequest: () => (session ? { id: 'p' } : undefined), fromAnyCookie: () => session } } as never;
  const store = new LiveFrames({ maxBytes: 1024, minIntervalMs: 250, staleMs: 10_000 });
  return { dir, ctx, store, r: liveRoutesFor(store) };
}

function req(method: string, headers: Record<string, string>, body?: unknown, url = '/'): IncomingMessage {
  const r = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]) as unknown as IncomingMessage;
  r.method = method;
  r.url = url;
  r.headers = { host: '127.0.0.1:4600', 'content-type': 'application/json', ...headers };
  return r;
}

async function call(route: { handle: (...a: never[]) => unknown }, ctx: never, r: IncomingMessage, p = '/') {
  let status = 0;
  let body: Buffer | string = '';
  const res = { writeHead(s: number) { status = s; return res; }, setHeader() {}, end(b?: unknown) { body = (b as Buffer) ?? ''; } } as unknown as ServerResponse;
  await (route.handle as (c: never, a: unknown) => unknown)(ctx, { req: r, res, path: p, url: new URL('http://127.0.0.1:4600' + p) });
  return { status, body };
}

const frame = (data = PNG, mime = 'image/png') => ({ mime, data: data.toString('base64') });

test('off by default: a seat cannot push until an office person switches it on', async () => {
  const { dir, ctx, r, store } = setup();
  const tok = issueSeatToken(dir, 'seat-a');
  assert.equal(store.enabled('seat-a'), false);
  const res = await call(r.push, ctx, req('POST', { 'x-bridge-token': tok }, frame()));
  assert.equal(res.status, 409);
  assert.equal(store.frame('seat-a'), undefined);
});

test('push auth: no token, bad token and shared token are rejected', async () => {
  const { ctx, r, store } = setup(true);
  store.setEnabled('seat-a', true);
  assert.equal((await call(r.push, ctx, req('POST', {}, frame()))).status, 403, 'session is not a seat');
  assert.equal((await call(r.push, ctx, req('POST', { 'x-bridge-token': 'nope'.repeat(10) }, frame()))).status, 401);
  assert.equal((await call(r.push, ctx, req('POST', { 'x-bridge-token': 'c'.repeat(64) }, frame()))).status, 403);
  assert.equal((await call(r.push, ctx, req('POST', { host: 'evil:80' }, frame()))).status, 403, 'host check');
  assert.equal((await call(r.push, ctx, req('POST', { origin: 'http://evil.example' }, frame()))).status, 403, 'origin check');
});

test('the seat comes from the token, never from the body', async () => {
  const { dir, ctx, r, store } = setup();
  const tok = issueSeatToken(dir, 'seat-a');
  store.setEnabled('seat-a', true);
  store.setEnabled('seat-b', true);
  const res = await call(r.push, ctx, req('POST', { 'x-bridge-token': tok }, { ...frame(), seat: 'seat-b', name: 'seat-b' }));
  assert.equal(res.status, 200);
  assert.ok(store.frame('seat-a'));
  assert.equal(store.frame('seat-b'), undefined);
});

test('size cap, image-type check and rate cap', async () => {
  const { dir, ctx, r, store } = setup();
  const tok = issueSeatToken(dir, 'seat-a');
  store.setEnabled('seat-a', true);
  const big = Buffer.concat([PNG, Buffer.alloc(2048)]);
  assert.equal((await call(r.push, ctx, req('POST', { 'x-bridge-token': tok }, frame(big)))).status, 413);
  assert.equal((await call(r.push, ctx, req('POST', { 'x-bridge-token': tok }, frame(Buffer.from('<svg/>'), 'image/png')))).status, 415);
  assert.equal((await call(r.push, ctx, req('POST', { 'x-bridge-token': tok }, frame()))).status, 200);
  assert.equal((await call(r.push, ctx, req('POST', { 'x-bridge-token': tok }, frame()))).status, 429);
  const t = Date.now();
  assert.equal(store.push('seat-a', 'image/png', PNG, t + 300).ok, true);
});

test('viewing needs an office session; seat tokens cannot view; no frame = no live feed', async () => {
  const anon = setup(false);
  anon.store.setEnabled('seat-a', true);
  anon.store.push('seat-a', 'image/png', PNG);
  assert.equal((await call(anon.r.frame, anon.ctx, req('GET', {}), '/api/live/frame/seat-a')).status, 401);
  assert.equal((await call(anon.r.seats, anon.ctx, req('GET', {}))).status, 401);
  assert.equal((await call(anon.r.toggle, anon.ctx, req('POST', {}, { seat: 'seat-a', on: false }))).status, 401);
  const tok = issueSeatToken(anon.dir, 'seat-a');
  assert.equal((await call(anon.r.frame, anon.ctx, req('GET', { 'x-bridge-token': tok }), '/api/live/frame/seat-a')).status, 403);

  const s = setup(true);
  assert.equal((await call(s.r.frame, s.ctx, req('GET', {}), '/api/live/frame/seat-a')).status, 404);
  s.store.setEnabled('seat-a', true);
  s.store.push('seat-a', 'image/png', PNG);
  const ok = await call(s.r.frame, s.ctx, req('GET', {}), '/api/live/frame/seat-a');
  assert.equal(ok.status, 200);
  assert.ok(Buffer.isBuffer(ok.body) && ok.body.equals(PNG));
  assert.equal(s.store.frame('seat-a', Date.now() + 11_000), undefined, 'stale frame is no live feed');
  s.store.setEnabled('seat-a', false);
  assert.equal(s.store.frame('seat-a'), undefined, 'switching off drops the frame');
});

test('frames stay in memory: nothing is written to the data dir', async () => {
  const { dir, ctx, r, store } = setup();
  const tok = issueSeatToken(dir, 'seat-a');
  const before = readdirSync(dir).sort();
  store.setEnabled('seat-a', true);
  await call(r.push, ctx, req('POST', { 'x-bridge-token': tok }, frame()));
  assert.deepEqual(readdirSync(dir).sort(), before);
});

test('desk face: idle has no live field (unchanged); working with no frame says no live feed', async () => {
  const { workerDesktop } = await import('../src/client/features/workers/desktop.js');
  assert.equal(workerDesktop({ status: 'idle', name: 'Seat A' }, undefined, 0, 0).live, undefined);
  assert.equal(workerDesktop({ status: 'working', name: 'Seat A' }, undefined, 0, 0).live, 'none');
});

test('stale frames are deleted from memory by frame() and list()', () => {
  const s = new LiveFrames({ maxBytes: 1024, minIntervalMs: 0, staleMs: 1000 });
  s.setEnabled('seat-a', true);
  s.setEnabled('seat-b', true);
  const t = Date.now();
  s.push('seat-a', 'image/png', PNG, t);
  s.push('seat-b', 'image/png', PNG, t);
  assert.equal(s.frame('seat-a', t + 2000), undefined);
  assert.equal(s.held('seat-a'), false, 'frame() dropped it');
  assert.deepEqual(s.list(t + 2000), [{ seat: 'seat-a', live: false }, { seat: 'seat-b', live: false }]);
  assert.equal(s.held('seat-b'), false, 'list() dropped it');
});

test('drive frames: off by default per seat, served with source=drive once switched on', async () => {
  const s = setup(true);
  const d = path.join(s.dir, 'bridge');
  mkdirSync(path.join(d, 'live'), { recursive: true });
  writeFileSync(path.join(d, 'live', 'seat-1.jpg'), Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32)]));
  const prev = process.env.AO_BRIDGE_LOCAL_DIR;
  process.env.AO_BRIDGE_LOCAL_DIR = d;
  try {
    assert.equal((await call(s.r.frame, s.ctx, req('GET', {}), '/api/live/frame/seat-1')).status, 404, 'off by default');
    s.store.setEnabled('seat-1', true);
    let hdrs: Record<string, string> = {};
    let status = 0;
    const res = { writeHead(c: number, h: Record<string, string>) { status = c; hdrs = h ?? {}; return res; }, setHeader() {}, end() {} } as unknown as ServerResponse;
    await (s.r.frame.handle as (c: never, a: unknown) => unknown)(s.ctx, { req: req('GET', {}), res, path: '/api/live/frame/seat-1' });
    assert.equal(status, 200);
    assert.equal(hdrs['x-frame-source'], 'drive');
    const anon = setup(false);
    anon.store.setEnabled('seat-1', true);
    assert.equal((await call(anon.r.frame, anon.ctx, req('GET', {}), '/api/live/frame/seat-1')).status, 401, 'session still required');
  } finally {
    if (prev === undefined) delete process.env.AO_BRIDGE_LOCAL_DIR;
    else process.env.AO_BRIDGE_LOCAL_DIR = prev;
  }
});
