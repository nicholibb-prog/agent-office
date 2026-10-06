// The loopback crew-status bridge: a push sets a hired desk WORKING or clears it, and never hires one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import type http from 'node:http';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { applyCrewStatus, isLoopback, readCrewStatus } from '../src/server/bridge/status.js';
import { bridgeRoutes } from '../src/server/http/routes/bridge.js';
import { loadConfig } from '../src/server/config.js';
import { startServer } from '../src/server/server.js';
import type { WorkerInfo } from '../src/shared/protocol.js';

function worker(name: string, more: Partial<WorkerInfo> = {}): WorkerInfo {
  return {
    id: name.toLowerCase(),
    kind: 'agent',
    deskId: 'desk-3',
    name,
    color: '#fff',
    status: 'idle',
    acked: true,
    createdBy: 'Ada',
    createdAt: 0,
    cols: 80,
    rows: 24,
    viewers: [],
    viewerIds: [],
    ...more,
  };
}

test('loopback is this machine only', () => {
  assert.equal(isLoopback('127.0.0.1'), true);
  assert.equal(isLoopback('::1'), true);
  assert.equal(isLoopback('::ffff:127.0.0.1'), true);
  assert.equal(isLoopback('10.1.1.1'), false);
  assert.equal(isLoopback('0.0.0.0'), false);
  assert.equal(isLoopback(undefined), false);
});

test('the body is a name and working or idle', () => {
  assert.deepEqual(readCrewStatus({ name: ' George ', status: 'working' }), { name: 'George', status: 'working' });
  assert.deepEqual(readCrewStatus({ name: 'george', status: 'idle' }), { name: 'george', status: 'idle' });
  for (const body of [null, [], { status: 'working' }, { name: 'george' }, { name: 'george', status: 'done' }, { name: '   ', status: 'idle' }]) {
    assert.equal('error' in readCrewStatus(body), true, JSON.stringify(body));
  }
});

test('working seats a live worker, idle clears WORKING, and a missing or parked name is left alone', () => {
  const george = worker('George');
  const parked = worker('Nikko', { id: 'nikko', status: 'offline', deskId: 'desk-4' });
  const calls: [string, string][] = [];
  const set = (id: string, status: 'working' | 'idle') => {
    calls.push([id, status]);
    const w = id === george.id ? george : parked;
    if (status === 'working') w.status = 'working';
    else if (w.status === 'working') w.status = 'idle';
    return w.status;
  };
  const live = (id: string) => id === george.id;

  const working = applyCrewStatus([george, parked], live, { name: 'george', status: 'working' }, set);
  assert.equal('ok' in working && working.ok, true);
  if ('ok' in working) {
    assert.equal(working.desk, 'desk-3');
    assert.equal(working.status, 'working');
    assert.equal(working.seated, true);
    assert.equal(working.changed, true);
  }

  const idle = applyCrewStatus([george, parked], live, { name: 'GEORGE', status: 'idle' }, set);
  assert.equal('ok' in idle && idle.status, 'idle');
  assert.deepEqual(calls, [
    ['george', 'working'],
    ['george', 'idle'],
  ]);

  const missing = applyCrewStatus([george], live, { name: 'kavi', status: 'working' }, set);
  assert.deepEqual(missing, { error: "No worker here is called kavi (there's George)", code: 404 });

  const asleep = applyCrewStatus([parked], () => false, { name: 'nikko', status: 'working' }, set);
  assert.equal('error' in asleep && asleep.code, 409);
  assert.equal(parked.status, 'offline');
  assert.equal(calls.length, 2);
});

function capture() {
  let status = 0;
  let raw = '';
  const res = {
    writeHead(code: number) {
      status = code;
    },
    end(body?: string) {
      raw = body ?? '';
    },
    headersSent: false,
  };
  return { status: () => status, json: () => JSON.parse(raw) as { error?: string }, res: res as unknown as http.ServerResponse };
}

test('the route refuses a socket that is not this machine, before it reads a body', async () => {
  const got = capture();
  const req = { socket: { remoteAddress: '203.0.113.8' } } as http.IncomingMessage;
  const url = new URL('http://127.0.0.1/api/bridge/status');
  await bridgeRoutes.statusPost.handle({} as never, { req, res: got.res, url, path: url.pathname });
  assert.equal(got.status(), 403);
  assert.match(got.json().error ?? '', /this machine/);
});

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address() as net.AddressInfo;
      s.close(() => resolve(port));
    });
  });
}

