// Local HQ: lease, talk outbox, Okkin loopback, and the client view of /api/ps.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CREW_SEATS, WORKING_LEASE_MS, chooseAgency, crewAutoReply, rosterChip } from '../src/shared/hq.js';
import { applyCrewPresence, writeCrewPush } from '../src/server/workers/crew.js';
import { notePlayerChat, outboxPath } from '../src/server/hq/relay.js';
import { okkinClient, probeOkkin, resetOkkinForTests, setOkkinFetchForTests, switchOkkinModel, talkToOkkin } from '../src/server/hq/okkin.js';
import { loopbackOrigin, probeOllama, psView, resolveOllamaUrl, type OllamaFetch } from '../src/server/ollama.js';
import { hqRoutes } from '../src/server/http/routes/hq.js';
import { bridgeRoutes } from '../src/server/http/routes/bridge.js';
import { hasSavedCharacter, profileStorageKey, saveProfile } from '../src/client/state/persist.ts';
import type { Worker } from '../src/server/workers/types.js';

function dir(name: string) {
  const d = path.join(tmpdir(), `ao-hq-${name}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(d, { recursive: true });
  return d;
}

function hostOf(workers: Map<string, Worker>) {
  return {
    workers,
    setStatus(w: Worker, status: Worker['info']['status']) {
      w.info.status = status;
    },
    emitUpdate() {},
  };
}

function fakeWorker(info: Partial<Worker['info']> & Pick<Worker['info'], 'id' | 'kind' | 'name' | 'deskId'>): Worker {
  return { info: { status: 'idle', acked: true, createdBy: 'office', createdAt: 1, cols: 80, rows: 24, viewers: [], viewerIds: [], ...info } } as Worker;
}

function ctxOf(dataDir: string) {
  const token = 'e'.repeat(64);
  writeFileSync(path.join(dataDir, 'bridge-token'), token);
  return {
    token,
    ctx: {
      cfg: { dataDir },
      auth: { fromRequest: () => undefined, fromAnyCookie: () => false },
      floors: new Map(),
    } as never,
  };
}

function resOf() {
  let status = 0;
  let body = '';
  const res = {
    writeHead(s: number) {
      status = s;
    },
    end(b?: unknown) {
      body = String(b ?? '');
    },
  } as ServerResponse;
  return { res, get status() { return status; }, get body() { return body; } };
}

function reqOf(method: string, headers: Record<string, string>, raw = '') {
  const req = Readable.from([Buffer.from(raw)]) as unknown as IncomingMessage;
  req.method = method;
  req.headers = headers;
  return req;
}

const SENTINEL = 'SECRETDIGEST-vram-expires';

function ollama(tags: string[], loaded: string | null, calls: { url: string; body?: unknown }[]): OllamaFetch {
  return async (url, init) => {
    calls.push({ url, body: init.body ? JSON.parse(init.body) : undefined });
    let status = 404;
    let text = JSON.stringify({ error: SENTINEL });
    if (url.endsWith('/api/tags')) {
      status = 200;
      text = JSON.stringify({ models: tags.map((name) => ({ name, digest: SENTINEL, size: 9 })) });
    } else if (url.endsWith('/api/ps')) {
      status = 200;
      const models = loaded ? [{ name: loaded, model: loaded, digest: SENTINEL, size: 1, size_vram: 2, expires_at: SENTINEL }] : [];
      text = JSON.stringify({ models, digest: SENTINEL });
    } else if (url.endsWith('/api/generate') || url.endsWith('/api/chat')) {
      status = 200;
      text = JSON.stringify({ response: 'SECRETREPLY', message: { content: 'hi' }, digest: SENTINEL });
    }
    return { ok: status >= 200 && status < 300, status, text: async () => text };
  };
}

test('roster chip: lease expiry, refresh, and blocked stays', () => {
  const now = 1_000_000;
  assert.equal(rosterChip({ status: 'working', at: now - WORKING_LEASE_MS - 1 }, now), 'idle');
  assert.equal(rosterChip({ status: 'working', at: now - 1_000 }, now), 'working');
  assert.equal(rosterChip({ status: 'blocked', at: now - WORKING_LEASE_MS * 4 }, now), 'blocked');
  assert.equal(rosterChip(undefined, now), 'offline');
});

test('presence paints crew only, keeps needs_input, and expires a stale working beat', () => {
  const workers = new Map<string, Worker>();
  const crew = fakeWorker({ id: 'crew-seat-1', kind: 'crew', name: 'seat-1', deskId: 'desk-1' });
  const shell = fakeWorker({ id: 'shell-1', kind: 'shell', name: 'seat-1', deskId: 'desk-1', status: 'idle' });
  const stuck = fakeWorker({ id: 'crew-seat-2', kind: 'crew', name: 'seat-2', deskId: 'desk-2', status: 'needs_input' });
  workers.set(crew.info.id, crew);
  workers.set(shell.info.id, shell);
  workers.set(stuck.info.id, stuck);
  const host = hostOf(workers);
  const now = Date.now();
  const fresh = applyCrewPresence(host, { 'seat-1': 'working', 'seat-2': 'working' }, { now, seen: { 'seat-1': now, 'seat-2': now }, seats: { 'seat-1': 'desk-1', 'seat-2': 'desk-2' } });
  assert.equal(crew.info.status, 'working');
  assert.equal(shell.info.status, 'idle');
  assert.equal(stuck.info.status, 'needs_input');
  assert.ok(fresh.applied.some((l) => l.endsWith('=working')));
  applyCrewPresence(host, { 'seat-1': 'working' }, { now: now + WORKING_LEASE_MS + 5, seen: { 'seat-1': now }, seats: { 'seat-1': 'desk-1' } });
  assert.equal(crew.info.status, 'idle');
  const again = now + WORKING_LEASE_MS + 10;
  applyCrewPresence(host, { 'seat-1': 'working' }, { now: again, seen: { 'seat-1': again }, seats: { 'seat-1': 'desk-1' } });
  assert.equal(crew.info.status, 'working');
});

test('bridge routes reject a missing token and refuse to speak as Okkin', async () => {
  const dataDir = dir('gate');
  const { ctx } = ctxOf(dataDir);
  const denied = resOf();
  await hqRoutes.roster.handle(ctx, { req: reqOf('GET', { host: '127.0.0.1:4600' }), res: denied.res, url: new URL('http://127.0.0.1:4600/api/bridge/roster') });
  assert.equal(denied.status, 401);
  const said = resOf();
  const { token } = ctxOf(dataDir);
  await bridgeRoutes.say.handle(ctx, {
    req: reqOf('POST', { host: '127.0.0.1:4600', 'content-type': 'application/json', 'x-bridge-token': token }, JSON.stringify({ name: 'Okkin', text: 'hello' })),
    res: said.res,
  });
  assert.equal(said.status, 400);
  assert.match(said.body, /local model/);
  rmSync(dataDir, { recursive: true, force: true });
});

test('a player line writes an outbox record and no crew reply', () => {
  const dataDir = dir('out');
  assert.equal(crewAutoReply(), null);
  const noted = notePlayerChat(dataDir, { text: 'hello seat', at: 1_700_000_000_000, seat: 'seat-4', kind: 'talk' });
  assert.equal(noted.reply, null);
  const line = JSON.parse(readFileSync(outboxPath(dataDir), 'utf8').trim()) as Record<string, unknown>;
  assert.deepEqual(Object.keys(line).sort(), ['at', 'kind', 'role', 'seat', 'text', 'thread', 'v']);
  assert.equal(line.v, 1);
  assert.equal(line.kind, 'talk');
  assert.equal(line.role, 'player');
  assert.equal(line.seat, 'seat-4');
  assert.equal(line.text, 'hello seat');
  rmSync(dataDir, { recursive: true, force: true });
});

test('a non-loopback Ollama URL is refused and a request cannot supply one', async () => {
  assert.ok('refused' in resolveOllamaUrl('http://203.0.113.10:11434'));
  assert.deepEqual(resolveOllamaUrl(undefined), { url: 'http://127.0.0.1:11434' });
  const calls: { url: string }[] = [];
  resetOkkinForTests();
  const snap = await probeOkkin({ OLLAMA_URL: 'http://203.0.113.10:11434', OKKIN_MODEL: 'demo:1b', OKKIN_MODEL_ALLOW: 'demo:1b' }, { crewKeysLower: [], humanAliases: [], humanMapsTo: '', crewDesks: false, seats: {} }, async () => {
    calls.push({ url: 'should-not-run' });
    return { ok: true, status: 200, text: async () => '{}' };
  });
  assert.equal(snap.chip, 'offline');
  assert.equal(calls.length, 0);
  resetOkkinForTests();
});

function listen(server: ReturnType<typeof createServer>, host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, host, () => {
      const addr = server.address();
      resolve(typeof addr === 'object' && addr ? addr.port : 0);
    });
  });
}

test('https is refused and localhost is rewritten to the 127.0.0.1 literal', () => {
  assert.equal(loopbackOrigin('https://127.0.0.1:11434').ok, false);
  assert.equal(loopbackOrigin('https://localhost:11434').ok, false);
  assert.deepEqual(loopbackOrigin('http://localhost:11434'), { ok: true, origin: 'http://127.0.0.1:11434' });
  assert.deepEqual(loopbackOrigin('http://LOCALHOST:9'), { ok: true, origin: 'http://127.0.0.1:9' });
  assert.deepEqual(loopbackOrigin('http://[::1]:11434'), { ok: true, origin: 'http://[::1]:11434' });
  assert.equal(loopbackOrigin('http://localhost.example:11434').ok, false);
});

test('a loopback 307 to another host is not followed', async () => {
  let hits = 0;
  const other = createServer((_req, res) => {
    hits++;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ models: [{ name: 'demo:1b' }] }));
  });
  const loop = createServer((_req, res) => {
    const port = other.address();
    const otherPort = typeof port === 'object' && port ? port.port : 0;
    res.writeHead(307, { location: `http://127.0.0.2:${otherPort}/api/tags` });
    res.end();
  });
  const otherPort = await listen(other, '127.0.0.2');
  const loopPort = await listen(loop, '127.0.0.1');
  try {
    const status = await probeOllama({ url: `http://127.0.0.1:${loopPort}`, model: null, refused: false });
    assert.equal(status, 'offline');
    assert.equal(hits, 0);
    assert.ok(otherPort > 0);
  } finally {
    loop.close();
    other.close();
  }
});

