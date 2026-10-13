// Owner -> Kavi through the Bridge folder's to-kavi path. Fake data and temp folders only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request, type Server } from 'node:http';
import { mkdirSync, writeFileSync, rmSync, readdirSync, readFileSync, symlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  BRIDGE_ID_MARKER, KAVI_BRIDGE_FOLDER_ID, MAX_FILE_BYTES, isMajorFiles, readBack, sendFile, sendMessage, safeName,
} from '../src/server/kavi-send.js';
import { requestHandler } from '../src/server/http/router.js';
import { kaviSendRoutes } from '../src/server/http/routes/kavi-send.js';

function bridge(id = KAVI_BRIDGE_FOLDER_ID) {
  const root = path.join(tmpdir(), 'ao-kbridge-' + process.pid + '-' + Math.random().toString(36).slice(2));
  mkdirSync(path.join(root, 'to-kavi'), { recursive: true });
  mkdirSync(path.join(root, 'from-kavi'), { recursive: true });
  writeFileSync(path.join(root, 'from-kavi', 'secret-reply.md'), 'fake');
  if (id) writeFileSync(path.join(root, BRIDGE_ID_MARKER), id + '\n');
  return root;
}
const files = (root: string) => readdirSync(path.join(root, 'to-kavi')).sort();

test('parent-id read-back: a send returns the pinned Bridge folder id', () => {
  const r = bridge();
  const out = sendMessage(r, 'hello Kavi');
  assert.equal(out.folderId, '1PX8OuEqf8rYYUro7dR3aq0NN8RGg7I1Q');
  assert.equal(out.live, false);
  const f = sendFile(r, 'plan.pdf', Buffer.from('%PDF fake'));
  assert.equal(f.folderId, KAVI_BRIDGE_FOLDER_ID);
  assert.deepEqual(readBack(r), { configured: true, folderId: KAVI_BRIDGE_FOLDER_ID, verified: true, live: false });
  rmSync(r, { recursive: true, force: true });
});

test('read-back shows only the folder id and lists nothing', () => {
  const r = bridge();
  sendMessage(r, 'x');
  const rb = readBack(r) as unknown as Record<string, unknown>;
  assert.deepEqual(Object.keys(rb).sort(), ['configured', 'folderId', 'live', 'verified']);
  assert.ok(!JSON.stringify(rb).includes('secret-reply'));
  assert.ok(!JSON.stringify(rb).includes('owner-to-kavi'));
  rmSync(r, { recursive: true, force: true });
});

test('a wrong or missing folder id refuses the send and writes nothing', () => {
  for (const id of ['1WRONGfolderid', '']) {
    const r = bridge(id);
    assert.throws(() => sendMessage(r, 'hi'), /did not read back/);
    assert.equal(readBack(r).verified, false);
    assert.equal(readBack(r).folderId, null);
    assert.deepEqual(files(r), []);
    rmSync(r, { recursive: true, force: true });
  }
  assert.equal(readBack(undefined).configured, false);
});

test('writes stay inside to-kavi: traversal, absolute and separator names refused', () => {
  const r = bridge();
  for (const bad of ['../evil.txt', '..', '/etc/passwd.txt', 'C:\\x.txt', 'a/b.txt', 'a\\b.txt', '.hidden.txt', 'nul\x00.txt']) {
    assert.throws(() => sendFile(r, bad, Buffer.from('x')), /bad file name/, bad);
  }
  assert.deepEqual(files(r), []);
  assert.ok(!existsSync(path.join(r, 'evil.txt')));
  rmSync(r, { recursive: true, force: true });
});

test('a symlinked to-kavi is refused (realpath check)', () => {
  const r = bridge();
  const elsewhere = path.join(tmpdir(), 'ao-kelse-' + process.pid + Math.random().toString(36).slice(2));
  mkdirSync(elsewhere);
  rmSync(path.join(r, 'to-kavi'), { recursive: true });
  symlinkSync(elsewhere, path.join(r, 'to-kavi'));
  assert.throws(() => sendFile(r, 'a.txt', Buffer.from('x')), /real folder/);
  assert.deepEqual(readdirSync(elsewhere), []);
  rmSync(r, { recursive: true, force: true });
  rmSync(elsewhere, { recursive: true, force: true });
});

