// Kavi's patrol stays on the walkable floor. A straight line through a desk is not a step she takes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DESKS, DESK_SIZE, type DeskDef } from '../src/shared/layout.js';
import { officeNav, walkable, type Pt } from '../src/shared/nav.js';
import { KAVI_PATROL, advancePatrol } from '../src/client/features/kavi/karen.js';

const nav = officeNav();

function insideDesk(p: Pt, d: DeskDef): boolean {
  const hw = DESK_SIZE.width / 2;
  const hd = DESK_SIZE.depth / 2;
  return p[0] >= d.x - hw && p[0] <= d.x + hw && p[1] >= d.z - hd && p[1] <= d.z + hd;
}

test('the aisle corners are walkable, and a lap along them never enters furniture', () => {
  for (const p of KAVI_PATROL) assert.equal(walkable(p[0], p[1]), true, `${p}`);
  let at = KAVI_PATROL[0];
  let cursor = { corners: KAVI_PATROL, next: 1 };
  let prev = at;
  for (let i = 0; i < 400; i++) {
    const step = advancePatrol(at, cursor, 0.35, nav);
    assert.equal(nav.walkable(step.at[0], step.at[1]), true, `${step.at}`);
    assert.equal(nav.clearLine(prev, step.at), true, `${prev} -> ${step.at}`);
    for (const d of DESKS) assert.equal(insideDesk(step.at, d), false);
    prev = step.at;
    at = step.at;
    cursor = step.cursor;
  }
});

test('a step that would cut through a desk goes round it', () => {
  // Desks in a pod sit against each other, so the open floor is in front and behind, not to the side.
  const crossing = DESKS.flatMap((d) =>
    [2.6, 3].map((dz) => ({ d, from: [d.x, d.z - dz] as Pt, to: [d.x, d.z + dz] as Pt })),
  ).find((c) => walkable(c.from[0], c.from[1]) && walkable(c.to[0], c.to[1]) && !nav.clearLine(c.from, c.to));
  assert.ok(crossing, 'expected a desk with walkable floor on both sides and furniture in between');
  const { d, from, to } = crossing;
  let at = from;
  let cursor = { corners: [to, from] as const, next: 0 };
  let prev = at;
  let reached = false;
  for (let i = 0; i < 80 && !reached; i++) {
    const step = advancePatrol(at, cursor, 0.3, nav);
    assert.equal(nav.walkable(step.at[0], step.at[1]), true);
    assert.equal(nav.clearLine(prev, step.at), true);
    assert.equal(insideDesk(step.at, d), false);
    reached = Math.hypot(step.at[0] - to[0], step.at[1] - to[1]) < 0.4;
    prev = step.at;
    at = step.at;
    cursor = step.cursor;
  }
  assert.equal(reached, true);
});
