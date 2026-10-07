// Idle workers strolling the aisles (src/client/features/aisles): only ever an idle animation. A
// worker with work, or watched, or with no presence stays in its seat; nobody walks while the office
// is closed or reduced motion is asked for; never more than the cap are up at once; and every step
// goes round the desks and walls, never through them, ending back in the worker's own seat.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { DESKS, DESK_SIZE, FLOOR, MEETING_SEATS, STATIONS, BEANBAGS, builtDesks, type DeskDef } from '../src/shared/layout.js';
import { deskPoint, officeNav } from '../src/shared/nav.js';
import type { WorkerInfo, WorkerStatus } from '../src/shared/protocol.js';
import { MAX_WALKERS, QUIET_MS, aisleSpots, canStroll, pickStroller, planStroll, strollingAllowed, type OfficeGate } from '../src/client/features/aisles/logic.js';
import { Strollers, type StrollModel, type StrollSeat } from '../src/client/features/aisles/walkers.js';
import { stepToward, type Body } from '../src/client/player/collide.js';
import type { Collider } from '../src/client/world/types.js';

const NOW = 1_000_000_000;

function worker(over: Partial<WorkerInfo> = {}): WorkerInfo {
  return { id: 'w1', kind: 'shell', deskId: 'desk-1', name: 'Ada', color: '#fff', status: 'idle', acked: true, createdBy: 'owner', createdAt: 0, cols: 80, rows: 24, viewers: [], viewerIds: [], ...over } as WorkerInfo;
}

const open: OfficeGate = { up: true, inOffice: true, upTop: false, travelling: false, reduceMotion: false };

test('only a plain idle worker may stroll: one at work, booting, waiting, done or asleep stays seated', () => {
  const desk = DESKS[0];
  assert.equal(canStroll(worker(), desk, NOW), true);
  for (const status of ['working', 'starting', 'needs_input', 'done', 'exited', 'offline'] as WorkerStatus[]) {
    assert.equal(canStroll(worker({ status }), desk, NOW), false, `${status} must stay seated`);
  }
});

test('a watched, recently typed-to, lost or meeting worker stays seated, and so does anyone off an ordinary desk', () => {
  const desk = DESKS[0];
  assert.equal(canStroll(worker({ viewers: ['owner'], viewerIds: ['p1'] }), desk, NOW), false);
  // A bridge heartbeat or someone typing counts as input: it stays put a while after.
  assert.equal(canStroll(worker({ lastInput: { by: 'crew-status', at: NOW - 1000 } }), desk, NOW), false);
  assert.equal(canStroll(worker({ lastInput: { by: 'owner', at: NOW - QUIET_MS - 1 } }), desk, NOW), true);
  assert.equal(canStroll(worker({ lost: { branch: 'gone' } as WorkerInfo['lost'] }), desk, NOW), false);
  assert.equal(canStroll(worker({ meeting: 'm1' }), desk, NOW), false);
  assert.equal(canStroll(worker(), undefined, NOW), false);
  assert.equal(canStroll(worker(), STATIONS[0], NOW), false);
  assert.equal(canStroll(worker(), MEETING_SEATS[0], NOW), false);
  assert.equal(canStroll(worker(), BEANBAGS[0], NOW), false);
});

test('nobody walks with the office closed, on the roof, between floors, off the office map, or with reduced motion', () => {
  assert.equal(strollingAllowed(open), true);
  assert.equal(strollingAllowed({ ...open, up: false }), false);
  assert.equal(strollingAllowed({ ...open, upTop: true }), false);
  assert.equal(strollingAllowed({ ...open, travelling: true }), false);
  assert.equal(strollingAllowed({ ...open, inOffice: false }), false);
  assert.equal(strollingAllowed({ ...open, reduceMotion: true }), false);
});

test('pickStroller never goes past the cap, and picks someone ready when there is room', () => {
  const ready = ['a', 'b', 'c'];
  const always = () => 0;
  assert.equal(pickStroller(ready, MAX_WALKERS, MAX_WALKERS, always), undefined);
  assert.equal(pickStroller(ready, MAX_WALKERS + 1, MAX_WALKERS, always), undefined);
  assert.equal(pickStroller([], 0, MAX_WALKERS, always), undefined);
  assert.equal(pickStroller(ready, 0, MAX_WALKERS, always), 'a');
  assert.equal(pickStroller(ready, 0, MAX_WALKERS, () => 0.99), undefined);
});

// ---- The aisles, and walking them ---------------------------------------------------------------

/** The office as walkers bump into it: its desks and its four walls. */
function officeColliders(desks: readonly DeskDef[]): Collider[] {
  const hw = DESK_SIZE.width / 2;
  const hd = DESK_SIZE.depth / 2;
  const out: Collider[] = desks.map((d) => ({ minX: d.x - hw, maxX: d.x + hw, minZ: d.z - hd, maxZ: d.z + hd, top: DESK_SIZE.height }));
  const T = 0.3;
  out.push(
    { minX: FLOOR.minX - T, maxX: FLOOR.minX, minZ: FLOOR.minZ - T, maxZ: FLOOR.maxZ + T, top: 6 },
    { minX: FLOOR.maxX, maxX: FLOOR.maxX + T, minZ: FLOOR.minZ - T, maxZ: FLOOR.maxZ + T, top: 6 },
    { minX: FLOOR.minX - T, maxX: FLOOR.maxX + T, minZ: FLOOR.minZ - T, maxZ: FLOOR.minZ, top: 6 },
    { minX: FLOOR.minX - T, maxX: FLOOR.maxX + T, minZ: FLOOR.maxZ, maxZ: FLOOR.maxZ + T, top: 6 },
  );
  return out;
}

