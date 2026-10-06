/** The Jev board in the middle of the room, and the cups on desks that hit a milestone. */
import type { Group } from 'three';
import type { Ctx } from '../../core/context';
import { aside, hintTitle } from '../../core/hint';
import { store } from '../../state';
import { syncTrophies } from './trophies';

// The kinds of thing you can use that this defines (see InteractKinds in world/types.ts).
declare module '../../world/types' {
  interface InteractKinds {
    jev: true;
  }
}

export function installJev(ctx: Ctx) {
  const spawned = new Map<string, Group>();
  const paint = () => {
    ctx.office.jevBoard.show(store.jev);
    syncTrophies(ctx.office.desks, store.jev.trophies, spawned);
  };
  paint();
  store.on('jev', paint);
  ctx.interactions.define('jev', {
    reach: 6,
    hint: () => {
      const top = store.jev.rows[0];
      const when = store.jev.rankedOn ? `as of ${store.jev.rankedOn}` : 'updates at midnight';
      return { k: top ? `${top.name}|${top.score}|${store.jev.rankedOn ?? ''}` : 'empty', parts: [hintTitle('🏆 Jev'), aside(top ? `${top.name} leads · ${top.score} · ${when}` : `every agent · ${when}`)] };
    },
    use: () => undefined,
  });
}