test('size cap and file-type allowlist', () => {
  const r = bridge();
  assert.throws(() => sendFile(r, 'big.pdf', Buffer.alloc(MAX_FILE_BYTES + 1)), /too large/);
  assert.throws(() => sendFile(r, 'run.exe', Buffer.from('x')), /not allowed/);
  assert.throws(() => sendFile(r, 'x.ps1', Buffer.from('x')), /not allowed/);
  assert.throws(() => sendMessage(r, 'y'.repeat(4001)), /too long/);
  assert.equal(sendFile(r, 'ok.PNG', Buffer.alloc(MAX_FILE_BYTES)).name, 'ok.PNG');
  rmSync(r, { recursive: true, force: true });
});

test('Major Files is refused and never read', () => {
  assert.equal(isMajorFiles('C:\\Users\\owner\\Documents\\Major Files\\x'), true);
  assert.equal(isMajorFiles('/home/owner/documents/major files'), true);
  assert.equal(isMajorFiles('/home/owner/Documents/Bridge'), false);
  const root = path.join(tmpdir(), 'ao-mf-' + process.pid, 'Documents', 'Major Files', 'bridge');
  mkdirSync(path.join(root, 'to-kavi'), { recursive: true });
  writeFileSync(path.join(root, BRIDGE_ID_MARKER), KAVI_BRIDGE_FOLDER_ID);
  assert.throws(() => sendMessage(root, 'hi'), /Major Files/);
  assert.equal(readBack(root).verified, false);
  assert.deepEqual(readdirSync(path.join(root, 'to-kavi')), []);
  assert.throws(() => safeName('Documents/Major Files/x.txt'));
  rmSync(path.join(tmpdir(), 'ao-mf-' + process.pid), { recursive: true, force: true });
});

test('create only: an existing name gets a unique name, nothing is overwritten', () => {
  const r = bridge();
  assert.equal(sendFile(r, 'notes.txt', Buffer.from('one')).name, 'notes.txt');
  assert.equal(sendFile(r, 'notes.txt', Buffer.from('two')).name, 'notes (2).txt');
  assert.equal(readFileSync(path.join(r, 'to-kavi', 'notes.txt'), 'utf8'), 'one');
  assert.equal(readFileSync(path.join(r, 'to-kavi', 'notes (2).txt'), 'utf8'), 'two');
  assert.ok(existsSync(path.join(r, 'from-kavi', 'secret-reply.md')));
  rmSync(r, { recursive: true, force: true });
});

// Session gating through the real router.
async function withServer(fn: (port: number) => Promise<void>) {
  const ctx = {
    cfg: { port: 4600, tailnet: undefined, dataDir: tmpdir() },
    services: { lookup: () => undefined },
    auth: {
      fromRequest: (req: { headers: { cookie?: string } }) => (req.headers.cookie === 'ao=owner' ? {} : undefined),
      fromAnyCookie: (req: { headers: { cookie?: string } }) => req.headers.cookie === 'ao=owner',
    },
  } as never;
  const srv: Server = createServer(requestHandler(ctx, [kaviSendRoutes.bridge, kaviSendRoutes.message, kaviSendRoutes.file]));
  await new Promise<void>((ok) => srv.listen(0, '127.0.0.1', ok));
  try {
    await fn((srv.address() as { port: number }).port);
  } finally {
    srv.close();
  }
}
function call(port: number, p: string, headers: Record<string, string>, body = ''): Promise<{ status: number; json: any }> {
  return new Promise((ok, bad) => {
    const rq = request({ host: '127.0.0.1', port, path: p, method: body ? 'POST' : 'GET', headers: { host: '127.0.0.1:4600', ...headers } }, (res) => {
      let s = '';
      res.on('data', (c) => (s += c));
      res.on('end', () => ok({ status: res.statusCode || 0, json: s ? JSON.parse(s) : null }));
    });
    rq.on('error', bad);
    rq.end(body);
  });
}