test('POST /api/bridge/status flips a live desk to WORKING and back, and does not invent Kavi', { timeout: 60_000 }, async () => {
  const tmp = mkdtempSync(path.join(tmpdir(), 'agent-office-bridge-'));
  const home = path.join(tmp, 'home');
  const project = path.join(tmp, 'project');
  const publicDir = path.join(tmp, 'public');
  const bin = path.join(tmp, 'bin');
  for (const d of [home, project, publicDir, path.join(publicDir, 'assets'), bin, path.join(tmp, 'projects')]) mkdirSync(d, { recursive: true });
  writeFileSync(path.join(project, 'README.md'), '# bridge\n');
  for (const args of [['init', '-q', '-b', 'main'], ['add', '.'], ['-c', 'user.name=test', '-c', 'user.email=test@example.com', 'commit', '-qm', 'init']]) {
    execFileSync('git', args, { cwd: project });
  }
  for (const page of ['index', 'login', 'claim', 'join', 'lite']) writeFileSync(path.join(publicDir, `${page}.html`), '<!doctype html>');
  writeFileSync(path.join(publicDir, 'favicon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  const claude = path.join(bin, 'claude');
  writeFileSync(claude, '#!/bin/sh\nexit 0\n');
  chmodSync(claude, 0o755);
  for (const k of Object.keys(process.env)) if (k.startsWith('AGENT_OFFICE_')) delete process.env[k];

  const port = await freePort();
  const cfg = loadConfig([project, '--home', home, '--projects', path.join(tmp, 'projects'), '--port', String(port), '--password', 'bridge-test', '--no-open', '--weather', 'clear', '--agent', claude]);
  let office: Awaited<ReturnType<typeof startServer>> | undefined;
  const base = `http://127.0.0.1:${port}`;
  const post = (body: unknown) =>
    fetch(base + '/api/bridge/status', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  try {
    office = await startServer(cfg, { publicDir });
    const empty = await fetch(base + '/api/bridge/status');
    assert.equal(empty.status, 200);
    assert.deepEqual(await empty.json(), { ok: true, workers: [] });

    const none = await post({ name: 'george', status: 'working' });
    assert.equal(none.status, 404);
    assert.match((await none.json()).error, /george/);

    const login = await fetch(base + '/api/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: 'bridge-test' }),
    });
    assert.equal(login.status, 200);
    const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0];
    const messages: { t: string }[] = [];
    const ws = new WebSocket(`${base.replace('http', 'ws')}/ws?name=Ada`, { headers: { cookie, origin: base } });
    ws.on('message', (raw) => messages.push(JSON.parse(raw.toString())));
    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => resolve());
      ws.once('error', reject);
    });
    const waitFor = async (pred: () => boolean) => {
      const until = Date.now() + 15000;
      while (!pred()) {
        if (Date.now() > until) throw new Error(`timed out; saw ${messages.map((m) => m.t).join(', ')}`);
        await new Promise((r) => setTimeout(r, 50));
      }
    };
    await waitFor(() => messages.some((m) => m.t === 'welcome'));
    ws.send(JSON.stringify({ t: 'worker.spawn', deskId: 'desk-1', kind: 'shell' }));
    await waitFor(() => messages.some((m) => m.t === 'worker.update' || (m.t === 'welcome' && (m.workers?.length ?? 0) > 0)));

    let row: { name: string; desk: string; status: string; live: boolean } | undefined;
    const until = Date.now() + 15000;
    while (!row?.live) {
      const listed = (await (await fetch(base + '/api/bridge/status')).json()) as { workers: typeof row[] };
      row = listed.workers[0];
      if (row?.live) break;
      if (Date.now() > until) throw new Error(`shell never started: ${JSON.stringify(listed)}`);
      await new Promise((r) => setTimeout(r, 100));
    }
    const name = row.name.replace(/\s*🐚$/u, '');

    const on = await post({ name, status: 'working' });
    assert.equal(on.status, 200);
    const seated = (await on.json()) as { ok: boolean; status: string; desk: string; seated: boolean; name: string };
    assert.equal(seated.ok, true);
    assert.equal(seated.status, 'working');
    assert.equal(seated.seated, true);
    assert.equal(seated.desk, 'desk-1');

    const listed = (await (await fetch(base + '/api/bridge/status')).json()) as { workers: { name: string; status: string }[] };
    assert.equal(listed.workers.find((w) => w.name === row!.name)?.status, 'working');

    const off = await post({ name: name.toUpperCase(), status: 'idle' });
    assert.equal(off.status, 200);
    assert.equal((await off.json()).status, 'idle');

    const kavi = await post({ name: 'kavi', status: 'working' });
    assert.equal(kavi.status, 404);
    const after = (await (await fetch(base + '/api/bridge/status')).json()) as { workers: { name: string; desk: string }[] };
    assert.equal(after.workers.length, 1);
    assert.equal(after.workers.some((w) => /kavi/i.test(w.name)), false);

    ws.close();
  } finally {
    office?.shutdown();
    rmSync(tmp, { recursive: true, force: true });
  }
});
