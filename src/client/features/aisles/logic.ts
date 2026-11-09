/**
 * The rules for an idle worker stretching its legs down the office's aisles (see index.ts), kept
 * apart from three.js so the tests can hold them to it. Walking is an idle animation and nothing
 * more: it never stands for work. A worker that is working, booting, waiting on someone, finished
 * and not yet seen to, asleep, or being typed to stays in its seat, and with the office closed (no
 * connection to it: the owner shut it down, or the machine it runs on is asleep) nobody walks at all.
 */
import { DESK_SIZE, type DeskDef } from '../../../shared/layout';
import { deskPoint, type Pt } from '../../../shared/nav';
import type { WorkerInfo } from '../../../shared/protocol';

/** The most workers up and about at once, so the room stays calm and the machine stays lean. */
export const MAX_WALKERS = 2;
/** How often (seconds) the office looks round for someone to get up, or someone who must sit back down. */
export const DECIDE_EVERY = 2;
/** The chance, each look round, that one more idle worker gets up (about one every 20 s while there's room). */
export const START_CHANCE = 0.1;
/** How long (ms) a worker has to have been idle, by this page's clock, before it may get up. */
export const SETTLE_MS = 20_000;
/** How long (ms) after someone typed to it (or the bridge last spoke for it) it stays put. */
export const QUIET_MS = 60_000;
/** How long (ms) it sits once it's back before it may get up again. */
export const REST_MS = 45_000;
/** How far (m) from its desk it will wander: the aisles round its own pod, not across the building. */
export const REACH = 9;
/** Walking pace (m/s): an amble, slower than the castle's courtiers. */
export const AMBLE = 1.4;
/** How long (seconds) it stops at each spot in the aisle, at least and at most. */
export const PAUSE_MIN = 1.5;
export const PAUSE_MAX = 4;

/** What the page knows about the office, for whether anything walks at all. */
export interface OfficeGate {
  /** Connected to the office: false while it's shut down, restarting, or its machine is asleep. */
  up: boolean;
  /** On the office's own map (not the castle, which has its Court), and on a floor rather than the roof. */
  inOffice: boolean;
  upTop: boolean;
  /** Riding the elevator, or otherwise between floors. */
  travelling: boolean;
  /** The system asks for less motion. */
  reduceMotion: boolean;
}

/**
 * Whether anything may walk. A closed office is a normal state, not a fault: nothing moves and
 * nothing is raised about it. With reduced motion on, nobody gets up either.
 */
export function strollingAllowed(g: OfficeGate): boolean {
  return g.up && g.inOffice && !g.upTop && !g.travelling && !g.reduceMotion;
}

/**
 * Whether `w` may be up out of its seat right now, at `now` (the office's clock, ms). Only a plain
 * idle worker at an ordinary desk qualifies: not one at a kiosk, a bean bag or the meeting table,
 * not one whose worktree is gone, not one somebody is watching or typing to, and only once things
 * have been quiet for QUIET_MS (a bridge heartbeat counts as input).
 */
export function canStroll(w: WorkerInfo, desk: DeskDef | undefined, now: number): boolean {
  if (!desk || desk.station || desk.room || desk.beanbag) return false;
  if (w.status !== 'idle') return false;
  if (w.lost || w.meeting) return false;
  if (w.viewers.length || w.viewerIds.length) return false;
  if (w.lastInput && now - w.lastInput.at < QUIET_MS) return false;
  return true;
}

/**
 * Who gets up next, if anyone: none while `walking` has reached `cap`, and otherwise one of
 * `ready` picked at random, START_CHANCE of the time. `rng` gives numbers from 0 to 1.
 */
export function pickStroller(ready: readonly string[], walking: number, cap: number, rng: () => number): string | undefined {
  if (walking >= cap || !ready.length) return undefined;
  if (rng() >= START_CHANCE) return undefined;
  return ready[Math.min(ready.length - 1, Math.floor(rng() * ready.length))];
}

/** Snaps a point to a half-meter grid, for telling spots apart. */
const keyOf = (p: Pt) => `${Math.round(p[0] * 2)},${Math.round(p[1] * 2)}`;

/**
 * Spots out in the aisles to stroll to: behind each desk's chair either side, and past each end of
 * the desk, kept only where `walkable` says there's floor to stand on (so never on a desk, in a
 * wall, or in a spot the nav grid keeps clear). Worked out from the desks rather than written down,
 * so a floor built out into the back office gets its aisles too.
 */
export function aisleSpots(desks: readonly DeskDef[], walkable: (x: number, z: number) => boolean): Pt[] {
  const out: Pt[] = [];
  const seen = new Set<string>();
  const add = (p: Pt) => {
    const k = keyOf(p);
    if (seen.has(k) || !walkable(p[0], p[1])) return;
    seen.add(k);
    out.push(p);
  };
  const end = DESK_SIZE.width / 2 + 0.9;
  for (const d of desks) {
    if (d.station || d.room || d.beanbag) continue;
    for (const side of [-1, 1]) {
      add(deskPoint(d, side * 0.9, 1.8));
      add(deskPoint(d, side * end, 0));
    }
  }
  return out;
}

/**
 * Where a worker at `home` goes on one stroll: one or two of `spots` within REACH of its desk, not
 * the one right behind its own chair. Empty when there's nowhere to go.
 */
export function planStroll(home: DeskDef, spots: readonly Pt[], rng: () => number): Pt[] {
  const near = spots.filter((p) => {
    const d = Math.hypot(p[0] - home.x, p[1] - home.z);
    return d <= REACH && d > 2.2;
  });
  if (!near.length) return [];
  const n = near.length > 1 && rng() < 0.4 ? 2 : 1;
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const p = near[Math.min(near.length - 1, Math.floor(rng() * near.length))];
    if (!out.includes(p)) out.push(p);
  }
  return out;
}

/** How long it stops at a spot, from PAUSE_MIN to PAUSE_MAX seconds. */
export const pauseFor = (rng: () => number) => PAUSE_MIN + rng() * (PAUSE_MAX - PAUSE_MIN);
