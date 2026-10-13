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

import { OKKIN_LOFT, OKKIN_LOFT_SPOT } from '../src/shared/okkin-loft.js';
import { ELEVATOR, ELEVATOR_FRONT, GONG, JUKEBOX, TV, WING, WHITEBOARD, LOFT } from '../src/shared/layout.js';

test("Okkin's loft stays clear of desks, boards, stairs, elevator, TV, jukebox, gong and the back-office bay", () => {
  const loft: Box = { minX: OKKIN_LOFT.minX, maxX: OKKIN_LOFT.maxX, minZ: OKKIN_LOFT.minZ, maxZ: OKKIN_LOFT.maxZ };
  const spot: Box = { minX: OKKIN_LOFT_SPOT.x - 0.4, maxX: OKKIN_LOFT_SPOT.x + 0.4, minZ: OKKIN_LOFT_SPOT.z - 0.4, maxZ: OKKIN_LOFT_SPOT.z + 0.4 };
  const others: Record<string, Box> = {
    ...Object.fromEntries(deskZones.map((z, i) => [`desk${i}`, z])),
    ...boards,
    stairs: { minX: STAIRS.fromX, maxX: STAIRS.toX, minZ: STAIRS.minZ, maxZ: STAIRS.maxZ },
    loftUp: { minX: LOFT.minX, maxX: LOFT.maxX, minZ: LOFT.minZ, maxZ: LOFT.maxZ },
    elevator: { minX: ELEVATOR.x - ELEVATOR.width / 2 - 0.5, maxX: ELEVATOR.x + ELEVATOR.width / 2 + 0.5, minZ: FLOOR.minZ, maxZ: ELEVATOR_FRONT + 1 },
    tv: { minX: TV.x - 0.6, maxX: FLOOR.maxX, minZ: TV.z - TV.width / 2, maxZ: TV.z + TV.width / 2 },
    jukebox: { minX: JUKEBOX.x - 1, maxX: FLOOR.maxX, minZ: JUKEBOX.z - 1, maxZ: JUKEBOX.z + 1 },
    gong: { minX: GONG.x - GONG.width / 2, maxX: GONG.x + GONG.width / 2, minZ: FLOOR.minZ, maxZ: GONG.z + 0.6 },
    wingMouth: { minX: WING.minX, maxX: WING.maxX, minZ: FLOOR.minZ, maxZ: FLOOR.minZ + 1.5 },
    whiteboard: { minX: WHITEBOARD.x - WHITEBOARD.width / 2, maxX: WHITEBOARD.x + WHITEBOARD.width / 2, minZ: WHITEBOARD.z - 0.3, maxZ: WHITEBOARD.z + 0.3 },
  };
  for (const [name, b] of Object.entries(others)) {
    assert.equal(overlaps(loft, b), false, `loft overlaps ${name}`);
    assert.equal(overlaps(spot, b), false, `panel spot overlaps ${name}`);
  }
  assert.ok(loft.maxX <= FLOOR.maxX && loft.minZ >= FLOOR.minZ + 1.5, 'inside the room, clear of the bay');
  assert.equal(overlaps(spot, loft), false, 'the panel spot is open floor');
});
