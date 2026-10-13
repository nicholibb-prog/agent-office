// Seated desks: hung signs clear heads and fit their text, name tags sit just over a seated worker,
// and the workers list only shows a status pill the office really knows.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SIGN, fit } from '../src/client/world/desksigns.js';
import { NAME_TAG_Y } from '../src/client/world/character/worker-badges.js';
import { WALL_HEIGHT } from '../src/shared/layout.js';
import { workerPill } from '../src/client/ui/workers-panel.js';

/** A pretend canvas: every glyph is 0.6 of the font size wide. */
function pen() {
  let size = 10;
  return {
    set font(f: string) { size = Number(/(\d+)px/.exec(f)![1]); },
    get font() { return `${size}px`; },
    measureText: (t: string) => ({ width: t.length * size * 0.6 }) as TextMetrics,
    size: () => size,
  };
}

test('a desk sign hangs above standing heads and below the ceiling', () => {
  assert.ok(SIGN.y - SIGN.height / 2 >= 2, `bottom at ${SIGN.y - SIGN.height / 2}`);
  assert.ok(SIGN.y + SIGN.height / 2 < WALL_HEIGHT - 0.2);
});

test('sign text always fits the face: short, two-line, and one long word', () => {
  const maxW = 904;
  const maxH = 264;
  for (const text of ['ScoutL', 'Side Lanes', 'Operations and infrastructure', 'Supercalifragilisticexpialidocious-and-then-some']) {
    const p = pen();
    const { lines, size } = fit(p as unknown as CanvasRenderingContext2D, text, maxW, maxH);
    for (const l of lines) assert.ok(l.length * size * 0.6 <= maxW, `${text}: "${l}" too wide at ${size}`);
    assert.ok(lines.length * size * 1.02 <= maxH, `${text}: too tall`);
  }
});

test('name tags sit just over a seated worker, a little higher on the move', () => {
  assert.ok(NAME_TAG_Y.seated >= 1.35 && NAME_TAG_Y.seated <= 1.45);
  assert.ok(NAME_TAG_Y.standing > NAME_TAG_Y.seated);
});

test('the status pill shows only a known status, never a made-up default', () => {
  assert.equal(workerPill('idle', false, false)?.text, 'ready');
  assert.equal(workerPill('working', false, false)?.text, 'working');
  assert.equal(workerPill('mystery', false, false), null);
  assert.equal(workerPill('', false, false), null);
  assert.equal(workerPill('constructor', false, false), null);
  assert.equal(workerPill('idle', true, false)?.text, 'NEEDS YOU');
  assert.equal(workerPill('idle', false, true)?.text, 'worktree deleted');
});