test('session gating: only an office session sends; bridge, seat or shared tokens cannot', async () => {
  const r = bridge();
  const prev = process.env.AGENT_OFFICE_KAVI_BRIDGE_DIR;
  process.env.AGENT_OFFICE_KAVI_BRIDGE_DIR = r;
  try {
    await withServer(async (port) => {
      const body = JSON.stringify({ text: 'hi' });
      const json = { 'content-type': 'application/json' };
      assert.equal((await call(port, '/api/kavi/message', { ...json, 'x-bridge-token': 'a'.repeat(64) }, body)).status, 401);
      assert.equal((await call(port, '/api/kavi/message', { ...json, authorization: 'Bearer ' + 'b'.repeat(64) }, body)).status, 401);
      assert.equal((await call(port, '/api/kavi/message', { ...json, cookie: 'ao=owner', 'x-bridge-token': 'a'.repeat(64) }, body)).status, 403);
      assert.equal((await call(port, '/api/kavi/message', { ...json, cookie: 'ao=owner', origin: 'http://evil.example' }, body)).status, 403);
      assert.deepEqual(files(r), []);
      const ok = await call(port, '/api/kavi/message', { ...json, cookie: 'ao=owner' }, body);
      assert.equal(ok.status, 200);
      assert.equal(ok.json.folderId, KAVI_BRIDGE_FOLDER_ID);
      const up = await call(port, '/api/kavi/file', { cookie: 'ao=owner', 'content-type': 'application/octet-stream', 'x-file-name': encodeURIComponent('a b.txt') }, 'fake');
      assert.equal(up.status, 200);
      assert.equal(up.json.name, 'a b.txt');
      const rb = await call(port, '/api/kavi/bridge', { cookie: 'ao=owner' });
      assert.equal(rb.json.folderId, KAVI_BRIDGE_FOLDER_ID);
    });
    assert.equal(files(r).length, 2);
  } finally {
    if (prev === undefined) delete process.env.AGENT_OFFICE_KAVI_BRIDGE_DIR;
    else process.env.AGENT_OFFICE_KAVI_BRIDGE_DIR = prev;
    rmSync(r, { recursive: true, force: true });
  }
});

test('Windows reserved names and trailing dot or space are refused', () => {
  const r = bridge();
  for (const bad of ['CON', 'con.txt', 'Prn.pdf', 'aux.md', 'NUL.tar.txt', 'com1.txt', 'COM9.png', 'lpt1', 'Lpt9.csv', 'notes.txt.', 'notes.txt ', 'a. ']) {
    assert.throws(() => sendFile(r, bad, Buffer.from('x')), /bad file name/, JSON.stringify(bad));
  }
  for (const ok of ['console.txt', 'com10.txt', 'lpt.txt', 'nully.md', 'auxiliary.pdf']) assert.equal(safeName(ok), ok);
  assert.deepEqual(files(r), []);
  rmSync(r, { recursive: true, force: true });
});

test('owner wording: file prefix and header say owner, never a personal name', () => {
  const r = bridge();
  const out = sendMessage(r, 'hello');
  assert.match(out.name, /^owner-to-kavi-/);
  const doc = readFileSync(path.join(r, 'to-kavi', out.name), 'utf8');
  assert.match(doc, /^# From the owner/);
  for (const f of ['src/server/kavi-send.ts', 'src/server/kavi-desk.ts', 'src/server/http/routes/kavi-send.ts', 'src/client/features/kavi-board/send-panel.ts']) {
    assert.ok(!/nick/i.test(readFileSync(path.join(process.cwd(), f), 'utf8')), f);
  }
  rmSync(r, { recursive: true, force: true });
});
