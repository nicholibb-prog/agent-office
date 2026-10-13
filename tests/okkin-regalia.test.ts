// The loft's dressing: the Paleo-Hebrew inscription (mapping and spelling), the bundled fonts and
// their licences, and the pedestal, scroll and console placed clear of the stairs, aisles and desks.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { PHOENICIAN_WORD_SEPARATOR, VICTORY_OF_THE_PEOPLE, toPaleoHebrew } from '../src/shared/paleo-hebrew.js';
import { OKKIN_CONSOLE, OKKIN_LOFT_SPOT, OKKIN_PEDESTAL, OKKIN_SCROLL, OKKIN_SIGN } from '../src/shared/okkin-loft.js';
import { DESKS, DESK_SIZE, FLOOR, STAIRS, WALL_HEIGHT } from '../src/shared/layout.js';

const cp = (s: string) => [...s].map((c) => c.codePointAt(0)!.toString(16).toUpperCase());

test('Paleo-Hebrew: every letter maps to its Phoenician-block code point, final forms to the base letter', () => {
  const pairs: [string, number][] = [['א', 0x10900], ['ב', 0x10901], ['ה', 0x10904], ['ו', 0x10905], ['ח', 0x10907], ['י', 0x10909], ['כ', 0x1090a], ['מ', 0x1090c], ['נ', 0x1090d], ['ע', 0x1090f], ['פ', 0x10910], ['צ', 0x10911], ['ת', 0x10915]];
  for (const [h, c] of pairs) assert.equal(toPaleoHebrew(h).codePointAt(0), c, h);
  for (const [f, b] of [['ך', 'כ'], ['ם', 'מ'], ['ן', 'נ'], ['ף', 'פ'], ['ץ', 'צ']]) assert.equal(toPaleoHebrew(f!), toPaleoHebrew(b!), f);
  assert.throws(() => toPaleoHebrew('A'));
});

test('the inscription: נצחון העם (no yod, per the owner checklist), in logical right-to-left order, word separator between', () => {
  assert.equal(VICTORY_OF_THE_PEOPLE.hebrew, 'נצחון העם');
  assert.ok(!VICTORY_OF_THE_PEOPLE.hebrew.includes('י'), 'no yod');
  const s = toPaleoHebrew(VICTORY_OF_THE_PEOPLE.hebrew);
  // nun tsade het vav nun · he ayin mem (logical order; drawn right to left)
  assert.deepEqual(cp(s), ['1090D', '10911', '10907', '10905', '1090D', '1091F', '10904', '1090F', '1090C']);
  assert.ok(s.includes(PHOENICIAN_WORD_SEPARATOR));
});

test('fonts are local subsets, each with its OFL licence; no CDN', () => {
  const dir = path.join(import.meta.dirname, '../src/client/features/okkin-loft/fonts');
  for (const [font, lic] of [['cinzel-okkin.ttf', 'OFL-Cinzel.txt'], ['yuji-syuku-nikko.ttf', 'OFL-YujiSyuku.txt'], ['noto-sans-phoenician.ttf', 'OFL-NotoSansPhoenician.txt']]) {
    assert.ok(statSync(path.join(dir, font!)).size < 20_000, `${font} is a small subset`);
    assert.match(readFileSync(path.join(dir, lic!), 'utf8'), /SIL Open Font License, Version 1\.1/);
  }
  const src = readFileSync(path.join(import.meta.dirname, '../src/client/features/okkin-loft/regalia.ts'), 'utf8');
  assert.doesNotMatch(src, /https?:\/\/(fonts\.|cdn|unpkg|jsdelivr)/);
  assert.ok(existsSync(path.join(import.meta.dirname, '../docs/okkin-loft-regalia.md')));
});

type Box = { minX: number; maxX: number; minZ: number; maxZ: number };
const ov = (a: Box, b: Box) => a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ;
const pedestal: Box = OKKIN_PEDESTAL;
const scroll: Box = { minX: OKKIN_SCROLL.x - 0.25, maxX: OKKIN_SCROLL.x + 0.25, minZ: OKKIN_SCROLL.z - OKKIN_SCROLL.width / 2, maxZ: OKKIN_SCROLL.z + OKKIN_SCROLL.width / 2 };
const desks: Box[] = DESKS.map((d) => ({ minX: d.x - DESK_SIZE.width / 2 - 0.2, maxX: d.x + DESK_SIZE.width / 2 + 0.2, minZ: d.z - DESK_SIZE.depth / 2 - 1, maxZ: d.z + DESK_SIZE.depth / 2 + 1 }));
const stairsFoot: Box = { minX: STAIRS.fromX - 1.6, maxX: STAIRS.toX, minZ: STAIRS.minZ - 1, maxZ: STAIRS.maxZ };