/** Whether a body of radius `r` at (x, z) overlaps `c`'s footprint. */
const overlaps = (c: Collider, x: number, z: number, r: number) => {
  const nx = Math.min(Math.max(x, c.minX), c.maxX);
  const nz = Math.min(Math.max(z, c.minZ), c.maxZ);
  return (x - nx) ** 2 + (z - nz) ** 2 < r * r;
};

test('every aisle spot is open floor: walkable on the nav grid and clear of every desk', () => {
  const nav = officeNav(0);
  const spots = aisleSpots(DESKS, (x, z) => nav.walkable(x, z));
  assert.ok(spots.length >= 8, `only ${spots.length} spots`);
  const solid = officeColliders(DESKS);
  for (const [x, z] of spots) {
    assert.ok(nav.walkable(x, z), `(${x}, ${z}) is not walkable`);
    for (const c of solid) assert.ok(!overlaps(c, x, z, 0.32), `(${x.toFixed(2)}, ${z.toFixed(2)}) is on a desk or in a wall`);
  }
  // Built out into the back office, its desks get aisle spots too.
  const wing = officeNav(2);
  const more = aisleSpots(builtDesks(2), (x, z) => wing.walkable(x, z));
  assert.ok(more.length > spots.length);
});

test('a stroll goes to one or two spots near its own desk', () => {
  const nav = officeNav(0);
  const spots = aisleSpots(DESKS, (x, z) => nav.walkable(x, z));
  for (const d of DESKS) {
    for (const r of [0, 0.3, 0.7, 0.99]) {
      const stops = planStroll(d, spots, () => r);
      assert.ok(stops.length >= 1 && stops.length <= 2, `${d.id}: ${stops.length} stops`);
      for (const [x, z] of stops) assert.ok(Math.hypot(x - d.x, z - d.z) <= 9);
    }
  }
});

/** A worker sitting at `def`, as the walkers see it. */
function seated(scene: THREE.Object3D, def: DeskDef): { model: StrollModel; seat: StrollSeat } {
  const seatAnchor = new THREE.Object3D();
  const [x, z] = deskPoint(def, 0, 0.9);
  seatAnchor.position.set(x, 0.45, z);
  seatAnchor.rotation.y = def.rotY + Math.PI;
  scene.add(seatAnchor);
  const model: StrollModel = { root: new THREE.Object3D(), walking: false, gait: 1, stopDancing() {} };
  seatAnchor.add(model.root);
  return { model, seat: { def, seatAnchor } };
}

/** A seeded random, so a failure shows up the same every run. */
function seededRng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a * 1664525 + 1013904223) >>> 0;
    return a / 4294967296;
  };
}

test('walkers stroll round the desks, never onto them or into a wall, and end up back in their own seats', () => {
  const scene = new THREE.Group();
  const nav = officeNav(0);
  const solid = officeColliders(DESKS);
  const spots = aisleSpots(DESKS, (x, z) => nav.walkable(x, z));
  for (let round = 0; round < DESKS.length; round += 2) {
    const rng = seededRng(round + 1);
    const walkers = new Strollers(() => scene, () => solid, () => nav, MAX_WALKERS, rng);
    const people = DESKS.slice(round, round + 2).map((def) => ({ def, ...seated(scene, def) }));
    for (const p of people) assert.ok(walkers.start(p.def.id, p.model, p.seat, planStroll(p.def, spots, rng)), `${p.def.id} got up`);
    let walked = 0;
    for (let frame = 0; frame < 60 * 90 && walkers.count; frame++) {
      walkers.update(1 / 60);
      for (const p of people) {
        const at = walkers.where(p.def.id);
        if (!at || at.phase === 'down' || at.phase === 'up') continue;
        walked++;
        for (const c of solid) assert.ok(!overlaps(c, at.x, at.z, 0.3), `${p.def.id} stepped onto a desk or into a wall at (${at.x.toFixed(2)}, ${at.z.toFixed(2)})`);
      }
    }
    assert.ok(walked > 0, 'nobody walked');
    assert.equal(walkers.count, 0, 'everyone is back by the end');
    for (const p of people) {
      assert.equal(p.model.root.parent, p.seat.seatAnchor, `${p.def.id} is back in its own seat`);
      assert.equal(p.model.walking, false);
      assert.equal(p.model.root.position.length(), 0);
    }
  }
});

