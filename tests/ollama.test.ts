import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { chmodSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  DEFAULT_OLLAMA_URL,
  MAX_PREDICT,
  MAX_RESPONSE_BYTES,
  chatOllama,
  createOllamaClient,
  loopbackOrigin,
  ollamaEndpoint,
  probeOllama,
  resolveOllamaSettings,
  type OllamaClient,
  type OllamaFetch,
} from '../src/server/ollama.js';
import { officeCliBins, officeCliScanCount, scanCliBins } from '../src/server/cli-presence.js';
import { OUTBOX_CAP, writeOutboxFile } from '../src/server/outbox.js';
import { SeatBoard } from '../src/server/seat-provider.js';
import { OFFLINE, NEEDS_OWNER, LOCAL_BUSY } from '../src/shared/seat-provider.js';

function listen(handler: http.RequestListener, host = '127.0.0.1'): Promise<{ url: string; close(): Promise<void> }> {
  const server = http.createServer(handler);
  return new Promise((resolve) => {
    server.listen(0, host, () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve({
        url: `http://${host}:${port}`,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}

test('non-loopback URLs are refused and never fetched', async () => {
  for (const raw of ['http://evil.invalid:11434', 'http://0.0.0.0:11434', 'http://127.0.0.1:11434/api/pull', 'http://user:pass@127.0.0.1:11434', 'https://127.0.0.1:11434', 'https://localhost:11434']) {
    assert.equal(loopbackOrigin(raw).ok, false, raw);
  }
  const v4 = loopbackOrigin('http://127.0.0.1:11434');
  assert.equal(v4.ok, true);
  if (v4.ok) assert.equal(v4.origin, 'http://127.0.0.1:11434');
  const local = loopbackOrigin('http://localhost:11434');
  assert.equal(local.ok, true);
  if (local.ok) assert.equal(local.origin, 'http://127.0.0.1:11434');
  const v6 = loopbackOrigin('http://[::1]:11434');
  assert.equal(v6.ok, true);
  if (v6.ok) assert.equal(v6.origin, 'http://[::1]:11434');
  const refused = resolveOllamaSettings({ env: { OLLAMA_URL: 'http://evil.invalid:11434', OKKIN_MODEL: 'example' } });
  assert.equal(refused.refused, true);
  let called = false;
  const fetchImpl = async () => {
    called = true;
    throw new Error('fetched');
  };
  assert.equal(await probeOllama(refused, fetchImpl), 'offline');
  const chat = await chatOllama(refused, 'ping', fetchImpl);
  assert.equal(chat.ok, false);
  assert.equal(called, false);
});

test('a url on a request is ignored', () => {
  const fromEnv = resolveOllamaSettings({
    env: { OLLAMA_URL: 'http://127.0.0.1:11434', OKKIN_MODEL: 'example' },
    request: { url: 'http://evil.invalid:11434', OLLAMA_URL: 'http://evil.invalid:9', model: 'other', OKKIN_MODEL: 'other' },
  });
  assert.equal(fromEnv.url, 'http://127.0.0.1:11434');
  assert.equal(fromEnv.model, 'example');
  assert.equal(fromEnv.refused, false);
  const onlyRequest = resolveOllamaSettings({
    env: {},
    request: { url: 'http://evil.invalid:11434', OLLAMA_URL: 'http://evil.invalid:9', model: 'other' },
  });
  assert.equal(onlyRequest.url, DEFAULT_OLLAMA_URL);
  assert.equal(onlyRequest.model, null);
  assert.equal(onlyRequest.refused, false);
});

test('only tags, chat, and generate can be addressed', () => {
  const origin = 'http://127.0.0.1:11434';
  assert.equal(ollamaEndpoint(origin, '/api/tags'), origin + '/api/tags');
  assert.equal(ollamaEndpoint(origin, '/api/chat'), origin + '/api/chat');
  assert.equal(ollamaEndpoint(origin, '/api/generate'), origin + '/api/generate');
  assert.equal(ollamaEndpoint(origin, '/api/pull'), null);
  assert.equal(ollamaEndpoint(origin, '/api/delete'), null);
  assert.equal(ollamaEndpoint(origin, '/api/create'), null);
  assert.equal(ollamaEndpoint(origin, '/api/copy'), null);
  assert.equal(ollamaEndpoint(origin, '/api/push'), null);
});

test('a healthy mock answers chat and a down mock stays offline', async () => {
  const hits: string[] = [];
  let body = '';
  const healthy = await listen((req, res) => {
    hits.push(`${req.method} ${req.url}`);
    if (req.url === '/api/tags') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ models: [{ name: 'example' }] }));
      return;
    }
    if (req.url === '/api/chat') {
      req.on('data', (c) => {
        body += String(c);
      });
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ message: { content: 'pong' } }));
      });
      return;
    }
    res.writeHead(404);
    res.end();
  });
  const settings = resolveOllamaSettings({ env: { OLLAMA_URL: healthy.url, OKKIN_MODEL: 'example' } });
  assert.equal(await probeOllama(settings), 'ready');
  const chat = await chatOllama(settings, 'ping');
  assert.equal(chat.ok, true);
  if (chat.ok) assert.equal(chat.text, 'pong');
  const sent = JSON.parse(body) as { model: string; stream: boolean; options: { num_predict: number } };
  assert.equal(sent.model, 'example');
  assert.equal(sent.stream, false);
  assert.equal(sent.options.num_predict, MAX_PREDICT);
  assert.ok(hits.every((h) => h.includes('/api/tags') || h.includes('/api/chat')));
  await healthy.close();

  const down = await listen((_req, res) => {
    res.writeHead(500);
    res.end();
  });
  const downSettings = resolveOllamaSettings({ env: { OLLAMA_URL: down.url, OKKIN_MODEL: 'example' } });
  assert.equal(await probeOllama(downSettings), 'offline');
  const missed = await chatOllama(downSettings, 'ping');
  assert.equal(missed.ok, false);
  if (!missed.ok) assert.equal(missed.reason, 'offline');
  await down.close();
});

