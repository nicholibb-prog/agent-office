// Owner -> Kavi through the Bridge folder's to-kavi path. Fake data and temp folders only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request, type Server } from 'node:http';
import { mkdirSync, writeFileSync, rmSync, readdirSync, readFileSync, symlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  BRIDGE_ID_MARKER, MAX_FILE_BYTES, isMajorFiles, readBack, sendFile, sendMessage, safeName,
} from '../src/server/kavi-send.js';
import { requestHandler } from '../src/server/http/router.js';
import { kaviSendRoutes } from '../src/server/http/routes/kavi-send.js';
import { testOwner } from './support/okkin-owner.js';

// Obviously fake Bridge folder id for tests; the real one lives only in the machine's environment.
const KAVI_BRIDGE_FOLDER_ID = 'FAKE_folder_id_for_tests_0001';
process.env.AGENT_OFFICE_KAVI_BRIDGE_FOLDER_ID = KAVI_BRIDGE_FOLDER_ID;

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
  assert.equal(out.folderId, KAVI_BRIDGE_FOLDER_ID);
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
const hasSession = (req: { headers: { cookie?: string } }) => /(^|;\s*)ao=owner(;|$)/.test(req.headers.cookie || '');
async function withServer(fn: (port: number) => Promise<void>, dataDir = tmpdir()) {
  const ctx = {
    cfg: { port: 4600, tailnet: undefined, dataDir },
    services: { lookup: () => undefined },
    auth: {
      fromRequest: (req: { headers: { cookie?: string } }) => (hasSession(req) ? {} : undefined),
      fromAnyCookie: (req: { headers: { cookie?: string } }) => hasSession(req),
      sessionFromAnyCookie: (req: { headers: { cookie?: string } }) => (hasSession(req) ? {} : undefined),
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
      const owner = `ao=owner; ${(await testOwner()).cookie()}`;
      assert.equal((await call(port, '/api/kavi/message', { ...json, 'x-bridge-token': 'a'.repeat(64) }, body)).status, 403);
      assert.equal((await call(port, '/api/kavi/message', { ...json, authorization: 'Bearer ' + 'b'.repeat(64) }, body)).status, 403);
      assert.equal((await call(port, '/api/kavi/message', { ...json, cookie: owner, 'x-bridge-token': 'a'.repeat(64) }, body)).status, 403);
      assert.equal((await call(port, '/api/kavi/message', { ...json, cookie: owner, origin: 'http://evil.example' }, body)).status, 403);
      assert.deepEqual(files(r), []);
      const ok = await call(port, '/api/kavi/message', { ...json, cookie: owner }, body);
      assert.equal(ok.status, 200);
      assert.equal(ok.json.folderId, KAVI_BRIDGE_FOLDER_ID);
      const up = await call(port, '/api/kavi/file', { cookie: owner, 'content-type': 'application/octet-stream', 'x-file-name': encodeURIComponent('a b.txt') }, 'fake');
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

test('shared Major Files matcher: spellings, slash styles and case', async () => {
  const { isMajorFiles: shared, underMajorFiles } = await import('../src/server/major-files.js');
  assert.equal(isMajorFiles, shared);
  for (const p of ['C:\\Users\\owner\\Documents\\Major Files\\a.pdf', '/x/major_files/y', '/x/MAJOR-FILES', 'D:/Archive/major files/z', 'majorfiles\\q']) {
    assert.equal(shared(p), true, p);
  }
  for (const p of ['/x/Major Filesystem/y', '/x/minor files', '/home/owner/Documents/Bridge']) assert.equal(shared(p), false, p);
  assert.equal(underMajorFiles('/safe/link', '/real/Major_Files/b'), true);
  const r = bridge();
  assert.throws(() => safeName('major_files'), /Major Files/);
  rmSync(r, { recursive: true, force: true });
});

test('no folder id configured: sends are refused with an honest message and read-back is unverified', () => {
  const r = bridge();
  const prev = process.env.AGENT_OFFICE_KAVI_BRIDGE_FOLDER_ID;
  for (const v of [undefined, '', 'bad id with spaces', 'short']) {
    if (v === undefined) delete process.env.AGENT_OFFICE_KAVI_BRIDGE_FOLDER_ID;
    else process.env.AGENT_OFFICE_KAVI_BRIDGE_FOLDER_ID = v;
    assert.throws(() => sendMessage(r, 'hi'), /not configured on this machine/);
    assert.throws(() => sendFile(r, 'a.txt', Buffer.from('x')), /not configured on this machine/);
    assert.deepEqual(readBack(r), { configured: true, folderId: null, verified: false, live: false });
  }
  process.env.AGENT_OFFICE_KAVI_BRIDGE_FOLDER_ID = prev;
  assert.deepEqual(files(r), []);
  rmSync(r, { recursive: true, force: true });
});

test('the real Bridge folder id is not in the repo (checked by hash only)', async () => {
  const { execFileSync } = await import('node:child_process');
  const { createHash } = await import('node:crypto');
  // SHA-256 of the real id. The id itself, or any piece of it, never appears in the tree.
  const REAL_ID_SHA256 = '52a7ca0c3cd6e474595b69009abe5d0ea9a8b09278ddf0c932239187083ada5d';
  const tracked = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
  const leaks: string[] = [];
  for (const f of tracked) {
    let text: string;
    try {
      const buf = readFileSync(f);
      if (buf.includes(0)) continue; // binary
      text = buf.toString('utf8');
    } catch {
      continue;
    }
    for (const tok of text.match(/[A-Za-z0-9_-]{25,60}/g) ?? []) {
      if (createHash('sha256').update(tok).digest('hex') === REAL_ID_SHA256) leaks.push(f);
    }
  }
  assert.deepEqual(leaks, []);
});
