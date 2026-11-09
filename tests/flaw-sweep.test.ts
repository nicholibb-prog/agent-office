import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CHAIR_HALF_DEPTH, CHAIR_OFFSET, DESKS, DESK_SIZE, SPAWN } from '../src/shared/layout';
import { armsHideStep } from '../src/client/world/hands-idle';

describe('AUD-19 chair clearance', () => {
  it('every chair seat sits clear of its desk top on every pod', () => {
    assert.ok(DESKS.length > 0);
    for (const _d of DESKS) assert.ok(CHAIR_OFFSET - CHAIR_HALF_DEPTH >= DESK_SIZE.depth / 2 + 0.15);
  });
});
describe('AUD-15 spawn facing', () => {
  it('faces toward the desks', () => {
    const mx = DESKS.reduce((a, d) => a + d.x, 0) / DESKS.length, mz = DESKS.reduce((a, d) => a + d.z, 0) / DESKS.length;
    const fx = Math.sin(SPAWN.rotY), fz = Math.cos(SPAWN.rotY);
    const dx = mx - SPAWN.x, dz = mz - SPAWN.z, n = Math.hypot(dx, dz);
    assert.ok((fx * dx + fz * dz) / n > 0.9);
  });
});
describe('AUD-7b arms idle', () => {
  it('eases out when idle, snaps with reduced motion, comes back on input', () => {
    assert.ok(armsHideStep(0, true, 0.1, false) > 0);
    assert.ok(armsHideStep(0, true, 0.1, false) < 1);
    assert.equal(armsHideStep(0, true, 0.1, true), 1);
    assert.equal(armsHideStep(1, false, 0.1, true), 0);
  });
});
import { ARRIVAL_OUT, DESKS as D2, ELEVATOR, ELEVATOR_CAR as CAR, arrivalFacing, inElevator as inCar } from '../src/shared/layout';
describe('AUD-15 arrival', () => {
  it('stands just outside the elevator doors, on the floor', () => {
    assert.ok(!inCar(ARRIVAL_OUT.x, ARRIVAL_OUT.z));
    assert.ok(ARRIVAL_OUT.z > CAR.maxZ && ARRIVAL_OUT.z - CAR.maxZ < 1.5);
    assert.ok(Math.abs(ARRIVAL_OUT.x - ELEVATOR.x) < ELEVATOR.doorWidth / 2);
  });
  it('faces the desks', () => {
    const f = arrivalFacing();
    const mx = D2.reduce((a, d) => a + d.x, 0) / D2.length, mz = D2.reduce((a, d) => a + d.z, 0) / D2.length;
    const dx = mx - ARRIVAL_OUT.x, dz = mz - ARRIVAL_OUT.z;
    assert.ok((Math.sin(f) * dx + Math.cos(f) * dz) / Math.hypot(dx, dz) > 0.9);
  });
});