test('an unset model and a missing CLI do not invent a reply', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'seats-'));
  try {
    const board = new SeatBoard(dir, {
      env: {},
      detect: () => ({ claude: false, grok: false, 'cursor-agent': false }),
      fetchImpl: async () => {
        throw new Error('no fetch');
      },
    });
    assert.equal(board.providerFor('meeting-room'), 'bridge');
    const queued = board.decide('floor', 'meeting-room', 'ping');
    assert.equal(queued.action, 'queued');
    const file = JSON.parse(readFileSync(path.join(dir, 'kavi-outbox.json'), 'utf8')) as { items: { title: string; text: string }[] };
    assert.equal(file.items.length, 1);
    assert.equal(file.items[0].title, 'seat:floor:meeting-room');
    assert.equal(file.items.some((it) => it.title.startsWith('reply:')), false);
    board.setProvider('meeting-room', 'ollama');
    const offline = board.decide('floor', 'meeting-room', 'ping');
    assert.equal(offline.action, 'blocked');
    if (offline.action === 'blocked') assert.equal(offline.message, OFFLINE);
    board.setProvider('desk-nope', 'claude');
    board.setProvider('meeting-room', 'claude');
    const missing = board.decide('floor', 'meeting-room', 'ping');
    assert.equal(missing.action, 'blocked');
    if (missing.action === 'blocked') assert.equal(missing.message, NEEDS_OWNER);
    const faces = board.faces('floor');
    assert.ok(faces.some((f) => f.id === 'meeting-room' && f.label === NEEDS_OWNER));
    assert.equal(faces.find((f) => f.id === 'meeting-room')?.reply ?? null, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('neither a local model nor a writable bridge says needs owner', () => {
  const missing = path.join(tmpdir(), `no-bridge-${process.pid}`);
  rmSync(missing, { recursive: true, force: true });
  const board = new SeatBoard(missing, {
    env: {},
    detect: () => ({ claude: false, grok: false, 'cursor-agent': false }),
  });
  assert.equal(board.bridgeUp, false);
  assert.equal(board.providerFor('meeting-room'), 'bridge');
  const blocked = board.decide('floor', 'meeting-room', 'ping');
  assert.equal(blocked.action, 'blocked');
  if (blocked.action === 'blocked') assert.equal(blocked.message, NEEDS_OWNER);
  const face = board.faces('floor').find((f) => f.id === 'meeting-room');
  assert.equal(face?.label, NEEDS_OWNER);
  assert.equal(face?.reply, null);
  board.setProvider('meeting-room', 'ollama');
  const offline = board.decide('floor', 'meeting-room', 'ping');
  assert.equal(offline.action, 'blocked');
  if (offline.action === 'blocked') assert.equal(offline.message, OFFLINE);
});

test('the client is told the model name and state, not the response body', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'seats-view-'));
  try {
    const board = new SeatBoard(dir, {
      env: { OLLAMA_URL: 'http://127.0.0.1:9', OKKIN_MODEL: 'example' },
      detect: () => ({ claude: false, grok: false, 'cursor-agent': false }),
      fetchImpl: async (url) => ({
        ok: true,
        status: 200,
        text: async () =>
          url.endsWith('/api/tags')
            ? JSON.stringify({ models: [{ name: 'example' }], raw: 'tags-body' })
            : JSON.stringify({ message: { content: 'pong' }, raw: 'chat-body' }),
      }),
    });
    const client: OllamaClient = board.client;
    assert.equal(typeof client.probe, 'function');
    assert.equal(typeof client.chat, 'function');
    assert.equal(createOllamaClient({ env: { OKKIN_MODEL: 'example' } }).settings.model, 'example');
    await board.probe(true);
    const view = board.clientView();
    assert.deepEqual(view, { model: 'example', state: 'ready' });
    assert.equal(JSON.stringify(view).includes('tags-body'), false);
    assert.equal(Object.keys(view).join(','), 'model,state');
    const ran = await board.runOllama('floor', 'meeting-room', 'ping');
    assert.equal(ran.ok, true);
    if (ran.ok) assert.equal(ran.text, 'pong');
    const face = board.faces('floor').find((f) => f.id === 'meeting-room');
    assert.equal(face?.reply, 'pong');
    assert.equal(JSON.stringify(face).includes('chat-body'), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a redirect to another host is not followed', async () => {
  const hits: string[] = [];
  const evil = await listen((req, res) => {
    hits.push(String(req.url));
    res.writeHead(200);
    res.end('stolen');
  }, '127.0.0.2');
  const local = await listen((_req, res) => {
    res.writeHead(307, { location: `${evil.url}/stolen` });
    res.end();
  });
  try {
    const settings = resolveOllamaSettings({ env: { OLLAMA_URL: local.url, OKKIN_MODEL: 'example' } });
    assert.equal(await probeOllama(settings), 'offline');
    assert.deepEqual(hits, []);
  } finally {
    await evil.close();
    await local.close();
  }
});

test('a local-model body over 1 MB is dropped without reading the rest', async () => {
  const settings = resolveOllamaSettings({ env: { OLLAMA_URL: 'http://127.0.0.1:9', OKKIN_MODEL: 'example' } });
  let textCalled = false;
  let cancelled = false;
  const declared: OllamaFetch = async (_url, init) => {
    assert.equal(init.redirect, 'error');
    return {
      ok: true,
      status: 200,
      headers: { get: (name) => (name.toLowerCase() === 'content-length' ? String(MAX_RESPONSE_BYTES + 1) : null) },
      body: { cancel: async () => { cancelled = true; }, getReader: () => { throw new Error('read'); } },
      text: async () => {
        textCalled = true;
        return '';
      },
    };
  };
  assert.equal(await probeOllama(settings, declared), 'offline');
  assert.equal(textCalled, false);
  assert.equal(cancelled, true);

  let reads = 0;
  let streamCancelled = false;
  const chunk = new Uint8Array(600_000);
  const streamed: OllamaFetch = async () => ({
    ok: true,
    status: 200,
    headers: { get: () => null },
    body: {
      getReader: () => ({
        async read() {
          reads += 1;
          if (reads > 4) return { done: true };
          return { done: false, value: chunk };
        },
        async cancel() {
          streamCancelled = true;
        },
      }),
    },
    text: async () => {
      throw new Error('text');
    },
  });
  assert.equal(await probeOllama(settings, streamed), 'offline');
  assert.equal(streamCancelled, true);
  assert.ok(reads < 4);
});

test('one local-model call per seat at a time', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'seats-busy-'));
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let chats = 0;
  try {
    const board = new SeatBoard(dir, {
      env: { OLLAMA_URL: 'http://127.0.0.1:9', OKKIN_MODEL: 'example' },
      detect: () => ({ claude: false, grok: false, 'cursor-agent': false }),
      fetchImpl: async (url) => {
        if (String(url).endsWith('/api/tags')) {
          return { ok: true, status: 200, text: async () => JSON.stringify({ models: [{ name: 'example' }] }) };
        }
        chats += 1;
        await gate;
        return { ok: true, status: 200, text: async () => JSON.stringify({ message: { content: 'pong' } }) };
      },
    });
    board.setProvider('meeting-room', 'ollama');
    await board.probe(true);
    const first = board.runOllama('floor', 'meeting-room', 'ping');
    const second = await board.runOllama('floor', 'meeting-room', 'again');
    assert.equal(second.ok, false);
    if (!second.ok) assert.equal(second.message, LOCAL_BUSY);
    const decided = board.decide('floor', 'meeting-room', 'third');
    assert.equal(decided.action, 'blocked');
    if (decided.action === 'blocked') assert.equal(decided.message, LOCAL_BUSY);
    release();
    const done = await first;
    assert.equal(done.ok, true);
    assert.equal(chats, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the outbox rewrite is capped at 200 and mode 0600', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'outbox-'));
  try {
    const file = path.join(dir, 'kavi-outbox.json');
    writeFileSync(file, '{"items":[]}\n', { mode: 0o644 });
    const items = Array.from({ length: OUTBOX_CAP + 1 }, (_, i) => ({ title: 't', text: String(i), at: 't' }));
    writeOutboxFile(file, items);
    const saved = JSON.parse(readFileSync(file, 'utf8')) as { items: { text: string }[] };
    assert.equal(saved.items.length, OUTBOX_CAP);
    assert.equal(saved.items[0].text, '1');
    assert.equal(saved.items.at(-1)?.text, String(OUTBOX_CAP));
    assert.equal(statSync(file).mode & 0o777, 0o600);
    assert.equal(readdirSync(dir).some((name) => name.endsWith('.tmp')), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI presence is the executable bit on PATH, once per office', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'bins-'));
  try {
    writeFileSync(path.join(dir, 'claude'), '#!/bin/sh\n');
    chmodSync(path.join(dir, 'claude'), 0o755);
    writeFileSync(path.join(dir, 'grok'), 'nope');
    chmodSync(path.join(dir, 'grok'), 0o644);
    const found = scanCliBins(dir);
    assert.equal(found.claude, true);
    assert.equal(found.grok, false);
    assert.equal(found['cursor-agent'], false);
    const before = officeCliScanCount();
    officeCliBins();
    const mid = officeCliScanCount();
    officeCliBins();
    assert.equal(officeCliScanCount(), mid);
    assert.ok(mid === before || mid === before + 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