test('a response over 1 MB is dropped and the stream is closed', async () => {
  let written = 0;
  let closed = false;
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    const chunk = Buffer.alloc(64 * 1024, 0x61);
    const target = 8 * 1024 * 1024;
    const write = () => {
      while (written < target) {
        const ok = res.write(chunk);
        written += chunk.length;
        if (!ok) {
          res.once('drain', write);
          return;
        }
      }
      res.end();
    };
    res.on('close', () => {
      closed = true;
    });
    res.on('error', () => {});
    write();
  });
  const port = await listen(server, '127.0.0.1');
  try {
    const status = await probeOllama({ url: `http://127.0.0.1:${port}`, model: null, refused: false });
    assert.equal(status, 'offline');
    for (let i = 0; i < 20 && !closed; i++) await new Promise((r) => setTimeout(r, 25));
    assert.equal(closed, true);
    assert.ok(written < 8 * 1024 * 1024);
  } finally {
    server.close();
  }
});

test('a second Okkin talk is rejected while the first call is in flight', async () => {
  resetOkkinForTests();
  let chats = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const fetchImpl: OllamaFetch = async (url) => {
    if (url.endsWith('/api/chat')) {
      chats++;
      await gate;
      return { ok: true, status: 200, text: async () => JSON.stringify({ message: { content: 'hi' } }) };
    }
    if (url.endsWith('/api/tags')) return { ok: true, status: 200, text: async () => JSON.stringify({ models: [{ name: 'demo:1b' }] }) };
    if (url.endsWith('/api/ps')) return { ok: true, status: 200, text: async () => JSON.stringify({ models: [{ name: 'demo:1b' }] }) };
    return { ok: false, status: 404, text: async () => '' };
  };
  const dataDir = dir('busy');
  const env = { OLLAMA_URL: 'http://127.0.0.1:11434', OKKIN_MODEL: 'demo:1b', OKKIN_MODEL_ALLOW: 'demo:1b' };
  const hq = { crewKeysLower: [], humanAliases: [], humanMapsTo: '', crewDesks: false, seats: {} };
  const first = talkToOkkin(dataDir, env, hq, 'hello', fetchImpl);
  for (let i = 0; i < 50 && chats === 0; i++) await new Promise((r) => setTimeout(r, 10));
  assert.equal(chats, 1);
  const second = await talkToOkkin(dataDir, env, hq, 'again', fetchImpl);
  assert.equal(second.status, 409);
  const switched = await switchOkkinModel(env, hq, 'demo:1b', fetchImpl);
  assert.equal(switched.status, 409);
  assert.equal(chats, 1);
  release();
  const done = await first;
  assert.equal(done.status, 200);
  resetOkkinForTests();
  rmSync(dataDir, { recursive: true, force: true });
});

