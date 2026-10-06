/** The work pool board in the aisle, and the level poster on the north wall. */
import type { Ctx } from '../../core/context';
import { aside, hintTitle } from '../../core/hint';
import { store } from '../../state';
import { openPoolApproval } from './ui';

declare module '../../world/types' {
  interface InteractKinds {
    pool: true;
  }
}

export function installWorkPool(ctx: Ctx) {
  const paint = () => ctx.office.poolBoard.show(store.pool);
  paint();
  ctx.office.poolPoster.show();
  store.on('pool', paint);
  let age = 0;
  ctx.ticks.add('hud', ({ dt }) => {
    if (!ctx.inOffice() || ctx.upTop()) return;
    age += dt;
    if (age < 1) return;
    age = 0;
    paint();
  });
  ctx.interactions.define('pool', {
    reach: 6,
    hint: () => {
      const open = store.pool.columns.open.length;
      const waiting = store.pool.columns.needsApproval.length;
      return { k: `${open}|${waiting}`, parts: [hintTitle('Work pool'), aside(open || waiting ? `${open} open · ${waiting} need approval` : 'open, claimed, needs approval, done')] };
    },
    use: () => openPoolApproval(),
  });
}
