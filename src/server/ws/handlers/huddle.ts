// Huddle and seat-provider messages. Turns for the meeting room and the front desks
// are decided here so the worker manager does not grow.
import { DESKS } from '../../../shared/layout.js';
import type { HuddleClientMsg } from '../../../shared/protocol/huddle.js';
import { emptyHuddleFloor } from '../../../shared/protocol/huddle.js';
import { isPluggableSeat, readSeatChoice } from '../../../shared/seat-provider.js';
import { str } from '../../office/input.js';
import type { Ctx } from '../../office/context.js';
import type { Client } from '../../office/client.js';
import type { Floor } from '../../floor.js';
import { here } from './common.js';
import type { HandlerMap, ViewPieces } from './types.js';

export const huddleView: ViewPieces['huddle'] = (_ctx, floor) => floor?.huddle.state() ?? emptyHuddleFloor();

/** Runs a pluggable-seat turn. True when the CLI hire must not continue. */
export function holdSeat(ctx: Ctx, c: Client, floor: Floor, seatId: string, text: string, who: string): boolean {
  const gate = floor.seats.decide(floor.id, seatId, text);
  if (gate.action === 'blocked') {
    ctx.warn(c, gate.message);
    return true;
  }
  if (gate.action === 'queued') {
    ctx.toastFloor(floor, `${who} queued a turn for crew. No CLI started.`);
    floor.huddle.publish();
    return true;
  }
  if (gate.action === 'ollama') {
    void floor.seats.runOllama(floor.id, seatId, text).then((result) => {
      ctx.toastFloor(floor, result.ok ? 'Local model replied. Nobody was marked WORKING.' : result.message, result.ok ? 'info' : 'warn');
      floor.huddle.publish();
    });
    return true;
  }
  return false;
}

export const huddleHandlers = {
  'huddle.enter'(ctx, c) {
    const floor = here(ctx, c);
    if (!floor) return;
    floor.huddle.enter({ id: c.id, name: c.peer.name });
  },
  'huddle.leave'(ctx, c) {
    const floor = here(ctx, c);
    if (!floor) return;
    floor.huddle.leave(c.id);
  },
  'huddle.invite'(ctx, c, msg) {
    const floor = here(ctx, c);
    if (!floor) return;
    ctx.warn(c, floor.huddle.invite(c.id, str(msg.workerId, 64)));
  },
  'huddle.agenda'(ctx, c, msg) {
    const floor = here(ctx, c);
    if (!floor) return;
    ctx.warn(c, floor.huddle.agenda(c.id, str(msg.agenda, 2000), str(msg.context, 8000)));
  },
  'huddle.decide'(ctx, c, msg) {
    const floor = here(ctx, c);
    if (!floor) return;
    ctx.warn(c, floor.huddle.decide(c.id, str(msg.text, 500), str(msg.owner, 80), msg.needsOwner === true));
  },
  'huddle.close'(ctx, c) {
    const floor = here(ctx, c);
    if (!floor) return;
    ctx.warn(c, floor.huddle.close(c.id));
  },
  'huddle.send'(ctx, c) {
    const floor = here(ctx, c);
    if (!floor) return;
    void floor.huddle.send(c.id).then((err) => {
      if (err) ctx.warn(c, err);
      else ctx.toastFloor(floor, `${c.peer.name} sent the agenda. Nobody was marked WORKING.`);
    });
  },
  'seat.provider'(ctx, c, msg) {
    const floor = here(ctx, c);
    if (!floor) return;
    // Only `provider` is read. A url on the message cannot move the model.
    const provider = readSeatChoice({ provider: msg.provider });
    const seatId = str(msg.seatId, 64);
    if (!provider) {
      ctx.warn(c, 'Unknown seat provider');
      return;
    }
    if (!isPluggableSeat(seatId, DESKS)) {
      ctx.warn(c, 'That seat keeps the office worker');
      return;
    }
    floor.seats.setProvider(seatId, provider);
    floor.huddle.publish();
  },
} satisfies HandlerMap<HuddleClientMsg>;