test('the outbox keeps the last 200 lines at mode 0600', () => {
  const dataDir = dir('cap');
  for (let i = 0; i < 201; i++) notePlayerChat(dataDir, { text: `line-${i}`, at: i, seat: 'seat-1', kind: 'talk' });
  const lines = readFileSync(outboxPath(dataDir), 'utf8').trim().split('\n');
  assert.equal(lines.length, 200);
  assert.equal((JSON.parse(lines[0]!) as { text: string }).text, 'line-1');
  assert.equal((JSON.parse(lines[199]!) as { text: string }).text, 'line-200');
  assert.equal(statSync(outboxPath(dataDir)).mode & 0o777, 0o600);
  rmSync(dataDir, { recursive: true, force: true });
});

test('switching unloads first, rejects an unknown tag, and hides the raw /api/ps body', async () => {
  const calls: { url: string; body?: { model?: string; keep_alive?: number; prompt?: string } }[] = [];
  resetOkkinForTests();
  setOkkinFetchForTests(ollama(['demo:1b', 'small:1b'], 'demo:1b', calls));
  const env = { OLLAMA_URL: 'http://127.0.0.1:11434', OKKIN_MODEL: 'demo:1b', OKKIN_MODEL_ALLOW: 'demo:1b,small:1b' };
  const hq = { crewKeysLower: [], humanAliases: [], humanMapsTo: '', crewDesks: false, seats: {}, ollamaUrl: 'http://203.0.113.9:11434' };
  const bad = await switchOkkinModel(env, hq, 'nope:9b');
  assert.equal(bad.status, 400);
  assert.equal(calls.filter((c) => c.url.endsWith('/api/generate')).length, 0);
  calls.length = 0;
  const dataDir = dir('okkin');
  const { ctx, token } = ctxOf(dataDir);
  const captured = resOf();
  const prevUrl = process.env.OLLAMA_URL;
  const prevModel = process.env.OKKIN_MODEL;
  const prevAllow = process.env.OKKIN_MODEL_ALLOW;
  process.env.OLLAMA_URL = 'http://127.0.0.1:11434';
  process.env.OKKIN_MODEL = 'demo:1b';
  process.env.OKKIN_MODEL_ALLOW = 'demo:1b,small:1b';
  await hqRoutes.okkinModel.handle(ctx, {
    req: reqOf(
      'POST',
      { host: '127.0.0.1:4600', 'content-type': 'application/json', 'x-bridge-token': token },
      JSON.stringify({ model: 'small:1b', ollamaUrl: 'http://203.0.113.9:11434', url: 'http://203.0.113.8/api/pull' }),
    ),
    res: captured.res,
  });
  if (prevUrl === undefined) delete process.env.OLLAMA_URL;
  else process.env.OLLAMA_URL = prevUrl;
  if (prevModel === undefined) delete process.env.OKKIN_MODEL;
  else process.env.OKKIN_MODEL = prevModel;
  if (prevAllow === undefined) delete process.env.OKKIN_MODEL_ALLOW;
  else process.env.OKKIN_MODEL_ALLOW = prevAllow;
  assert.equal(captured.status, 200);
  assert.equal(captured.body.includes(SENTINEL), false);
  assert.equal(captured.body.includes('SECRETREPLY'), false);
  const parsed = JSON.parse(captured.body) as { okkin: Record<string, unknown> };
  assert.deepEqual(Object.keys(parsed.okkin).sort(), ['chip', 'configured', 'model', 'options', 'seat', 'state']);
  assert.equal(parsed.okkin.model, 'small:1b');
  assert.equal(parsed.okkin.state, 'loaded');
  assert.equal(parsed.okkin.seat, 'okkin');
  const generates = calls.filter((c) => c.url.endsWith('/api/generate'));
  assert.equal(generates.length, 2);
  assert.equal(generates[0]?.body?.model, 'demo:1b');
  assert.equal(generates[0]?.body?.keep_alive, 0);
  assert.equal(generates[1]?.body?.model, 'small:1b');
  assert.ok(calls.every((c) => c.url.startsWith('http://127.0.0.1:11434/')));
  const view = psView({ ok: true, status: 200, body: { models: [{ name: 'small:1b', digest: SENTINEL, size_vram: 3 }] } });
  assert.deepEqual(view, { model: 'small:1b', state: 'loaded' });
  assert.equal(JSON.stringify(okkinClient({ seat: 'okkin', chip: 'idle', configured: 'demo:1b', options: ['demo:1b'], model: view.model, state: view.state })).includes(SENTINEL), false);
  resetOkkinForTests();
  rmSync(dataDir, { recursive: true, force: true });
});

