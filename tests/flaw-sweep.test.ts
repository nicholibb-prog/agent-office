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
    assert.ok((fx * dx + fz * dz) / n > 0.99);
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
