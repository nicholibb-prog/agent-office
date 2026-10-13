// The power switch end to end, through /api, against a stand-in Ollama started and stopped by the
// real power path (spawn/execFile, no shell). ON starts it and loads the chosen model; OFF unloads
// every model and runs the OFF script. Also: the room's switch and the panel button both go through
// the one toggle, and a locked switch says why.
import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createConnection } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { hqRoutes } from '../src/server/http/routes/hq.js';
import { resetPowerForTests } from '../src/server/hq/okkin-power.js';
import { resetOkkinForTests, setOkkinFetchForTests } from '../src/server/hq/okkin.js';
import { testOwner } from './support/okkin-owner.js';
import { POWER_ON_FIRST, powerReasonText, stopsView, switchView, type LoftLike } from '../src/client/features/okkin-loft/model.js';

const ctx2d = new Proxy({}, { get: (_t, k) => (k === 'measureText' ? () => ({ width: 40 }) : () => ({ addColorStop() {} })), set: () => true });
(globalThis as { document?: unknown }).document ??= { createElement: () => ({ getContext: () => ctx2d, width: 0, height: 0 }) };

const support = path.join(import.meta.dirname, 'support');
const listening = (port: number) => new Promise<boolean>((r) => { const s = createConnection(port, '127.0.0.1'); s.once('connect', () => { s.destroy(); r(true); }); s.once('error', () => r(false)); });

function ctxOf(dataDir: string) {
  writeFileSync(path.join(dataDir, 'bridge-token'), 'e'.repeat(64));
  const session = { account: { id: 'owner', role: 'admin' as const } };
  return { cfg: { dataDir }, auth: { fromRequest: () => session, fromAnyCookie: () => true, sessionFromAnyCookie: () => session }, meOf: () => ({ admin: true }), workers: { list: () => [] } } as never;
}
let cookie = '';
function call(route: { handle: (...a: never[]) => unknown }, ctx: never, method: string, url: string, body?: unknown) {
  let status = 0;
  let out = '';
  const res = { writeHead(s: number) { status = s; }, setHeader() {}, end(b?: unknown) { out = String(b ?? ''); } } as unknown as ServerResponse;
  const req = Readable.from([Buffer.from(body ? JSON.stringify(body) : '')]) as unknown as IncomingMessage;
  req.method = method;
  req.headers = { host: '127.0.0.1:4600', 'content-type': 'application/json', cookie };
  return Promise.resolve((route.handle as (c: never, a: unknown) => unknown)(ctx, { req, res, url: new URL(`http://127.0.0.1:4600${url}`) })).then(() => ({ status, json: JSON.parse(out || '{}') }));
}

