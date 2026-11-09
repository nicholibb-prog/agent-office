// Loft v4: the plinth at 1.0–1.2 m with everything still fitting under the ceiling, the console on a
// step at standing height, the CRT fed only by real loft data, the hologram real vs MOCK vs '—', and
// the Ask box's off hint shown once.
import test from 'node:test';
import assert from 'node:assert/strict';
import { WALL_HEIGHT as CEILING_HEIGHT, DESK_SIZE } from '../src/shared/layout.js';
import { OKKIN_CONSOLE, OKKIN_CONSOLE_STEP, OKKIN_CRT, OKKIN_PEDESTAL, OKKIN_SIGN } from '../src/shared/okkin-loft.js';
import { CRT_IDLE, CRT_ROWS, askView, crtView, holoData, POWER_ON_FIRST, OWNER_ONLY, type LoftLike } from '../src/client/features/okkin-loft/model.js';
import { hologramLines } from '../src/client/features/okkin-loft/hero-light.js';
import { TOWER } from '../src/client/features/okkin-loft/hero.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { latestOkkinOutput, resetOkkinForTests, talkToOkkin } from '../src/server/hq/okkin.js';
import type { OllamaFetch } from '../src/server/ollama.js';

const base = (o: Partial<LoftLike> & Record<string, unknown> = {}) => ({ power: 'on', powerControl: 'ready', powerReason: null, okkin: { chip: 'ready', configured: 'okkin:latest', model: 'okkin:latest' }, dial: [], ...o }) as LoftLike & Record<string, unknown>;

test('heights: plinth 1.0–1.2 m; tower, hologram and sign fit under the ceiling; console top at standing height on its step', () => {
  assert.ok(OKKIN_PEDESTAL.height >= 1.0 && OKKIN_PEDESTAL.height <= 1.2);
  assert.ok(OKKIN_PEDESTAL.height > DESK_SIZE.height);
  const towerTop = OKKIN_PEDESTAL.height + TOWER.height;
  const holoTop = towerTop + 0.9;
  const signBottom = OKKIN_SIGN.y - OKKIN_SIGN.height / 2;
  assert.ok(holoTop < signBottom, `hologram ${holoTop} under the sign ${signBottom}`);
  assert.ok(OKKIN_SIGN.y + OKKIN_SIGN.height / 2 + 0.3 < CEILING_HEIGHT, 'sign under the ceiling');
  const consoleTop = OKKIN_CONSOLE.step + OKKIN_CONSOLE.height;
  assert.ok(consoleTop >= 0.95 && consoleTop <= 1.15, `console top ${consoleTop} m`);
  assert.ok(OKKIN_CONSOLE.step > 0 && OKKIN_CONSOLE.step <= 0.25, 'a low step');
  assert.ok(OKKIN_CONSOLE_STEP.maxX <= OKKIN_PEDESTAL.minX + 1e-9 && OKKIN_CONSOLE_STEP.minX < OKKIN_CONSOLE.x - OKKIN_CONSOLE.depth / 2, 'the step runs from in front of the console to the plinth');
  assert.ok(OKKIN_CRT.z - 0.25 > OKKIN_CONSOLE.z + OKKIN_CONSOLE.width / 2 && OKKIN_CRT.z + 0.25 < OKKIN_CONSOLE_STEP.maxZ, 'the CRT sits beside the console, on the step');
});

test('CRT: dark when off, an honest idle line with no output, else the tail of the real reply; MOCK only for mock data', () => {
  assert.deepEqual(crtView(null), { mode: 'off', lines: [], mock: false });
  assert.equal(crtView(base({ power: 'off', crt: { text: 'hello', at: 1, model: 'x' } })).mode, 'off', 'off is dark even with old output');
  assert.deepEqual(crtView(base({ crt: null })), { mode: 'idle', lines: [CRT_IDLE], mock: false });
  const long = Array.from({ length: 60 }, (_, i) => `word${i}`).join(' ');
  const v = crtView(base({ crt: { text: long, at: 1, model: 'okkin:latest' } }));
  assert.equal(v.mode, 'live');
  assert.equal(v.lines[0], '> okkin:latest');
  assert.ok(v.lines.length <= CRT_ROWS);
  assert.ok(v.lines.at(-1)!.endsWith('word59'), 'shows the latest text');
  assert.equal(crtView(base({ mock: true, crt: { text: 'hi', at: 1, model: null } })).mock, true);
});

test('CRT source: the latest real Okkin reply from the Ask thread (with its model), nothing when there is none', async () => {
  resetOkkinForTests();
  assert.equal(latestOkkinOutput(), null);
  assert.equal(crtView(base({ crt: latestOkkinOutput() })).mode, 'idle');
  const fetchImpl: OllamaFetch = async (url) => {
    if (url.endsWith('/api/chat')) return { ok: true, status: 200, text: async () => JSON.stringify({ message: { content: 'The answer is forty-two.' }, eval_count: 80, eval_duration: 2e9 }) };
    if (url.endsWith('/api/tags') || url.endsWith('/api/ps')) return { ok: true, status: 200, text: async () => JSON.stringify({ models: [{ name: 'demo:1b' }] }) };
    return { ok: false, status: 404, text: async () => '' };
  };
  const env = { OLLAMA_URL: 'http://127.0.0.1:11434', OKKIN_MODEL: 'demo:1b', OKKIN_MODEL_ALLOW: 'demo:1b' };
  const hq = { crewKeysLower: [], humanAliases: [], humanMapsTo: '', crewDesks: false, seats: {} };
  const r = await talkToOkkin(mkdtempSync(path.join(tmpdir(), 'ao-crt-')), env, hq as never, 'what is it?', fetchImpl);
  assert.equal(r.status, 200);
  const out = latestOkkinOutput();
  assert.equal(out?.text, 'The answer is forty-two.', 'the reply, not the question');
  assert.equal(out?.model, 'demo:1b');
  const v = crtView(base({ crt: out }));
  assert.equal(v.mode, 'live');
  assert.ok(v.lines.join(' ').includes('forty-two'));
  resetOkkinForTests();
});

test('hologram: real tok/s and loaded model while on; MOCK only for mock; — when none or off', () => {
  const on = base({ speed: { tokensPerSec: 38.5 }, loaded: [{ name: 'okkin:latest' }] });
  assert.deepEqual(holoData(on), { tps: 38.5, model: 'okkin:latest', mock: false });
  const real = hologramLines(holoData(on));
  assert.match(real.top, /38\.5|39/);
  assert.equal(real.mock, false);
  assert.equal(hologramLines(holoData({ ...on, mock: true })).mock, true);
  const off = hologramLines(holoData({ ...on, power: 'off' }));
  assert.equal(off.top, '—');
  assert.equal(hologramLines(holoData(base({ speed: null, loaded: [] }))).top, '—');
  assert.equal(hologramLines(null).top, '—');
});

test('Ask: the off hint appears once (below the box), never also as the placeholder', () => {
  const off = askView(false, true);
  assert.equal(off.hint, POWER_ON_FIRST);
  assert.notEqual(off.placeholder, off.hint);
  assert.equal(askView(true, false).hint, OWNER_ONLY);
  assert.equal(askView(true, true).hint, null);
});
