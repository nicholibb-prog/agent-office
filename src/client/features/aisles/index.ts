/**
 * Idle workers stretching their legs: now and then one that has sat idle a while gets up, strolls
 * the aisles between the desks, stops here and there, and goes back to its seat (see walkers.ts).
 * It's only ever an idle animation, never a sign of work, so the rules in logic.ts decide who may:
 * anyone working, booting, waiting on someone, asleep, watched or typed to stays seated, and the
 * moment that changes a walker is back in its seat at once, with no walk back. With the office
 * closed (the connection's down: the owner shut it down, or its machine is asleep), on the roof,
 * between floors, on another map or with reduced motion asked for, nobody walks, and nothing is
 * made of it. Each page walks its own: nothing is sent to the office, and nothing new listens.
 *
 * Installed before the worker views (see main.ts), so its look at the workers runs first: a
 * walker is back in its seat before the views see it sent home, dancing or celebrating.
 */
import type { Ctx } from '../../core/context';
import type { Parts } from '../../core/parts';
import { store } from '../../state';
import { DECIDE_EVERY, MAX_WALKERS, REST_MS, SETTLE_MS, aisleSpots, canStroll, pickStroller, planStroll, strollingAllowed } from './logic';
import { Strollers, type StrollModel } from './walkers';

/** How long (ms) after the gong nobody gets up, so a dance party isn't cut short. */
const AFTER_GONG_MS = 12_000;

export function installAisles(ctx: Ctx, parts: Pick<Parts, 'views' | 'worlds'>) {
  const walkers = new Strollers(
    () => ctx.office.group,
    () => ctx.office.colliders,
    () => ctx.world().nav,
    MAX_WALKERS,
  );
  /** When (performance.now()) each worker that may get up was first seen idle and free to. */
  const idleSince = new Map<string, number>();
  /** When each may next get up, after it last sat back down. */
  const restUntil = new Map<string, number>();
  let quietUntil = 0;
  let since = 0;

  const open = () =>
    strollingAllowed({
      up: ctx.net.up,
      inOffice: ctx.inOffice(),
      upTop: ctx.upTop(),
      travelling: !!ctx.trip(),
      reduceMotion: ctx.reduceMotion.matches,
    });

  /** Its model is still the one the views draw at its desk (not taken away when it left, or the floor changed). */
  const alive = (id: string, model: StrollModel) => parts.views?.workerViews.get(id)?.model === model;

  /** Whether `id` may stay up: still free to stroll by the rules, at the same desk. */
  const mayStay = (id: string) => {
    const w = store.workers.get(id);
    return !!w && canStroll(w, parts.worlds.plan().byId.get(w.deskId), store.officeNow());
  };

  /** Back in their seats, at once, whoever mustn't be up any more; everyone, if nobody may be. */
  function settle() {
    walkers.forgetUnless(alive);
    if (!open()) return walkers.seatAll();
    walkers.seatUnless(mayStay);
  }

  /** Every DECIDE_EVERY seconds: who's been idle long enough to get up, and maybe one does. */
  function decide(now: number) {
    settle();
    if (!open()) {
      idleSince.clear();
      return;
    }
    const plan = parts.worlds.plan();
    const views = parts.views?.workerViews;
    if (!views) return;
    const ready: string[] = [];
    for (const w of store.workers.values()) {
      const desk = plan.byId.get(w.deskId);
      if (!canStroll(w, desk, store.officeNow())) {
        idleSince.delete(w.id);
        continue;
      }
      const first = idleSince.get(w.id) ?? now;
      idleSince.set(w.id, first);
      const v = views.get(w.id);
      const seat = ctx.world().desks.get(w.deskId);
      // In its own seat (not up, not dancing on its desk, not being walked anywhere else).
      if (!v || !seat || v.model.root.parent !== seat.seatAnchor || walkers.away(w.id)) continue;
      if (now - first < SETTLE_MS || now < (restUntil.get(w.id) ?? 0) || now < quietUntil) continue;
      ready.push(w.id);
    }
    for (const id of idleSince.keys()) if (!store.workers.has(id)) idleSince.delete(id);
    const id = pickStroller(ready, walkers.count, walkers.cap, Math.random);
    if (!id) return;
    const w = store.workers.get(id)!;
    const desk = plan.byId.get(w.deskId)!;
    const seat = ctx.world().desks.get(w.deskId)!;
    const nav = ctx.world().nav;
    const stops = planStroll(desk, aisleSpots(plan.desks, (x, z) => nav.walkable(x, z)), Math.random);
    if (walkers.start(id, views.get(id)!.model, seat, stops)) restUntil.set(id, now + REST_MS);
  }

  // Before the views take the workers in: anyone who mustn't be up is back in their seat first.
  store.on('workers', settle);
  store.on('meeting', settle);
  // A pull request merged: everyone dances on their desk, so walkers sit down first.
  ctx.messages.on(
    'gong',
    () => {
      walkers.seatAll();
      quietUntil = performance.now() + AFTER_GONG_MS;
    },
    'before',
  );
  // The office closed (or the connection dropped): straight back to their seats, nothing more.
  ctx.net.onStatus((up) => {
    if (!up) walkers.seatAll();
  });
  ctx.reduceMotion.addEventListener?.('change', () => {
    if (ctx.reduceMotion.matches) walkers.seatAll();
  });

  ctx.ticks.add('others', ({ dt, now }) => {
    since += dt;
    if (since >= DECIDE_EVERY) {
      since = 0;
      decide(now);
    }
    if (walkers.count) walkers.update(dt);
  });

  return { walkers };
}
