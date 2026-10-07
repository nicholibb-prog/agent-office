/** Walk into the meeting room to join the huddle. The window is the agenda and the decision log. */
import { MEETING_ROOM } from '../../../shared/layout';
import type { Ctx } from '../../core/context';
import type { Parts } from '../../core/parts';
import { store } from '../../state';
import { renderWorkers } from '../../ui/workers-panel';
import { openHuddleWindow } from './ui';

export function installHuddle(ctx: Ctx, parts: Pick<Parts, 'waiting'>) {
  let inside = false;
  const inRoom = () => {
    const p = ctx.player.pos;
    return p.y > -0.5 && p.y < 2.2 && p.x > MEETING_ROOM.minX && p.x < MEETING_ROOM.maxX && p.z > MEETING_ROOM.minZ && p.z < MEETING_ROOM.maxZ;
  };
  ctx.ticks.add('hud', () => {
    const nowIn = inRoom();
    if (nowIn && !inside) ctx.net.send({ t: 'huddle.enter' });
    if (!nowIn && inside) ctx.net.send({ t: 'huddle.leave' });
    inside = nowIn;
  });
  store.on('floor', () => {
    if (inside) ctx.net.send({ t: 'huddle.leave' });
    inside = false;
  });
  store.on('huddle', () => renderWorkers((id) => parts.waiting.openWorkerTerminal(id)));
  return { open: () => openHuddleWindow(ctx.net) };
}
