// Kavi walks the office aisles. She has no desk and is never marked WORKING.
import { lookFromSeed } from '../../../shared/avatar';
import type { Ctx } from '../../core/context';
import { noOutline } from '../../core/outline';
import { Person } from '../../world/character';
import { KAVI_PATROL, advancePatrol, type PatrolCursor } from './karen';

/** How fast she walks, in meters per second. */
const SPEED = 1.15;

/** Puts Kavi in the office and walks her along the aisle patrol each frame. */
export function installKavi(ctx: Ctx) {
  const person = new Person('Kavi', '#c77dff', lookFromSeed('kavi'));
  noOutline(person.root);
  ctx.scene.add(person.root);
  const start = KAVI_PATROL[0];
  person.root.position.set(start[0], 0, start[1]);
  let at: [number, number] = [start[0], start[1]];
  let cursor: PatrolCursor = { corners: KAVI_PATROL, next: 1 };
  let facing = 0;
  ctx.ticks.add('others', ({ dt }) => {
    const home = ctx.inOffice();
    person.root.visible = home;
    if (!home) return;
    const before = at;
    const step = advancePatrol(at, cursor, SPEED * dt);
    at = step.at;
    cursor = step.cursor;
    const dx = at[0] - before[0];
    const dz = at[1] - before[1];
    const moving = dx * dx + dz * dz > 1e-8;
    if (moving) facing = Math.atan2(dx, dz);
    person.root.position.set(at[0], 0, at[1]);
    person.root.rotation.y = facing;
    person.update(dt, performance.now() / 1000, moving, false);
  });
}
