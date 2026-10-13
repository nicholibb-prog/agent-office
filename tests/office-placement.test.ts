// Freestanding boards and Kavi's robot never stand in a desk, its chairs or the walkway round it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { BALCONY_DOOR, DESKS, DESK_SIZE, FLOOR, EXIT_DOOR, STAIRS, WINDOWS } from '../src/shared/layout.js';
import { KAVI_BOARD, KAVI_HOME, KAVI_PATROL } from '../src/shared/kavi-office.js';
import { JEV_BOARD } from '../src/shared/jev.js';

type Box = { minX: number; maxX: number; minZ: number; maxZ: number };
const overlaps = (a: Box, b: Box) => a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ;
/** A desk plus its chair and the walkway behind the chair (1 m out on both long sides). */
const deskZones: Box[] = DESKS.map((d) => ({
  minX: d.x - DESK_SIZE.width / 2 - 0.2,
  maxX: d.x + DESK_SIZE.width / 2 + 0.2,
  minZ: d.z - DESK_SIZE.depth / 2 - 1,
  maxZ: d.z + DESK_SIZE.depth / 2 + 1,
}));
function footprint(b: { x: number; z: number; rotY: number; width: number }): Box {
  const across = Math.abs(Math.cos(b.rotY)) > 0.5;
  const hw = b.width / 2 + 0.1;
  return across ? { minX: b.x - hw, maxX: b.x + hw, minZ: b.z - 0.2, maxZ: b.z + 0.2 } : { minX: b.x - 0.2, maxX: b.x + 0.2, minZ: b.z - hw, maxZ: b.z + hw };
}
const boards = { jev: footprint(JEV_BOARD), kavi: footprint(KAVI_BOARD) };

test('no freestanding board overlaps a desk, its chairs or walkway, and each stays inside the room', () => {
  for (const [name, f] of Object.entries(boards)) {
    for (const z of deskZones) assert.equal(overlaps(f, z), false, `${name} board overlaps a desk zone`);
    assert.ok(f.minX >= FLOOR.minX && f.maxX <= FLOOR.maxX && f.minZ >= FLOOR.minZ && f.maxZ <= FLOOR.maxZ, `${name} board inside the room`);
  }
  assert.equal(overlaps(boards.jev, boards.kavi), false);
});

test('the Bridge board on the west wall leaves the exit door clear', () => {
  const door = { minZ: EXIT_DOOR.u - EXIT_DOOR.width / 2, maxZ: EXIT_DOOR.u + EXIT_DOOR.width / 2 };
  assert.ok(boards.kavi.maxZ < door.minZ || boards.kavi.minZ > door.maxZ);
});

test("Kavi's robot rests, and walks, clear of every desk zone and both boards", () => {
  const home: Box = { minX: KAVI_HOME.x - 0.5, maxX: KAVI_HOME.x + 0.5, minZ: KAVI_HOME.z - 0.35, maxZ: KAVI_HOME.z + 0.35 };
  for (const z of [...deskZones, ...Object.values(boards)]) assert.equal(overlaps(home, z), false);
  for (let i = 0; i < KAVI_PATROL.length; i++) {
    const a = KAVI_PATROL[i]!;
    const b = KAVI_PATROL[(i + 1) % KAVI_PATROL.length]!;
    for (let t = 0; t <= 1; t += 0.02) {
      const x = a.x + (b.x - a.x) * t;
      const z = a.z + (b.z - a.z) * t;
      const me: Box = { minX: x - 0.4, maxX: x + 0.4, minZ: z - 0.4, maxZ: z + 0.4 };
      for (const zone of [...deskZones, ...Object.values(boards)]) assert.equal(overlaps(me, zone), false, `patrol leg ${i} at (${x.toFixed(1)}, ${z.toFixed(1)})`);
    }
  }
});

test('the Jev board on the south wall clears the balcony door, the windows and the loft stairs', () => {
  const j = boards.jev;
  const clear = (a: number, b: number) => j.maxX <= a || j.minX >= b;
  assert.ok(clear(BALCONY_DOOR.u - BALCONY_DOOR.width / 2, BALCONY_DOOR.u + BALCONY_DOOR.width / 2), 'balcony door');
  for (const w of WINDOWS.filter((w) => w.wall === 'south' && w.y0 < 3)) assert.ok(clear(w.u - w.width / 2, w.u + w.width / 2), `window at ${w.u}`);
  assert.ok(clear(STAIRS.fromX, STAIRS.toX), 'stairs');
});
