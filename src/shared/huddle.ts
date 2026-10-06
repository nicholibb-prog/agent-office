// A huddle: people and hired workers in the meeting room, a shared agenda, and a decision log.
// Joining is a roster fact. It does not mark anyone WORKING and it does not write a reply.

import { allowedIdleActs, type IdleWorker } from './idle-acts.js';
import type { WorkerStatus } from './protocol/workers.js';

export const HUDDLE_QUORUM = 2;
export const DECISION_CAP = 100;
export const ROSTER_IN_MEETING = 'in meeting';

export const TALK_STUB =
  'Room-scoped talk is not ready. Join office voice with V (hold V to talk). Scoping it to this huddle depends on the presence/talk work.';
export const SHARE_STUB =
  'A shared view inside the huddle is not ready. Share screen from the menu puts it on the lounge TV. A huddle shared view depends on the presence/talk work.';

export interface HuddleActor {
  kind: 'peer' | 'worker';
  id: string;
  name: string;
}

export interface HuddleDecision {
  id: string;
  text: string;
  /** The name of someone who is in the huddle. */
  owner: string;
  needsOwner: boolean;
  at: number;
}

export interface Huddle {
  id: string;
  startedBy: HuddleActor;
  agenda: string;
  context: string;
  occupants: HuddleActor[];
  decisions: HuddleDecision[];
  status: 'open' | 'closed';
  openedAt: number;
}

export interface GateWorker extends IdleWorker {
  id: string;
  name: string;
  status: WorkerStatus;
}

export function canHuddle(w: GateWorker): boolean {
  return allowedIdleActs(w).includes('meeting');
}

export function rosterMark(h: Huddle | null, kind: HuddleActor['kind'], id: string): string | undefined {
  if (!h || h.status !== 'open') return undefined;
  return h.occupants.some((o) => o.kind === kind && o.id === id) ? ROSTER_IN_MEETING : undefined;
}

export function workerQuorum(h: Huddle | null): boolean {
  if (!h || h.status !== 'open') return false;
  return h.occupants.filter((o) => o.kind === 'worker').length >= HUDDLE_QUORUM;
}

export function openHuddle(by: HuddleActor, now: number, id: string): Huddle {
  return { id, startedBy: { ...by }, agenda: '', context: '', occupants: [{ ...by }], decisions: [], status: 'open', openedAt: now };
}

export function addOccupant(h: Huddle, actor: HuddleActor): Huddle {
  if (h.occupants.some((o) => o.kind === actor.kind && o.id === actor.id)) return h;
  return { ...h, occupants: [...h.occupants, { ...actor }] };
}

export function removeOccupant(h: Huddle, kind: HuddleActor['kind'], id: string): { open: Huddle | null; closed?: Huddle } {
  const occupants = h.occupants.filter((o) => !(o.kind === kind && o.id === id));
  if (occupants.length === h.occupants.length) return { open: h };
  if (!occupants.length) return { open: null, closed: { ...h, occupants, status: 'closed' } };
  return { open: { ...h, occupants } };
}

export function inviteWorker(h: Huddle, byPeerId: string, worker: GateWorker): { ok: true; huddle: Huddle } | { ok: false; error: string } {
  if (h.status !== 'open') return { ok: false, error: 'The huddle is closed' };
  if (!h.occupants.some((o) => o.kind === 'peer' && o.id === byPeerId)) return { ok: false, error: 'Walk into the meeting room before inviting' };
  if (!canHuddle(worker)) {
    if (worker.status === 'working' || worker.status === 'starting') return { ok: false, error: 'Working. They stay at the desk' };
    if (worker.status === 'needs_input' || (worker.status === 'done' && !worker.acked)) return { ok: false, error: 'Needs owner. They stay at the desk' };
    return { ok: false, error: 'Not in the office' };
  }
  return { ok: true, huddle: addOccupant(h, { kind: 'worker', id: worker.id, name: worker.name }) };
}

export function setShared(h: Huddle, byPeerId: string, agenda: string, context: string): { ok: true; huddle: Huddle } | { ok: false; error: string } {
  if (h.status !== 'open') return { ok: false, error: 'The huddle is closed' };
  if (!h.occupants.some((o) => o.kind === 'peer' && o.id === byPeerId)) return { ok: false, error: 'Walk into the meeting room first' };
  return { ok: true, huddle: { ...h, agenda: agenda.slice(0, 2000), context: context.slice(0, 8000) } };
}

export function addDecision(
  h: Huddle,
  byPeerId: string,
  input: { id: string; text: string; owner: string; needsOwner: boolean; at: number },
): { ok: true; huddle: Huddle } | { ok: false; error: string } {
  if (h.status !== 'open') return { ok: false, error: 'The huddle is closed' };
  if (!h.occupants.some((o) => o.kind === 'peer' && o.id === byPeerId)) return { ok: false, error: 'Only someone in the meeting can log a decision' };
  const text = input.text.trim();
  if (!text) return { ok: false, error: 'Write the decision' };
  const owner = input.owner.trim();
  if (!h.occupants.some((o) => o.name === owner)) return { ok: false, error: 'Owner has to be someone in the meeting' };
  const decision: HuddleDecision = { id: input.id, text: text.slice(0, 500), owner, needsOwner: input.needsOwner === true, at: input.at };
  return { ok: true, huddle: { ...h, decisions: [...h.decisions, decision].slice(-DECISION_CAP) } };
}

export type BotAct = 'leave' | 'join' | 'start' | 'none';

/**
 * One honest idle step. Names come from `workers`. No chat line is produced.
 * `pick` chooses among candidate ids so tests stay deterministic.
 */
export function applyBotStep(
  huddle: Huddle | null,
  workers: GateWorker[],
  pick: (ids: string[]) => string | undefined,
  now: number,
  nextId: () => string,
): { huddle: Huddle | null; closed?: Huddle; act: BotAct; workerId?: string } {
  if (huddle && huddle.status === 'open') {
    const stuck = huddle.occupants.find((o) => {
      if (o.kind !== 'worker') return false;
      const w = workers.find((x) => x.id === o.id);
      return !w || !canHuddle(w);
    });
    if (stuck) {
      const next = removeOccupant(huddle, 'worker', stuck.id);
      return { huddle: next.open, closed: next.closed, act: 'leave', workerId: stuck.id };
    }
    const free = workers.filter((w) => canHuddle(w) && !huddle.occupants.some((o) => o.kind === 'worker' && o.id === w.id)).map((w) => w.id);
    const id = pick(free);
    if (!id) return { huddle, act: 'none' };
    const w = workers.find((x) => x.id === id)!;
    return { huddle: addOccupant(huddle, { kind: 'worker', id: w.id, name: w.name }), act: 'join', workerId: id };
  }
  const idle = workers.filter(canHuddle).map((w) => w.id);
  const id = pick(idle);
  if (!id) return { huddle: null, act: 'none' };
  const w = workers.find((x) => x.id === id)!;
  return { huddle: openHuddle({ kind: 'worker', id: w.id, name: w.name }, now, nextId()), act: 'start', workerId: id };
}