test('the cap holds: no more than MAX_WALKERS are ever up at once', () => {
  const scene = new THREE.Group();
  const nav = officeNav(0);
  const spots = aisleSpots(DESKS, (x, z) => nav.walkable(x, z));
  const walkers = new Strollers(() => scene, () => officeColliders(DESKS), () => nav, MAX_WALKERS, seededRng(7));
  const people = DESKS.slice(0, MAX_WALKERS + 2).map((def) => ({ def, ...seated(scene, def) }));
  const started = people.map((p) => walkers.start(p.def.id, p.model, p.seat, planStroll(p.def, spots, () => 0.5)));
  assert.equal(started.filter(Boolean).length, MAX_WALKERS);
  assert.equal(walkers.count, MAX_WALKERS);
  for (const p of people.slice(MAX_WALKERS)) assert.equal(p.model.root.parent, p.seat.seatAnchor, `${p.def.id} stayed seated`);
});

test('the moment a walker has work (or the office closes) it is back in its seat, with no walk back', () => {
  const scene = new THREE.Group();
  const nav = officeNav(0);
  const spots = aisleSpots(DESKS, (x, z) => nav.walkable(x, z));
  const walkers = new Strollers(() => scene, () => officeColliders(DESKS), () => nav, MAX_WALKERS, seededRng(3));
  const [a, b] = DESKS.slice(0, 2).map((def) => ({ def, ...seated(scene, def) }));
  for (const p of [a, b]) walkers.start(p.def.id, p.model, p.seat, planStroll(p.def, spots, () => 0.5));
  for (let i = 0; i < 120; i++) walkers.update(1 / 60);
  assert.equal(a.model.root.parent, scene, 'a is up');
  // a starts working: it sits back down at once. b, still idle, carries on.
  const status: Record<string, WorkerStatus> = { [a.def.id]: 'working', [b.def.id]: 'idle' };
  walkers.seatUnless((id) => canStroll(worker({ status: status[id] }), DESKS[0], NOW));
  assert.equal(walkers.away(a.def.id), false);
  assert.equal(a.model.root.parent, a.seat.seatAnchor);
  assert.equal(a.model.walking, false);
  assert.equal(walkers.away(b.def.id), true);
  // The office closes: everyone is seated, and nothing is left walking.
  walkers.seatAll();
  assert.equal(walkers.count, 0);
  assert.equal(b.model.root.parent, b.seat.seatAnchor);
});

test('a walker whose model was taken away is let go of without being put back anywhere', () => {
  const scene = new THREE.Group();
  const nav = officeNav(0);
  const spots = aisleSpots(DESKS, (x, z) => nav.walkable(x, z));
  const walkers = new Strollers(() => scene, () => officeColliders(DESKS), () => nav, MAX_WALKERS, seededRng(5));
  const p = { def: DESKS[0], ...seated(scene, DESKS[0]) };
  walkers.start(p.def.id, p.model, p.seat, planStroll(p.def, spots, () => 0.5));
  p.model.root.removeFromParent();
  walkers.forgetUnless(() => false);
  assert.equal(walkers.count, 0);
  assert.equal(p.model.root.parent, null);
});

test('stepToward slides along a desk instead of passing through it, however long the step', () => {
  const desk: Collider = { minX: -1.1, maxX: 1.1, minZ: -0.55, maxZ: 0.55, top: 0.78 };
  const body: Body = { pos: new THREE.Vector3(0, 0, 2), colliders: [desk], grounded: false, stepOffset: 0 };
  // Straight at it, in one huge step: it stops at the desk's edge.
  stepToward(body, 0, -2, 10);
  assert.ok(body.pos.z >= 0.55 + 0.3, `went into the desk to z=${body.pos.z}`);
  // Off at an angle: it slides along the edge.
  const moved = stepToward(body, 3, -2, 1);
  assert.ok(moved > 0.3, `stuck: moved ${moved}`);
  assert.ok(!overlaps(desk, body.pos.x, body.pos.z, 0.3));
});

test('something in the aisle the route did not know about is never walked through: the walker turns for home', () => {
  const scene = new THREE.Group();
  const nav = officeNav(0);
  const def = DESKS[0];
  const p = { def, ...seated(scene, def) };
  const spots = aisleSpots(DESKS, (x, z) => nav.walkable(x, z));
  const stops = planStroll(def, spots, () => 0.5);
  // A crate dropped right on the spot it means to stop at.
  const [sx, sz] = stops[0];
  const crate: Collider = { minX: sx - 0.6, maxX: sx + 0.6, minZ: sz - 0.6, maxZ: sz + 0.6, top: 1 };
  const solid = [...officeColliders(DESKS), crate];
  const walkers = new Strollers(() => scene, () => solid, () => nav, MAX_WALKERS, seededRng(11));
  assert.ok(walkers.start(def.id, p.model, p.seat, stops));
  for (let frame = 0; frame < 60 * 90 && walkers.count; frame++) {
    walkers.update(1 / 60);
    const at = walkers.where(def.id);
    if (at && at.phase !== 'down' && at.phase !== 'up') assert.ok(!overlaps(crate, at.x, at.z, 0.3), `walked into the crate at (${at.x.toFixed(2)}, ${at.z.toFixed(2)})`);
  }
  assert.equal(walkers.count, 0);
  assert.equal(p.model.root.parent, p.seat.seatAnchor);
});
