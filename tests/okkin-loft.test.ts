import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, statSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { childEnv, exposedOnAllInterfaces, flipPower, lacksRights, loadPowerConfig, parseAction, parseGpuStats, resetPowerForTests, type PowerDeps, type Runner } from '../src/server/hq/okkin-power.js';
import { bestModelFor, dialStops, parseLoftConfig, ramAllows } from '../src/server/hq/okkin-loft.js';
import { okkinSettings, okkinThread, probeOkkin, resetOkkinForTests, switchOkkinModel, talkToOkkin, tokenSpeed } from '../src/server/hq/okkin.js';
import { psModels, chatText } from '../src/server/ollama.js';
import { okkinMayTake } from '../src/shared/hq.js';
import { talkLimited, resetHqLimitsForTests } from '../src/server/hq/limits.js';

const HQ = { crewKeysLower: [], humanAliases: [], humanMapsTo: '', crewDesks: false, seats: {} };
const dir = () => {
  const d = path.join(tmpdir(), `ao-loft-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(d, { recursive: true });
  return d;
};
const fakeOllama = (tags: string[], extra: Record<string, unknown> = {}) => async (url: string) => {
  const text = url.endsWith('/api/tags') ? JSON.stringify({ models: tags.map((name) => ({ name })) }) : url.endsWith('/api/ps') ? JSON.stringify({ models: [{ name: tags[0], size_vram: 2 * 1048576 }] }) : JSON.stringify({ message: { content: 'hi <b>x</b>\u001b[31m' }, eval_count: 50, eval_duration: 2e9, ...extra });
  return { ok: true, status: 200, text: async () => text };
};
const down = async () => { throw new Error('ECONNREFUSED'); };

test('dial = loft config ∩ /api/tags (mocked), never a hardcoded list', () => {
  const cfg = parseLoftConfig({ models: [{ tag: 'a:1b', role: 'quick', bestFor: ['quick'] }, { tag: 'b:9b', role: 'code', bestFor: ['code'], num_ctx: 16384 }, { tag: '../x' }] });
  assert.deepEqual(cfg.models.map((m) => m.tag), ['a:1b', 'b:9b']);
  assert.deepEqual(dialStops(cfg, ['b:9b', 'z:2b']).map((m) => m.tag), ['b:9b']);
  assert.equal(bestModelFor('code', cfg.models)?.tag, 'b:9b');
  assert.equal(ramAllows({ tag: 'big', role: 'big', bestFor: [], minFreeRamGB: 22 }, 8 * 1024 ** 3), false);
  assert.equal(parseLoftConfig({}).idleSleepMin, null);
});

test('OLLAMA_HOST is ignored and Okkin is pinned to 127.0.0.1:11434', () => {
  const prev = process.env.OLLAMA_HOST;
  process.env.OLLAMA_HOST = '203.0.113.5:11434';
  assert.deepEqual(okkinSettings({}, HQ).url, { url: 'http://127.0.0.1:11434' });
  assert.ok('refused' in okkinSettings({ OLLAMA_URL: 'http://127.0.0.1:9999' }, HQ).url);
  if (prev === undefined) delete process.env.OLLAMA_HOST; else process.env.OLLAMA_HOST = prev;
  assert.equal(childEnv({ OLLAMA_HOST: '0.0.0.0', PATH: '/bin' }).OLLAMA_HOST, '127.0.0.1:11434');
  assert.equal(childEnv({ EVIL: '1' }).EVIL, undefined);
});

test('offline Ollama is an honest offline state; switch is refused while power is off', async () => {
  resetOkkinForTests();
  const env = { OKKIN_MODEL_ALLOW: 'a:1b' };
  assert.equal((await probeOkkin(env, HQ, down as never)).chip, 'offline');
  const sw = await switchOkkinModel(env, HQ, 'a:1b', down as never);
  assert.equal(sw.status, 503);
});

test('a model name not on the allowlist is rejected', async () => {
  resetOkkinForTests();
  const sw = await switchOkkinModel({ OKKIN_MODEL_ALLOW: 'a:1b' }, HQ, 'b:9b', fakeOllama(['a:1b', 'b:9b']) as never);
  assert.equal(sw.status, 400);
});

test('Ask: memory only, control chars stripped, real token speed from eval_count/eval_duration', async () => {
  resetOkkinForTests();
  const d = dir();
  const r = await talkToOkkin(d, { OKKIN_MODEL: 'a:1b', OKKIN_MODEL_ALLOW: 'a:1b' }, HQ, 'hello', fakeOllama(['a:1b']) as never);
  assert.equal(r.status, 200);
  const bot = okkinThread().find((m) => m.role === 'bot')!;
  assert.equal(/[\u0000-\u001f]/.test(bot.text), false);
  assert.deepEqual(tokenSpeed({ eval_count: 50, eval_duration: 2e9 }), { tokens: 50, tokensPerSec: 25 });
  assert.equal(tokenSpeed({}), null);
  assert.equal(chatText({ ok: true, status: 200, body: { message: { content: 'a\u0007b' } } }), 'a b');
  assert.throws(() => readFileSync(path.join(d, 'hq-threads.json')));
  assert.deepEqual(psModels({ ok: true, status: 200, body: { models: [{ name: 'a:1b', size_vram: 1048576 * 3 }] } }), [{ name: 'a:1b', vramMB: 3 }]);
  rmSync(d, { recursive: true, force: true });
});

test('rate cap on Ask per session', () => {
  resetHqLimitsForTests();
  assert.equal(talkLimited('k', 1000), false);
  assert.equal(talkLimited('k', 1500), true);
});

test('open tier only for Okkin', () => {
  assert.equal(okkinMayTake({ tier: 'open' }), true);
  for (const tier of ['code', 'money', 'sends', 'security', undefined]) assert.equal(okkinMayTake({ tier }), false);
});

test('power: enum only; unconfigured or placeholder config is a no-op', async () => {
  assert.equal(parseAction('start'), 'start');
  assert.equal(parseAction('start; rm -rf /'), null);
  const d = dir();
  assert.equal(loadPowerConfig(d).ok, false);
  writeFileSync(path.join(d, 'okkin-power.json'), readFileSync('docs/okkin-power.example.json'), { mode: 0o600 });
  const l = loadPowerConfig(d);
  assert.equal(l.ok, false);
  let ran = 0;
  const runner: Runner = { start: async () => (ran++, { ok: true }), run: async () => (ran++, { ok: true, code: 0, stderr: '' }), gpuUsedMB: async () => 0, listeners: async () => '' };
  resetPowerForTests();
  const r = await flipPower(d, 'start', 't', { runner, reachable: async () => false, loaded: async () => [], generate: async () => true, chosenModel: async () => null });
  assert.equal(r.status, 503);
  assert.equal(ran, 0);
  rmSync(d, { recursive: true, force: true });
});

test('power config: no shell, no elevation, owner + mode checks, Windows fails closed', () => {
  const fsOf = (obj: unknown, st = { uid: 1, mode: 0o100600 }) => ({ exists: () => true, stat: () => st, read: () => JSON.stringify(obj) });
  const good = { start: ['/usr/bin/ollama', 'serve'], stop: ['/usr/bin/pkill', '-x', 'ollama'] };
  assert.equal(loadPowerConfig('/x', { fs: fsOf(good), uid: 1, platform: 'linux' }).ok, true);
  assert.equal(loadPowerConfig('/x', { fs: fsOf(good, { uid: 2, mode: 0o100600 }), uid: 1, platform: 'linux' }).ok, false);
  assert.equal(loadPowerConfig('/x', { fs: fsOf(good, { uid: 1, mode: 0o100622 }), uid: 1, platform: 'linux' }).ok, false);
  assert.equal(loadPowerConfig('/x', { fs: fsOf(good), uid: 1, platform: 'win32', env: {} }).ok, false);
  for (const bad of [['sh', '-c', 'x'], ['sudo', 'x'], ['runas', 'x'], ['sc', 'stop', 'x'], ['/bin/x', 'a;b'], ['/bin/x', '$(id)'], ['powershell', '-Command', 'x'], ['powershell', '-NoProfile', '-File', 'C:\\x\\okkin-off-v2.ps1'], ['powershell', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', 'C:\\x\\other.ps1'], ['powershell', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', 'C:\\x\\okkin-off-v2.ps1', '-Command']]) {
    assert.equal(loadPowerConfig('/x', { fs: fsOf({ start: good.start, stop: bad }), uid: 1, platform: 'linux' }).ok, false, bad.join(' '));
  }
  assert.equal(loadPowerConfig('/x', { fs: fsOf({ start: good.start, stop: ['powershell', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', 'C:\\ops\\okkin-off-v2.ps1', '-WhatIf'], scriptPath: 'C:\\ops\\okkin-off-v2.ps1', scriptSha256: '7'.repeat(64) }), uid: 1, platform: 'linux' }).ok, true);
});

function deps(over: Partial<PowerDeps> & { up?: { v: boolean } } = {}): PowerDeps {
  const up = over.up ?? { v: false };
  const runner: Runner = { start: async () => ((up.v = true), { ok: true }), run: async () => ((up.v = false), { ok: true, code: 0, stderr: '' }), gpuUsedMB: async () => (up.v ? 5000 : 0), listeners: async () => '' };
  return { runner, reachable: async () => up.v, loaded: async () => (up.v ? ['a:1b'] : []), generate: async () => true, chosenModel: async () => ({ tag: 'a:1b', num_ctx: 8192 }), sleep: async () => {}, ...over };
}
const okLoad = { ok: true as const, config: { start: ['/bin/start'], stop: ['/bin/stop'], tuning: {} } };

test('power: start, stop with freed MB, 0600 log, cooldown', async () => {
  resetPowerForTests();
  const d = dir();
  let t = 1_000_000;
  const up = { v: false };
  const on = await flipPower(d, 'start', 'nick', deps({ up, now: () => t }), okLoad);
  assert.equal(on.status, 200);
  assert.equal(on.power, 'on');
  assert.equal((await flipPower(d, 'stop', 'nick', deps({ up, now: () => t + 1000 }), okLoad)).status, 429);
  t += 61_000;
  const off = await flipPower(d, 'stop', 'nick', deps({ up, now: () => t }), okLoad);
  assert.equal(off.power, 'off');
  assert.equal(off.freedMB, 5000);
  assert.equal(statSync(path.join(d, 'okkin-power.log')).mode & 0o777, 0o600);
  rmSync(d, { recursive: true, force: true });
});

test('power: 0.0.0.0 listener after start is stopped and logged; no-rights stop disables', async () => {
  resetPowerForTests();
  const d = dir();
  const up = { v: false };
  const base = deps({ up });
  const exposed = await flipPower(d, 'start', 'n', { ...base, runner: { ...base.runner, listeners: async () => 'LISTEN 0 511 0.0.0.0:11434 0.0.0.0:*' } }, okLoad);
  assert.equal(exposed.status, 502);
  assert.match(readFileSync(path.join(d, 'okkin-power.log'), 'utf8'), /exposed-killed/);
  assert.equal(exposedOnAllInterfaces('LISTEN 0 511 127.0.0.1:11434 0.0.0.0:*'), false);
  resetPowerForTests();
  up.v = true;
  const r = await flipPower(d, 'stop', 'n', { ...base, runner: { ...base.runner, run: async () => ({ ok: false, code: 5, stderr: 'Access is denied.' }) } }, okLoad);
  assert.equal(r.status, 403);
  assert.equal(lacksRights({ code: 1, stderr: 'Permission denied' }), true);
  assert.equal(parseGpuStats('812, 8188, 45, [N/A]')?.fan, 'N/A');
  rmSync(d, { recursive: true, force: true });
});

test('stop script: sha256 pin mismatch refuses; freed lines parsed', async () => {
  const { parseFreed } = await import('../src/server/hq/okkin-power.js');
  resetPowerForTests();
  const d = dir();
  const up = { v: true };
  const base = deps({ up });
  let ran = 0;
  const load = { ok: true as const, config: { start: ['/bin/start'], stop: ['powershell', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', 'C:\\ops\\okkin-off-v2.ps1'], tuning: {}, scriptSha256: '7'.repeat(64), scriptPath: 'C:\\ops\\okkin-off-v2.ps1' } };
  const r = await flipPower(d, 'stop', 'n', { ...base, runner: { ...base.runner, hash: () => '0'.repeat(64), run: async () => (ran++, { ok: true, code: 0, stderr: '' }) } }, load);
  assert.equal(r.status, 503);
  assert.equal(ran, 0);
  const ok = await flipPower(d, 'stop', 'n', { ...base, runner: { ...base.runner, hash: () => '7'.repeat(64), run: async () => ((up.v = false), { ok: true, code: 0, stderr: '', stdout: 'x\r\nVRAM freed MiB: 5120\r\nRAM freed MiB: 812.5\r\n' }) } }, load);
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.script, { vramMiB: 5120, ramMiB: 812.5 });
  assert.deepEqual(parseFreed('nothing'), { vramMiB: null, ramMiB: null });
  rmSync(d, { recursive: true, force: true });
});

test('exposure is an allowlist: only 127.0.0.1 / [::1] on :11434 pass (Windows netstat + ss)', () => {
  const nl = (addr: string) => `  TCP    ${addr}        0.0.0.0:0              LISTENING       4242`;
  assert.equal(exposedOnAllInterfaces(nl('192.168.1.5:11434')), true);
  assert.equal(exposedOnAllInterfaces(nl('[::]:11434')), true);
  assert.equal(exposedOnAllInterfaces(nl('0.0.0.0:11434')), true);
  assert.equal(exposedOnAllInterfaces(nl('127.0.0.1:11434')), false);
  assert.equal(exposedOnAllInterfaces(nl('[::1]:11434')), false);
  assert.equal(exposedOnAllInterfaces(nl('0.0.0.0:445')), false);
  assert.equal(exposedOnAllInterfaces('LISTEN 0 511 10.0.0.2:11434 0.0.0.0:*'), true);
});

test('a PowerShell stop without the exact pinned path is refused at load', () => {
  const fsOf = (obj: unknown) => ({ exists: () => true, stat: () => ({ uid: 1, mode: 0o100600 }), read: () => JSON.stringify(obj) });
  const stop = ['powershell', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', 'C:\\ops\\okkin-off-v2.ps1'];
  assert.equal(loadPowerConfig('/x', { fs: fsOf({ start: ['/bin/s'], stop, scriptSha256: '7'.repeat(64) }), uid: 1, platform: 'linux' }).ok, false);
  assert.equal(loadPowerConfig('/x', { fs: fsOf({ start: ['/bin/s'], stop, scriptSha256: '7'.repeat(64), scriptPath: 'C:\\other\\okkin-off-v2.ps1' }), uid: 1, platform: 'linux' }).ok, false);
  assert.equal(loadPowerConfig('/x', { fs: fsOf({ start: ['/bin/s'], stop, scriptSha256: '7'.repeat(64), scriptPath: stop[5] }), uid: 1, platform: 'linux' }).ok, true);
});
