// Freestanding boards and Kavi's robot never stand in a desk, its chairs or the walkway round it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { BALCONY_DOOR, DESKS, DESK_SIZE, FLOOR, EXIT_DOOR, STAIRS, WINDOWS } from '../src/shared/layout.js';
import { KAVI_BOARD, KAVI_DESK, KAVI_DESK_BOX, KAVI_HOME, KAVI_PATROL } from '../src/shared/kavi-office.js';
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
import { POOL_BOARD, POOL_POSTER } from '../src/shared/pool-place.js';
import { BOARDS, CABINET, ELEVATOR, ELEVATOR_FRONT, GONG, JUKEBOX, MACHINE_MONITOR, MEETING_ROOM, PLANTS, POLES, SEATING, TV, WING, WHITEBOARD, LOFT, BOOKSHELF } from '../src/shared/layout.js';

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
    meeting: { minX: MEETING_ROOM.minX - 0.6, maxX: MEETING_ROOM.maxX, minZ: MEETING_ROOM.minZ - 0.6, maxZ: MEETING_ROOM.maxZ },
    machineMonitor: { minX: FLOOR.minX, maxX: FLOOR.minX + 1, minZ: MACHINE_MONITOR.z - MACHINE_MONITOR.width / 2, maxZ: MACHINE_MONITOR.z + MACHINE_MONITOR.width / 2 },
    cabinet: { minX: CABINET.x - 1, maxX: FLOOR.maxX, minZ: CABINET.z - 1, maxZ: CABINET.z + 1 },
    bookshelf: { minX: BOOKSHELF.x - 1, maxX: BOOKSHELF.x + 1, minZ: BOOKSHELF.z - 1, maxZ: FLOOR.maxZ },
    ...Object.fromEntries(Object.entries(BOARDS).map(([k, b]) => {
      // A wall board plus 1.5 m of floor in front of it, so nothing stands between it and the room.
      const across = Math.abs(Math.cos(b.rotY)) > 0.5;
      const hw = b.width / 2;
      return [`board-${k}`, across ? { minX: b.x - hw, maxX: b.x + hw, minZ: Math.min(b.z, b.z + 1.5 * Math.cos(b.rotY)), maxZ: Math.max(b.z, b.z + 1.5 * Math.cos(b.rotY)) } : { minX: Math.min(b.x, b.x + 1.5 * Math.sin(b.rotY)), maxX: Math.max(b.x, b.x + 1.5 * Math.sin(b.rotY)), minZ: b.z - hw, maxZ: b.z + hw }];
    })),
    ...Object.fromEntries(PLANTS.map(([x, z], i) => [`plant${i}`, { minX: x - 0.6, maxX: x + 0.6, minZ: z - 0.6, maxZ: z + 0.6 }])),
    ...Object.fromEntries(POLES.map((p, i) => [`pole${i}`, { minX: p.x - 1.2, maxX: p.x + 1.2, minZ: p.z - 1.2, maxZ: p.z + 1.2 }])),
    ...Object.fromEntries(SEATING.filter((s) => s.y === 0 && !s.id.startsWith('roof-')).map((s) => [`seat-${s.id}`, { minX: s.x - 2, maxX: s.x + 2, minZ: s.z - 2, maxZ: s.z + 2 }])),
    poolBoard: { minX: POOL_BOARD.x - POOL_BOARD.width/2 - 0.2, maxX: POOL_BOARD.x + POOL_BOARD.width/2 + 0.2, minZ: POOL_BOARD.z - 0.6, maxZ: POOL_BOARD.z + 0.6 },
    poolPoster: { minX: POOL_POSTER.x - 0.5, maxX: POOL_POSTER.x + 0.5, minZ: POOL_POSTER.z - 0.5, maxZ: POOL_POSTER.z + 0.5 },
    whiteboard: { minX: WHITEBOARD.x - WHITEBOARD.width / 2, maxX: WHITEBOARD.x + WHITEBOARD.width / 2, minZ: WHITEBOARD.z - 0.3, maxZ: WHITEBOARD.z + 0.3 },
  };
  for (const [name, b] of Object.entries(others)) {
    assert.equal(overlaps(loft, b), false, `loft overlaps ${name}`);
    assert.equal(overlaps(spot, b), false, `panel spot overlaps ${name}`);
  }
  assert.ok(loft.maxX <= FLOOR.maxX - 2 && loft.minX >= FLOOR.minX + 2 && loft.minZ >= FLOOR.minZ + 2 && loft.maxZ <= FLOOR.maxZ - 2, 'freestanding: backs onto no wall, so it covers no wall board or sign');
  assert.equal(overlaps(spot, loft), false, 'the panel spot is open floor');
});

test("Okkin's racks leave the foot of the loft stairs and its approach clear", () => {
  const loft: Box = { minX: OKKIN_LOFT.minX, maxX: OKKIN_LOFT.maxX, minZ: OKKIN_LOFT.minZ, maxZ: OKKIN_LOFT.maxZ };
  // Where you step on (walkto's STAIRS_FOOT is 0.6 m west of the first step), with 1 m of room around it.
  const foot: Box = { minX: STAIRS.fromX - 1.6, maxX: STAIRS.fromX + 0.6, minZ: STAIRS.minZ - 1, maxZ: STAIRS.maxZ };
  assert.equal(overlaps(loft, foot), false, 'racks block the foot of the stairs');
  // The whole flight keeps a walkable 1 m strip along its north side.
  assert.ok(loft.maxZ <= STAIRS.minZ - 1, 'racks within 1 m of the stairs');
});