test('there is one Okkin seat, and idle agency stays seated unless the seat is clear', () => {
  assert.equal(CREW_SEATS.filter((s) => s === 'okkin').length, 1);
  assert.equal(chooseAgency({ idleClear: false, seatIndex: 0, now: 0, meetingOn: true, hoop: true, arcade: true }), 'seated');
  assert.equal(chooseAgency({ idleClear: true, seatIndex: 0, now: 0, meetingOn: false, hoop: false, arcade: false }), 'aisle');
});

test('a saved character is per account and an unsaved guest is not one', () => {
  const mem = new Map<string, string>();
  const prev = globalThis.localStorage;
  globalThis.localStorage = {
    getItem: (k) => mem.get(k) ?? null,
    setItem: (k, v) => void mem.set(k, v),
    removeItem: (k) => void mem.delete(k),
    clear: () => mem.clear(),
    key: () => null,
    length: 0,
  } as Storage;
  try {
    assert.equal(hasSavedCharacter('Ada'), false);
    saveProfile({ name: 'Ada', color: '#ffffff' }, 'Ada');
    assert.equal(hasSavedCharacter('Ada'), true);
    assert.equal(hasSavedCharacter('Bea'), false);
    assert.equal(mem.has(profileStorageKey('Ada')), true);
    assert.equal(mem.has('agent-office.profile'), true);
  } finally {
    globalThis.localStorage = prev;
  }
});

test('a bridge push stores seen and does not record Okkin', () => {
  const dataDir = dir('seen');
  const now = 50_000;
  const file = writeCrewPush(dataDir, { 'seat-1': 'working', okkin: 'working', stranger: 'working' }, 'test', now);
  assert.equal(file.crew['seat-1'], 'working');
  assert.equal(file.seen['seat-1'], now);
  assert.equal(file.crew.okkin, undefined);
  assert.equal(file.crew.stranger, undefined);
  rmSync(dataDir, { recursive: true, force: true });
});
