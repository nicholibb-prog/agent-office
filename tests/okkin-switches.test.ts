// Okkin's loft always has its two controls on the office floor, with no config at all: a power switch
// (honestly 'Not set up' until the real power config passes) and a model switch over all five models.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { OKKIN_CONSOLE, OKKIN_LOFT, OKKIN_LOFT_SPOT, OKKIN_MODELS } from '../src/shared/okkin-loft.js';
import { DESKS, DESK_SIZE, STAIRS } from '../src/shared/layout.js';
import { dialConfig, dialStops, loadLoftConfig } from '../src/server/hq/okkin-loft.js';
import { loadPowerConfig } from '../src/server/hq/okkin-power.js';
import { chosenIndex, stopsView, switchView, type LoftLike } from '../src/client/features/okkin-loft/model.js';

// textPlane draws on a canvas: a stand-in 2D context is enough to build the scene in node.
const ctx2d = new Proxy({}, { get: (_t, k) => (k === 'measureText' ? () => ({ width: 40 }) : () => undefined), set: () => true });
(globalThis as { document?: unknown }).document ??= { createElement: () => ({ getContext: () => ctx2d, width: 0, height: 0 }) };

const empty = () => mkdtempSync(path.join(tmpdir(), 'ao-switches-'));
const TAGS = ['qwen3.5:4b', 'okkin:latest', 'qwen3.5:9b', 'ornith-1.5:9b', 'hf.co/ornith-ai/Ornith-1.5-35B-A3B-GGUF:Q4_K_M'];

test('the five models, in dial order', () => {
  assert.deepEqual(OKKIN_MODELS.map((m) => m.tag), TAGS);
  assert.deepEqual(OKKIN_MODELS.map((m) => m.role), ['quick', 'default', 'chat', 'code', 'big']);
});

test('the office floor plan builds the loft, and the loft has a power switch and a five-stop model dial', async () => {
  assert.match(readFileSync(path.join(import.meta.dirname, '../src/client/world/office/build.ts'), 'utf8'), /^\s+okkinLoft,$/m);
  const { buildOkkinLoft } = await import('../src/client/features/okkin-loft/world.js');
  const view = buildOkkinLoft();
  const sw = view.group.getObjectByName('okkin-power-switch');
  const dial = view.group.getObjectByName('okkin-model-dial');
  assert.ok(sw && sw.visible, 'power switch in the scene');
  assert.ok(dial && dial.visible, 'model dial in the scene');
  for (const role of ['quick', 'default', 'chat', 'code', 'big']) assert.ok(view.group.getObjectByName(`okkin-dial-stop-${role}`), role);
  // No config: it says so on the switch itself.
  assert.equal(view.group.getObjectByName('okkin-power-not-set-up')?.visible, true);
  view.setState({ power: 'off', busy: false, switchWorks: true });
  assert.equal(view.group.getObjectByName('okkin-power-not-set-up')?.visible, false);
});

test('with no config at all, the API dial lists all five, each marked not installed when /api/tags lacks it', () => {
  const dir = empty();
  const stops = dialStops(dialConfig(loadLoftConfig(dir)), ['okkin:latest']);
  assert.deepEqual(stops.map((s) => s.tag), TAGS);
  assert.deepEqual(stops.map((s) => s.installed), [false, true, false, false, false]);
  // The display list doesn't widen the allowlist: the file-only config stays empty.
  assert.equal(loadLoftConfig(dir).models.length, 0);
});

const noConfig: LoftLike = {
  power: 'off',
  powerControl: 'not-set-up',
  powerReason: 'no okkin-power.json',
  okkin: { chip: 'offline', configured: '', model: null },
  dial: TAGS.map((tag, i) => ({ tag, role: OKKIN_MODELS[i]!.role, installed: false, ramOk: true, minFreeRamGB: null })),
};

test('panel: five stops, not installed shown (not hidden), and power says Not set up without config', () => {
  const stops = stopsView(noConfig);
  assert.equal(stops.length, 5);
  assert.ok(stops.every((s) => s.status === 'not installed' && s.note === 'Not installed' && !s.usable));
  assert.equal(stops[chosenIndex(noConfig, stops)]!.role, 'default');
  const sw = switchView(noConfig);
  assert.equal(sw.label, 'Not set up');
  assert.equal(sw.works, false);
  assert.equal(sw.icon, 'setup');
  assert.equal(loadPowerConfig(empty()).ok, false);
});

test('panel: even when the loft API fails, both controls still show (five stops, honest Not set up)', () => {
  assert.equal(stopsView(null).length, 5);
  assert.ok(stopsView(null).every((s) => s.status === 'unknown' && !s.usable));
  const sw = switchView(null, 'The loft API refused (403: host not allowed).');
  assert.equal(sw.works, false);
  assert.equal(sw.label, "Can't reach Okkin");
  assert.match(sw.reason ?? '', /403/);
});

test('switch only works once the real power config passed', () => {
  const ready = { ...noConfig, powerControl: 'ready' as const, power: 'on' as const };
  assert.deepEqual([switchView(ready).works, switchView(ready).label], [true, 'Turn off']);
  assert.equal(switchView({ ...noConfig, powerControl: 'no-rights' }).works, false);
});

test('the console stands clear of the racks, desks, stairs and where you stand', () => {
  const c = { minX: OKKIN_CONSOLE.x - OKKIN_CONSOLE.depth / 2, maxX: OKKIN_CONSOLE.x + OKKIN_CONSOLE.depth / 2, minZ: OKKIN_CONSOLE.z - OKKIN_CONSOLE.width / 2, maxZ: OKKIN_CONSOLE.z + OKKIN_CONSOLE.width / 2 };
  const ov = (a: typeof c, b: typeof c) => a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ;
  assert.ok(c.maxX <= OKKIN_LOFT.minX - 0.2, 'gap to the dais');
  assert.equal(ov(c, { minX: STAIRS.fromX - 1.6, maxX: STAIRS.toX, minZ: STAIRS.minZ - 1, maxZ: STAIRS.maxZ }), false);
  for (const d of DESKS) assert.equal(ov(c, { minX: d.x - DESK_SIZE.width / 2 - 0.2, maxX: d.x + DESK_SIZE.width / 2 + 0.2, minZ: d.z - DESK_SIZE.depth / 2 - 1, maxZ: d.z + DESK_SIZE.depth / 2 + 1 }), false);
  assert.ok(OKKIN_CONSOLE.x - OKKIN_CONSOLE.depth / 2 - OKKIN_LOFT_SPOT.x >= 1.5, 'room to stand in front of it');
});