test("Kavi's desk sits by her board on the west wall, inside the room, clear of desks, board, door and stairs", () => {
  const d = KAVI_DESK_BOX;
  assert.ok(d.minX >= FLOOR.minX && d.maxX <= FLOOR.maxX && d.minZ >= FLOOR.minZ && d.maxZ <= FLOOR.maxZ, 'inside the room');
  assert.ok(d.minX - FLOOR.minX < 0.2, 'back against the west wall');
  for (const z of deskZones) assert.equal(overlaps(d, z), false, 'clear of every desk pod, chair and walkway');
  assert.equal(overlaps(d, boards.kavi), false, 'clear of the Bridge board');
  assert.equal(overlaps(d, boards.jev), false);
  assert.ok(Math.abs(KAVI_DESK.z - KAVI_BOARD.z) < 3, 'next to her board');
  const door = { minZ: EXIT_DOOR.u - EXIT_DOOR.width / 2 - 0.6, maxZ: EXIT_DOOR.u + EXIT_DOOR.width / 2 + 0.6 };
  assert.ok(d.maxZ < door.minZ || d.minZ > door.maxZ, 'exit door and its approach clear');
  const stairs = { minX: Math.min(STAIRS.fromX, STAIRS.toX), maxX: Math.max(STAIRS.fromX, STAIRS.toX), minZ: STAIRS.minZ, maxZ: STAIRS.maxZ };
  assert.equal(overlaps(d, stairs), false, 'stairs clear');
  assert.equal(Math.abs(Math.sin(KAVI_DESK.rotY)), 1, 'screen faces into the room');
});

test("Kavi's robot rests and walks clear of her desk, with an aisle in front of it", () => {
  const d = KAVI_DESK_BOX;
  const home: Box = { minX: KAVI_HOME.x - 0.5, maxX: KAVI_HOME.x + 0.5, minZ: KAVI_HOME.z - 0.35, maxZ: KAVI_HOME.z + 0.35 };
  assert.equal(overlaps(home, d), false);
  for (let i = 0; i < KAVI_PATROL.length; i++) {
    const a = KAVI_PATROL[i]!;
    const b = KAVI_PATROL[(i + 1) % KAVI_PATROL.length]!;
    for (let t = 0; t <= 1; t += 0.02) {
      const x = a.x + (b.x - a.x) * t;
      const z = a.z + (b.z - a.z) * t;
      assert.equal(overlaps({ minX: x - 0.4, maxX: x + 0.4, minZ: z - 0.4, maxZ: z + 0.4 }, d), false, `patrol leg ${i}`);
    }
  }
  // A 1 m walkway in front of the desk stays free of desk pods.
  const aisle: Box = { minX: d.maxX, maxX: d.maxX + 1, minZ: d.minZ, maxZ: d.maxZ };
  for (const z of deskZones) assert.equal(overlaps(aisle, z), false, 'aisle in front of her desk');
});

test("Kavi's desk is a solid office fixture and her computer is the click target", async () => {
  const { readFileSync } = await import('node:fs');
  const desk = readFileSync('src/client/features/kavi-board/desk.ts', 'utf8');
  assert.match(desk, /colliders: Collider\[\] = \[\{ \.\.\.KAVI_DESK_BOX \}\]/);
  assert.match(readFileSync('src/client/world/office/build.ts', 'utf8'), /^\s+kaviDesk,$/m);
  assert.match(readFileSync('src/client/features/kavi-board/index.ts', 'utf8'), /intersectObject\(ctx\.office\.kaviDesk\.computer/);
});

test("Kavi's desk clears the Okkin loft island and racks, the stairs, and every seat and free-seat peg", async () => {
  const { OKKIN_LOFT, OKKIN_LOFT_SPOT } = await import('../src/shared/okkin-loft.js');
  const { SEATS, SEATING, STAIRS: ST } = await import('../src/shared/layout.js');
  const d = KAVI_DESK_BOX;
  // The island plus its racks' depth and the standing spot in front of the panel.
  const island: Box = { minX: OKKIN_LOFT.minX - OKKIN_LOFT.rackDepth, maxX: OKKIN_LOFT.maxX, minZ: OKKIN_LOFT.minZ, maxZ: OKKIN_LOFT.maxZ };
  assert.equal(overlaps(d, island), false, 'Okkin loft island and racks');
  assert.equal(overlaps(d, { minX: OKKIN_LOFT_SPOT.x - 0.5, maxX: OKKIN_LOFT_SPOT.x + 0.5, minZ: OKKIN_LOFT_SPOT.z - 0.5, maxZ: OKKIN_LOFT_SPOT.z + 0.5 }), false, 'Okkin panel spot');
  assert.equal(overlaps(d, { minX: Math.min(ST.fromX, ST.toX), maxX: Math.max(ST.fromX, ST.toX), minZ: ST.minZ, maxZ: ST.maxZ }), false, 'loft stairs');
  // Every seat (desks, wing desks, bean bags: where the free-seat "+" peg floats) with a 1 m margin.
  for (const s of SEATS) assert.equal(overlaps(d, { minX: s.x - 1, maxX: s.x + 1, minZ: s.z - 1, maxZ: s.z + 1 }), false, `seat ${s.id}`);
  for (const s of SEATING) assert.equal(overlaps(d, { minX: s.x - 0.6, maxX: s.x + 0.6, minZ: s.z - 0.6, maxZ: s.z + 0.6 }), false, `seating ${s.id}`);
});