test('pedestal is 1.0–1.2 m (chest-high to a bot, taller than the 0.78 m desks, under a 1.4 m eye line); inside the room, clear of the stairs (1 m strip) and every desk zone', () => {
  const FT = 0.3048;
  assert.ok(OKKIN_PEDESTAL.height >= 1.0 && OKKIN_PEDESTAL.height <= 1.2, `${OKKIN_PEDESTAL.height} m (${(OKKIN_PEDESTAL.height / FT).toFixed(2)} ft)`);
  assert.ok(OKKIN_PEDESTAL.height > DESK_SIZE.height + 0.2, 'clearly taller than a desk');
  assert.ok(OKKIN_PEDESTAL.height < 1.4, 'below eye level');
  assert.ok(pedestal.minX >= FLOOR.minX && pedestal.maxX <= FLOOR.maxX && pedestal.minZ >= FLOOR.minZ && pedestal.maxZ <= FLOOR.maxZ);
  for (const b of [pedestal, scroll]) {
    assert.equal(ov(b, stairsFoot), false);
    for (const d of desks) assert.equal(ov(b, d), false);
  }
  assert.equal(ov(pedestal, scroll), false);
});

test('console stays reachable: in front of the pedestal with a gap, and a clear walk to it from where you stand', () => {
  const c: Box = { minX: OKKIN_CONSOLE.x - OKKIN_CONSOLE.depth / 2, maxX: OKKIN_CONSOLE.x + OKKIN_CONSOLE.depth / 2, minZ: OKKIN_CONSOLE.z - OKKIN_CONSOLE.width / 2, maxZ: OKKIN_CONSOLE.z + OKKIN_CONSOLE.width / 2 };
  assert.ok(pedestal.minX - c.maxX >= 0.15, 'gap between console and pedestal');
  const walk: Box = { minX: OKKIN_LOFT_SPOT.x, maxX: c.minX - 0.01, minZ: OKKIN_CONSOLE.z - 0.4, maxZ: OKKIN_CONSOLE.z + 0.4 };
  for (const b of [pedestal, scroll, ...desks]) assert.equal(ov(walk, b), false);
});

test('the sign hangs under the ceiling', () => {
  assert.ok(OKKIN_SIGN.y + OKKIN_SIGN.height / 2 < WALL_HEIGHT - 0.3);
});

test('the plinth is stepped like a temple base: two steps and a die, with fluted pilasters and gold banding', async () => {
  const ctx2d = new Proxy({}, { get: (_t, k) => (k === 'measureText' ? () => ({ width: 40 }) : () => ({ addColorStop() {} })), set: () => true });
  (globalThis as { document?: unknown }).document ??= { createElement: () => ({ getContext: () => ctx2d, width: 0, height: 0 }) };
  const { buildPedestal, PEDESTAL_STEPS, PEDESTAL_DIE } = await import('../src/client/features/okkin-loft/regalia.js');
  const { group } = buildPedestal();
  const named = (re: RegExp) => { let n = 0; group.traverse((o) => { if (re.test(o.name)) n++; }); return n; };
  assert.equal(named(/^okkin-pedestal-step-/), 2);
  assert.equal(named(/^okkin-pedestal-die$/), 1);
  assert.ok(named(/^okkin-pilaster$/) >= 3 && named(/^okkin-flute$/) >= 9);
  assert.ok(named(/^okkin-pedestal-gold$/) >= 4);
  assert.ok(PEDESTAL_STEPS[1].inset > PEDESTAL_STEPS[0].inset && PEDESTAL_DIE.inset > PEDESTAL_STEPS[1].inset, 'each tier sets back');
  const rise = PEDESTAL_STEPS.reduce((a, s) => a + s.rise, 0);
  assert.ok(OKKIN_PEDESTAL.height - rise >= 0.25, 'the die is tall enough to carry the engraving');
});
