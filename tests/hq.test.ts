// Local HQ: lease, talk outbox, Okkin loopback, and the client view of /api/ps.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CREW_SEATS, WORKING_LEASE_MS, chooseAgency, crewAutoReply, offlineQueuedNotice, rosterChip, sanitizeNames, seatDisplayName } from '../src/shared/hq.js';
import { applyCrewPresence, writeCrewPush } from '../src/server/workers/crew.js';
import { notePlayerChat, outboxPath } from '../src/server/hq/relay.js';
import { okkinClient, probeOkkin, resetOkkinForTests, setOkkinFetchForTests, switchOkkinModel, talkToOkkin } from '../src/server/hq/okkin.js';
import { createOllama, loopbackOrigin, probeOllama, psView, readCappedResponse, resolveOllamaUrl, type OllamaFetch } from '../src/server/ollama.js';
import { hqRoutes } from '../src/server/http/routes/hq.js';
import { bridgeRoutes, refusesOkkinName } from '../src/server/http/routes/bridge.js';
import { resetHqLimitsForTests, talkLimited } from '../src/server/hq/limits.js';
import { writePrivate } from '../src/server/private-file.js';
import { presenceHandlers } from '../src/server/ws/handlers/presence.ts';
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

function ctxOf(dataDir: string, who?: { id: string; role: 'admin' | 'member' } | 'shared') {
  const token = 'e'.repeat(64);
  writeFileSync(path.join(dataDir, 'bridge-token'), token);
  const session = who === 'shared' ? {} : who ? { account: { id: who.id, role: who.role } } : undefined;
  return {
    token,
    ctx: {
      cfg: { dataDir },
      auth: { fromRequest: () => session, fromAnyCookie: () => false },
      meOf: (accountId?: string) => {
        if (!accountId) return { admin: true };
        if (who && who !== 'shared' && who.id === accountId) return { admin: who.role === 'admin' };
        return { admin: false };
      },
      floors: new Map(),
      chat: { add() {} },
      broadcast() {},
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
  const calls: { url: string; body?: { model?: string; keep_alive?: number; prompt?: string; options?: { num_predict?: number } } }[] = [];
  resetOkkinForTests();
  resetHqLimitsForTests();
  setOkkinFetchForTests(ollama(['demo:1b', 'small:1b'], 'demo:1b', calls));
  const env = { OLLAMA_URL: 'http://127.0.0.1:11434', OKKIN_MODEL: 'demo:1b', OKKIN_MODEL_ALLOW: 'demo:1b,small:1b' };
  const hq = { crewKeysLower: [], humanAliases: [], humanMapsTo: '', crewDesks: false, seats: {}, ollamaUrl: 'http://203.0.113.9:11434' };
  const bad = await switchOkkinModel(env, hq, 'nope:9b');
  assert.equal(bad.status, 400);
  assert.equal(calls.filter((c) => c.url.endsWith('/api/generate')).length, 0);
  calls.length = 0;
  const dataDir = dir('okkin');
  const { ctx } = ctxOf(dataDir, { id: 'switch-admin', role: 'admin' });
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
      { host: '127.0.0.1:4600', 'content-type': 'application/json' },
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
  assert.equal(generates[1]?.body?.prompt, undefined);
  assert.equal(generates[1]?.body?.options?.num_predict, 1);
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

test('an offline seat queues the message, adds no bot line, and stays offline', async () => {
  const dataDir = dir('queued');
  resetHqLimitsForTests();
  const { ctx } = ctxOf(dataDir, { id: 'talk-offline', role: 'admin' });
  const sent = resOf();
  await hqRoutes.talk.handle(ctx, {
    req: reqOf('POST', { host: '127.0.0.1:4600', 'content-type': 'application/json' }, JSON.stringify({ seat: 'seat-1', text: 'hello seat' })),
    res: sent.res,
  });
  assert.equal(sent.status, 200);
  const body = JSON.parse(sent.body) as { chip: string; name: string; messages: { role: string; text: string }[] };
  assert.equal(body.chip, 'offline');
  assert.equal(body.name, 'seat-1');
  assert.equal(body.messages.filter((m) => m.role === 'bot').length, 0);
  assert.ok(body.messages.some((m) => m.role === 'player' && m.text === 'hello seat'));
  assert.equal(body.messages.find((m) => m.role === 'office')?.text, offlineQueuedNotice('seat-1'));
  assert.equal(offlineQueuedNotice('seat-1'), 'offline \u2014 message queued for seat-1');
  assert.equal(existsSync(path.join(dataDir, 'crew-status.json')), false);
  rmSync(dataDir, { recursive: true, force: true });
});

test('public labels stay seat-N, and a gitignored names map supplies a local display name', async () => {
  assert.equal(seatDisplayName('seat-1', {}), 'seat-1');
  assert.equal(seatDisplayName('seat-9', undefined), 'seat-9');
  assert.equal(seatDisplayName('okkin', {}), 'Okkin');
  assert.deepEqual(sanitizeNames({ 'seat-1': 'Pat Example', 'seat-2': 'hidden/name', 'seat-4': '   ' }), { 'seat-1': 'Pat Example' });
  const dataDir = dir('names');
  resetHqLimitsForTests();
  writeFileSync(path.join(dataDir, 'hq-local.json'), JSON.stringify({ crewDesks: true, seats: { 'seat-1': 'desk-1' }, names: { 'seat-1': 'Pat Example' } }));
  const { ctx, token } = ctxOf(dataDir, { id: 'talk-names', role: 'admin' });
  const sent = resOf();
  await hqRoutes.talk.handle(ctx, {
    req: reqOf('POST', { host: '127.0.0.1:4600', 'content-type': 'application/json' }, JSON.stringify({ seat: 'seat-1', text: 'hello' })),
    res: sent.res,
  });
  const body = JSON.parse(sent.body) as { name: string; chip: string; messages: { role: string; text: string }[] };
  assert.equal(body.name, 'Pat Example');
  assert.equal(body.chip, 'offline');
  assert.equal(body.messages.find((m) => m.role === 'office')?.text, offlineQueuedNotice('Pat Example'));
  assert.equal(body.messages.filter((m) => m.role === 'bot').length, 0);
  const roster = resOf();
  await hqRoutes.roster.handle(ctx, {
    req: reqOf('GET', { host: '127.0.0.1:4600', 'x-bridge-token': token }),
    res: roster.res,
    url: new URL('http://127.0.0.1:4600/api/bridge/roster'),
  });
  const rows = JSON.parse(roster.body) as { seats: { seat: string; name: string; chip: string }[] };
  assert.equal(rows.seats.find((s) => s.seat === 'seat-1')?.name, 'Pat Example');
  assert.equal(rows.seats.find((s) => s.seat === 'seat-2')?.name, 'seat-2');
  assert.equal(rows.seats.find((s) => s.seat === 'seat-1')?.chip, 'offline');
  rmSync(dataDir, { recursive: true, force: true });
});

test('a bot line is the text posted to the authenticated inbox route', async () => {
  const dataDir = dir('inbox');
  const { ctx, token } = ctxOf(dataDir);
  const posted = resOf();
  await bridgeRoutes.inbox.handle(ctx, {
    req: reqOf('POST', { host: '127.0.0.1:4600', 'content-type': 'application/json', 'x-bridge-token': token }, JSON.stringify({ seat: 'seat-1', text: 'At the desk.' })),
    res: posted.res,
  });
  assert.equal(posted.status, 200);
  const got = resOf();
  await hqRoutes.talkGet.handle(ctx, {
    req: reqOf('GET', { host: '127.0.0.1:4600', 'x-bridge-token': token }),
    res: got.res,
    url: new URL('http://127.0.0.1:4600/api/bridge/talk?seat=seat-1'),
  });
  const body = JSON.parse(got.body) as { chip: string; name: string; messages: { role: string; text: string }[] };
  assert.equal(body.chip, 'offline');
  assert.equal(body.name, 'seat-1');
  assert.equal(body.messages.filter((m) => m.role === 'bot').length, 1);
  assert.equal(body.messages.find((m) => m.role === 'bot')?.text, 'At the desk.');
  assert.equal(existsSync(path.join(dataDir, 'crew-status.json')), false);
  const refused = resOf();
  await bridgeRoutes.inbox.handle(ctx, {
    req: reqOf('POST', { host: '127.0.0.1:4600', 'content-type': 'application/json', 'x-bridge-token': token }, JSON.stringify({ seat: 'okkin', text: 'nope' })),
    res: refused.res,
  });
  assert.equal(refused.status, 400);
  rmSync(dataDir, { recursive: true, force: true });
});

test('a content-length over 1 MB goes offline', async () => {
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json', 'content-length': String(8 * 1024 * 1024) });
    res.flushHeaders();
  });
  const port = await listen(server, '127.0.0.1');
  const started = Date.now();
  try {
    const status = await probeOllama({ url: `http://127.0.0.1:${port}`, model: null, refused: false });
    assert.equal(status, 'offline');
    assert.ok(Date.now() - started < 800);
  } finally {
    server.closeAllConnections();
    server.close();
  }
});

test('the response lock is released after a reader error', async () => {
  let released = false;
  const reader = {
    async read(): Promise<{ done: boolean; value?: Uint8Array }> {
      throw new Error('boom');
    },
    async cancel() {},
    releaseLock() {
      released = true;
    },
  };
  await assert.rejects(
    () => readCappedResponse({ headers: { get: () => null }, body: { getReader: () => reader }, text: async () => '' }),
    /boom/,
  );
  assert.equal(released, true);
  let texts = 0;
  await assert.rejects(
    () =>
      readCappedResponse({
        headers: { get: (name) => (name === 'content-length' ? String(2 * 1024 * 1024) : null) },
        body: null,
        text: async () => {
          texts++;
          return 'short';
        },
      }),
    /too large/,
  );
  assert.equal(texts, 0);
  await assert.rejects(
    () => readCappedResponse({ headers: { get: () => null }, body: null, text: async () => '\u00e9'.repeat(600_000) }),
    /too large/,
  );
});

test('a private write removes its temp file when rename fails', () => {
  const folder = dir('priv');
  const dest = path.join(folder, 'crew-status.json');
  mkdirSync(dest);
  assert.throws(() => writePrivate(dest, '{}\n'));
  assert.equal(readdirSync(folder).filter((name) => name.includes('.tmp')).length, 0);
  rmSync(folder, { recursive: true, force: true });
});

test('a model switch without a session is rejected', async () => {
  const dataDir = dir('switch-session');
  resetHqLimitsForTests();
  const { ctx, token } = ctxOf(dataDir);
  const missing = resOf();
  await hqRoutes.okkinModel.handle(ctx, {
    req: reqOf('POST', { host: '127.0.0.1:4600', 'content-type': 'application/json' }, JSON.stringify({ model: 'demo:1b' })),
    res: missing.res,
  });
  assert.equal(missing.status, 401);
  const bearer = resOf();
  await hqRoutes.okkinModel.handle(ctx, {
    req: reqOf('POST', { host: '127.0.0.1:4600', 'content-type': 'application/json', authorization: `Bearer ${token}` }, JSON.stringify({ model: 'demo:1b' })),
    res: bearer.res,
  });
  assert.equal(bearer.status, 403);
  rmSync(dataDir, { recursive: true, force: true });
});

test('a model switch inside the cooldown is rejected', async () => {
  const calls: { url: string; body?: unknown }[] = [];
  resetOkkinForTests();
  resetHqLimitsForTests();
  setOkkinFetchForTests(ollama(['demo:1b', 'small:1b'], 'demo:1b', calls));
  const dataDir = dir('cooldown');
  const { ctx } = ctxOf(dataDir, { id: 'cool-admin', role: 'admin' });
  const env = { OLLAMA_URL: 'http://127.0.0.1:11434', OKKIN_MODEL: 'demo:1b', OKKIN_MODEL_ALLOW: 'demo:1b,small:1b' };
  const prevUrl = process.env.OLLAMA_URL;
  const prevModel = process.env.OKKIN_MODEL;
  const prevAllow = process.env.OKKIN_MODEL_ALLOW;
  process.env.OLLAMA_URL = env.OLLAMA_URL;
  process.env.OKKIN_MODEL = env.OKKIN_MODEL;
  process.env.OKKIN_MODEL_ALLOW = env.OKKIN_MODEL_ALLOW;
  try {
    const first = resOf();
    await hqRoutes.okkinModel.handle(ctx, {
      req: reqOf('POST', { host: '127.0.0.1:4600', 'content-type': 'application/json' }, JSON.stringify({ model: 'small:1b' })),
      res: first.res,
    });
    assert.equal(first.status, 200);
    const generates = calls.filter((c) => c.url.endsWith('/api/generate')).length;
    const second = resOf();
    await hqRoutes.okkinModel.handle(ctx, {
      req: reqOf('POST', { host: '127.0.0.1:4600', 'content-type': 'application/json' }, JSON.stringify({ model: 'demo:1b' })),
      res: second.res,
    });
    assert.equal(second.status, 429);
    assert.equal(calls.filter((c) => c.url.endsWith('/api/generate')).length, generates);
  } finally {
    if (prevUrl === undefined) delete process.env.OLLAMA_URL;
    else process.env.OLLAMA_URL = prevUrl;
    if (prevModel === undefined) delete process.env.OKKIN_MODEL;
    else process.env.OKKIN_MODEL = prevModel;
    if (prevAllow === undefined) delete process.env.OKKIN_MODEL_ALLOW;
    else process.env.OKKIN_MODEL_ALLOW = prevAllow;
    resetOkkinForTests();
    resetHqLimitsForTests();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('talk is limited to one line per 3 seconds and 20 per minute', async () => {
  resetHqLimitsForTests();
  const t0 = 1_000_000;
  assert.equal(talkLimited('acct-rate', t0), false);
  assert.equal(talkLimited('acct-rate', t0 + 2_999), true);
  for (let i = 1; i < 20; i++) assert.equal(talkLimited('acct-rate', t0 + i * 3_000), false);
  assert.equal(talkLimited('acct-rate', t0 + 20 * 3_000), true);
  const dataDir = dir('rate');
  const { ctx } = ctxOf(dataDir, { id: 'talk-rate', role: 'admin' });
  const first = resOf();
  await hqRoutes.talk.handle(ctx, {
    req: reqOf('POST', { host: '127.0.0.1:4600', 'content-type': 'application/json' }, JSON.stringify({ seat: 'seat-1', text: 'one' })),
    res: first.res,
  });
  assert.equal(first.status, 200);
  const second = resOf();
  await hqRoutes.talk.handle(ctx, {
    req: reqOf('POST', { host: '127.0.0.1:4600', 'content-type': 'application/json' }, JSON.stringify({ seat: 'seat-1', text: 'two' })),
    res: second.res,
  });
  assert.equal(second.status, 429);
  resetHqLimitsForTests();
  rmSync(dataDir, { recursive: true, force: true });
});

test('a bridge body over 16 KB is rejected', async () => {
  const dataDir = dir('big');
  resetHqLimitsForTests();
  const { ctx, token } = ctxOf(dataDir, { id: 'talk-big', role: 'admin' });
  const raw = JSON.stringify({ seat: 'seat-1', text: 'x'.repeat(20 * 1024) });
  const talk = resOf();
  await hqRoutes.talk.handle(ctx, {
    req: reqOf('POST', { host: '127.0.0.1:4600', 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(raw)) }, raw),
    res: talk.res,
  });
  assert.equal(talk.status, 413);
  const said = resOf();
  await bridgeRoutes.say.handle(ctx, {
    req: reqOf('POST', { host: '127.0.0.1:4600', 'content-type': 'application/json', 'x-bridge-token': token, 'content-length': String(Buffer.byteLength(raw)) }, raw),
    res: said.res,
  });
  assert.equal(said.status, 413);
  rmSync(dataDir, { recursive: true, force: true });
});

test('chat sends num_predict 256 and a refused URL does not fall back', async () => {
  const calls: { url: string; body?: { options?: { num_predict?: number } } }[] = [];
  resetOkkinForTests();
  const dataDir = dir('predict');
  writeFileSync(path.join(dataDir, 'ollama.json'), JSON.stringify({ url: 'http://203.0.113.10:11434', model: 'file:1b' }));
  const hq = { crewKeysLower: [], humanAliases: [], humanMapsTo: '', crewDesks: false, seats: {}, ollamaUrl: 'http://127.0.0.1:9', okkinModel: 'hq:1b' };
  const refused = await talkToOkkin(dataDir, {}, hq, 'hello', async () => {
    calls.push({ url: 'should-not-run' });
    return { ok: true, status: 200, text: async () => '{}' };
  });
  assert.equal(refused.status, 503);
  assert.equal(calls.length, 0);
  const chatCalls: { url: string; body?: { model?: string; options?: { num_predict?: number } } }[] = [];
  const ok = await talkToOkkin(
    dataDir,
    { OLLAMA_URL: 'http://127.0.0.1:11434', OKKIN_MODEL: 'demo:1b', OKKIN_MODEL_ALLOW: 'demo:1b' },
    hq,
    'hello',
    ollama(['demo:1b'], 'demo:1b', chatCalls),
  );
  assert.equal(ok.status, 200);
  const chat = chatCalls.find((c) => c.url.endsWith('/api/chat'));
  assert.equal(chat?.url, 'http://127.0.0.1:11434/api/chat');
  assert.equal(chat?.body?.options?.num_predict, 256);
  resetOkkinForTests();
  rmSync(dataDir, { recursive: true, force: true });
});

test('Okkin look-alike names are rejected and 0kkin is not', async () => {
  const lookalikes = ['Okk\u0456n', 'O-k-k-i-n', 'okkin2', 'Okkin\u200b'];
  for (const name of lookalikes) assert.equal(refusesOkkinName(name), true, name);
  assert.equal(refusesOkkinName('0kkin'), false);
  const dataDir = dir('look');
  const { ctx, token } = ctxOf(dataDir);
  const headers = { host: '127.0.0.1:4600', 'content-type': 'application/json', 'x-bridge-token': token };
  const allowed = resOf();
  await bridgeRoutes.say.handle(ctx, {
    req: reqOf('POST', headers, JSON.stringify({ name: '0kkin', text: 'hi' })),
    res: allowed.res,
  });
  assert.equal(allowed.status, 200);
  for (const name of lookalikes) {
    const denied = resOf();
    await bridgeRoutes.say.handle(ctx, {
      req: reqOf('POST', headers, JSON.stringify({ name, text: 'hi' })),
      res: denied.res,
    });
    assert.equal(denied.status, 400, name);
  }
  rmSync(dataDir, { recursive: true, force: true });
});

test('a spoofed blocked push is cleared by a later bridge push', () => {
  const workers = new Map<string, Worker>();
  const crew = fakeWorker({ id: 'crew-seat-1', kind: 'crew', name: 'seat-1', deskId: 'desk-1' });
  const other = fakeWorker({ id: 'crew-seat-2', kind: 'crew', name: 'seat-2', deskId: 'desk-2', status: 'needs_input', lastInput: { by: 'desk', at: 1 } });
  workers.set(crew.info.id, crew);
  workers.set(other.info.id, other);
  const host = hostOf(workers);
  const now = Date.now();
  const seats = { 'seat-1': 'desk-1', 'seat-2': 'desk-2' } as const;
  applyCrewPresence(host, { 'seat-1': 'blocked' }, { now, seen: { 'seat-1': now }, seats });
  assert.equal(crew.info.status, 'needs_input');
  assert.equal(crew.info.lastInput?.by, 'crew-status');
  applyCrewPresence(host, { 'seat-1': 'idle', 'seat-2': 'working' }, { now: now + 1, seen: { 'seat-1': now + 1, 'seat-2': now + 1 }, seats });
  assert.equal(crew.info.status, 'idle');
  assert.equal(other.info.status, 'needs_input');
});

test('ws chat survives an outbox write error', () => {
  const parent = dir('ws');
  const blocked = path.join(parent, 'not-a-dir');
  writeFileSync(blocked, 'x');
  const sent: string[] = [];
  const ctx = {
    cfg: { dataDir: blocked },
    chat: { add(line: { text: string }) { sent.push(line.text); } },
    broadcast() {},
    floorOf() {
      return undefined;
    },
  };
  const client = { id: 'c1', admin: true, accountId: 'acct-9', peer: { name: 'Pat Example', color: '#fff' }, throttles: new Map<string, number>() };
  assert.doesNotThrow(() => presenceHandlers.chat(ctx as never, client as never, { t: 'chat', text: 'hello' }));
  assert.deepEqual(sent, ['hello']);
  const dataDir = dir('ws-ok');
  const live = {
    cfg: { dataDir },
    chat: { add() {} },
    broadcast() {},
    floorOf() {
      return undefined;
    },
  };
  const member = { id: 'c2', admin: false, accountId: 'acct-2', peer: { name: 'Pat Example', color: '#fff' }, throttles: new Map<string, number>() };
  presenceHandlers.chat(live as never, member as never, { t: 'chat', text: 'one' });
  presenceHandlers.chat(live as never, member as never, { t: 'chat', text: 'two' });
  const lines = readFileSync(outboxPath(dataDir), 'utf8').trim().split('\n');
  assert.equal(lines.length, 1);
  const row = JSON.parse(lines[0]!) as { role: string; by: string; text: string };
  assert.equal(row.role, 'guest');
  assert.equal(row.by, 'acct-2');
  assert.equal(row.text, 'one');
  rmSync(parent, { recursive: true, force: true });
  rmSync(dataDir, { recursive: true, force: true });
});

test('a model name stays in the JSON body and does not change the URL path', async () => {
  const calls: { url: string; body?: string }[] = [];
  const made = createOllama('http://127.0.0.1:11434', async (url, init) => {
    calls.push({ url, body: init.body });
    return { ok: true, status: 200, text: async () => JSON.stringify({ message: { content: 'hi' } }) };
  });
  assert.ok('client' in made);
  await made.client.chat('x/../api/pull', [{ role: 'user', content: 'hi' }]);
  await made.client.generate({ model: 'x/../api/pull', keep_alive: 0 });
  assert.equal(calls[0]?.url, 'http://127.0.0.1:11434/api/chat');
  assert.equal(calls[1]?.url, 'http://127.0.0.1:11434/api/generate');
  assert.equal(JSON.parse(calls[0]?.body || '{}').model, 'x/../api/pull');
  assert.equal(JSON.parse(calls[1]?.body || '{}').model, 'x/../api/pull');
  assert.equal(calls[0]?.url?.includes('api/pull'), false);
});

test('a bridge token cannot talk as player', async () => {
  const dataDir = dir('token-talk');
  resetHqLimitsForTests();
  const { ctx, token } = ctxOf(dataDir, { id: 'talk-admin', role: 'admin' });
  const spoof = resOf();
  await hqRoutes.talk.handle(ctx, {
    req: reqOf(
      'POST',
      { host: '127.0.0.1:4600', 'content-type': 'application/json', 'x-bridge-token': token },
      JSON.stringify({ seat: 'seat-1', text: 'as owner' }),
    ),
    res: spoof.res,
  });
  assert.equal(spoof.status, 403);
  assert.equal(existsSync(outboxPath(dataDir)), false);
  const guestDir = dir('guest-talk');
  resetHqLimitsForTests();
  const guest = ctxOf(guestDir, { id: 'member-1', role: 'member' });
  const said = resOf();
  await hqRoutes.talk.handle(guest.ctx, {
    req: reqOf('POST', { host: '127.0.0.1:4600', 'content-type': 'application/json' }, JSON.stringify({ seat: 'seat-1', text: 'hello' })),
    res: said.res,
  });
  const body = JSON.parse(said.body) as { messages: { role: string }[] };
  assert.equal(said.status, 200);
  assert.equal(body.messages.some((m) => m.role === 'player'), false);
  assert.equal(body.messages.some((m) => m.role === 'guest'), true);
  const line = JSON.parse(readFileSync(outboxPath(guestDir), 'utf8').trim()) as { role: string; by: string };
  assert.equal(line.role, 'guest');
  assert.equal(line.by, 'member-1');
  resetHqLimitsForTests();
  rmSync(dataDir, { recursive: true, force: true });
  rmSync(guestDir, { recursive: true, force: true });
});
