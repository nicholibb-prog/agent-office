// Bridge hardening: Host allowlist, Origin, Content-Type, token/session gate.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { bridgeGate } from '../src/server/http/routes/bridge.js';

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

test('bridgeGate accepts x-bridge-token', () => {
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
      method: 'POST',
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