test('E and click both flip the REAL power: on (Ollama up, chosen model loaded), then off (models unloaded, OFF script ran)', async (t) => {
  const owner = await testOwner();
  const dataDir = mkdtempSync(path.join(tmpdir(), 'ao-power-e2e-'));
  const pid = path.join(dataDir, 'stub.pid');
  const file = path.join(dataDir, 'okkin-power.json');
  writeFileSync(file, JSON.stringify({ start: [process.execPath, path.join(support, 'stub-ollama.mjs'), pid], stop: [process.execPath, path.join(support, 'stub-ollama-off.mjs'), pid], tuning: { num_ctx: 4096 } }));
  chmodSync(file, 0o600);
  const prev = { url: process.env.OLLAMA_URL, model: process.env.OKKIN_MODEL, allow: process.env.OKKIN_MODEL_ALLOW };
  process.env.OLLAMA_URL = 'http://127.0.0.1:11434';
  process.env.OKKIN_MODEL = 'okkin:latest';
  process.env.OKKIN_MODEL_ALLOW = 'okkin:latest,qwen3.5:4b';
  resetPowerForTests();
  resetOkkinForTests();
  // Okkin only ever calls 127.0.0.1:11434; here that's pointed at the stub's ephemeral port.
  const portOf = () => Number(readFileSync(`${pid}.port`, 'utf8'));
  const redirect = (async (url: string, init: RequestInit) => fetch(url.replace('127.0.0.1:11434', `127.0.0.1:${portOf()}`), init)) as never;
  setOkkinFetchForTests(redirect);
  const ctx = ctxOf(dataDir);
  cookie = owner.cookie();
  try {
    const before = await call(hqRoutes.okkinLoft, ctx, 'GET', '/api/bridge/okkin/loft');
    assert.equal(before.status, 200);
    assert.equal(before.json.power, 'off');
    assert.equal(before.json.powerControl, 'ready', `config passed: ${before.json.powerReason}`);
    // ON (what E at the switch and a click on it both send: see the toggle in index.ts).
    const on = await call(hqRoutes.okkinPower, ctx, 'POST', '/api/bridge/okkin/power', { action: 'start' });
    assert.equal(on.status, 200, on.json.error);
    assert.equal(on.json.power, 'on');
    resetOkkinForTests();
    setOkkinFetchForTests(redirect);
    const after = await call(hqRoutes.okkinLoft, ctx, 'GET', '/api/bridge/okkin/loft');
    assert.equal(after.json.power, 'on');
    assert.deepEqual(after.json.loaded.map((m: { name: string }) => m.name), ['okkin:latest'], 'ON loaded the chosen model');
    writeFileSync(path.join(dataDir, 'state-on.json'), JSON.stringify(after.json, null, 1));
    // OFF (cooldown cleared: the test isn't waiting a minute).
    resetPowerForTests();
    const off = await call(hqRoutes.okkinPower, ctx, 'POST', '/api/bridge/okkin/power', { action: 'stop' });
    assert.equal(off.status, 200, off.json.error);
    assert.equal(off.json.power, 'off');
    assert.deepEqual(off.json.script, { vramMiB: 1024, ramMiB: 0 }, 'the OFF script ran');
    const stubPort = portOf();
    resetOkkinForTests();
    setOkkinFetchForTests(redirect);
    const end = await call(hqRoutes.okkinLoft, ctx, 'GET', '/api/bridge/okkin/loft');
    assert.equal(end.json.power, 'off');
    assert.equal(await listening(stubPort), false, 'the stub Ollama is down');
    assert.notEqual(stubPort, 11434, 'never the real Ollama port');
    const calls = readFileSync(`${pid}.calls`, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as { model: string; keep_alive?: number; options?: { num_ctx?: number } });
    assert.equal(calls[0]!.model, 'okkin:latest');
    assert.equal(calls[0]!.options?.num_ctx, 4096, 'ON loads with its tuning');
    assert.deepEqual(calls.slice(1), [{ model: 'okkin:latest', keep_alive: 0 }], 'OFF unloads every loaded model first');
    const log = readFileSync(path.join(dataDir, 'okkin-power.log'), 'utf8');
    assert.match(log, /on, loaded okkin:latest/);
    assert.match(log, /"result":"off"/);
  } finally {
    if (existsSync(pid)) try { process.kill(Number(readFileSync(pid, 'utf8'))); } catch {}
    setOkkinFetchForTests(undefined);
    for (const [k, v] of [['OLLAMA_URL', prev.url], ['OKKIN_MODEL', prev.model], ['OKKIN_MODEL_ALLOW', prev.allow]] as const) if (v === undefined) delete process.env[k]; else process.env[k] = v;
    resetPowerForTests();
    resetOkkinForTests();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('the switch and the dial in the room are usable (E or click): they carry their interactables', async () => {
  const { buildOkkinLoft, okkinLoft } = await import('../src/client/features/okkin-loft/world.js');
  const view = buildOkkinLoft();
  const sw = view.group.getObjectByName('okkin-power-switch')!;
  const dial = view.group.getObjectByName('okkin-model-dial')!;
  // A click raycasts to the mesh and walks up to userData.interact; E uses the nearest interactable. Same object for both.
  let leverIt: unknown;
  sw.traverse((o) => { if (o.name === 'okkin-power-lever') for (let p: typeof o | null = o; p; p = p.parent) leverIt ??= p.userData.interact; });
  assert.equal((leverIt as { kind: string }).kind, 'okkinswitch');
  assert.equal((dial.userData.interact as { kind: string }).kind, 'okkindial');
  assert.ok(view.interactables.includes(sw.userData.interact));
  const fx = okkinLoft({ wall() {} } as never);
  assert.deepEqual(fx.interactables.map((i) => i.kind), ['okkinswitch', 'okkindial']);
});

test('the one toggle: the panel button and E both call it; nothing in the panel disables the switch', () => {
  const src = readFileSync(path.join(import.meta.dirname, '../src/client/features/okkin-loft/index.ts'), 'utf8');
  assert.match(src, /power\.addEventListener\('click', \(\) => act\.toggle\(\)\)/);
  assert.match(src, /define\('okkinswitch',[\s\S]*?use: onE\(\(\) => toggle\(\)\)/);
  assert.doesNotMatch(src, /button\.okl-power'[^\n]*disabled: /, 'the power button is never disabled');
  assert.doesNotMatch(src, /okl-load'[^\n]*disabled: /, 'Load is never silently disabled');
  assert.doesNotMatch(src, /okl-input'[^\n]*disabled: /, 'Ask is never silently disabled');
});

const base: LoftLike = { power: 'off', powerControl: 'not-set-up', powerReason: 'power config ACL not verified on Windows', okkin: { chip: 'offline', configured: 'okkin:latest', model: null }, dial: [{ tag: 'okkin:latest', role: 'default', installed: true, ramOk: true, minFreeRamGB: null }] };

test('locked switch says why, inline: the Windows ACL gate names the operator step', () => {
  const sw = switchView(base);
  assert.equal(sw.works, false);
  assert.equal(sw.reason, 'Power switch locked: operator must verify okkin-power.json ACL and set AO_OKKIN_POWER_WINDOWS_ACL_OK=1 (docs/hq.md)');
  assert.match(powerReasonText(null), /^Power switch locked: /);
  assert.match(switchView({ ...base, powerReason: 'power config is group- or world-writable' }).reason!, /locked: power config is group- or world-writable/);
});

test('a lapsed session (401) is its own state: Sign in again; unreachable is Can\'t reach Okkin', () => {
  const s401 = switchView(null, 'The loft API refused (401).', 401);
  assert.equal(s401.label, 'Sign in again');
  assert.equal(s401.signIn, true);
  const down = switchView(null, 'The loft API could not be reached.', null);
  assert.equal(down.label, "Can't reach Okkin");
  assert.notEqual(down.signIn, true);
});

test('power off: the dial says Turn power on first', () => {
  assert.equal(stopsView({ ...base, powerControl: 'ready', powerReason: null })[0]!.note, POWER_ON_FIRST);
});
