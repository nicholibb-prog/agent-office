// Merit pick. The top router is whoever scores best among live candidates for this task.
// Nobody is locked into the top slot. Presence is a gate. Score is lane fitness.
// An equal score breaks toward the router who is not the standing overseer, so
// oversight stays a separate job. A higher fitness still wins that tie.
//
// This module does not call a provider, read env, or decide that Okkin, DeepSeek,
// or Jev are live. Those proofs default off. A caller may pass a proof only after
// a real result cleared the 7/10 bar. Private, grey, and secret never take a
// public-cloud lane.

export const QUALITY_BAR = 7;

export const ROUTER_IDS = ['george-router', 'kavi-router-2'] as const;
export type RouterId = (typeof ROUTER_IDS)[number];

/** Always on. Verify, check, record, escalate. Not the deliverer and not the router. */
export const OVERSEER_ID = 'kavi-overseer' as const;

export type Presence = 'on' | 'out' | 'absent';
export type PrivacyClass = 'public' | 'grey' | 'private' | 'secret';

/** Task families the office asks the picker to score. */
export type MeritKind = 'research' | 'grok-proart' | 'high-logic' | 'privacy' | 'public-bulk' | 'general';

export const PUBLIC_CLOUD_LANES = ['deepseek', 'jev', 'openrouter', 'groq', 'nim', 'glm'] as const;
export type PublicCloudLane = (typeof PUBLIC_CLOUD_LANES)[number];

export const MERIT_LANES = ['cursor', 'deepseek', 'jev', 'okkin', 'forgel', 'kavi-local', 'hold-private', 'wait'] as const;
export type MeritLane = (typeof MERIT_LANES)[number];

/**
 * Default lane fitness, 0–10. A prior, not a lock: pass `laneFitness` on a
 * candidate to override it for one task. George is higher where he can hand
 * the body to someone else. Kavi is lower where winning would force a hold,
 * because she cannot take that body herself.
 */
export const MERIT_LANE_FITNESS: Readonly<Record<MeritKind, Readonly<Record<RouterId, number>>>> = {
  research: { 'george-router': 8, 'kavi-router-2': 6 },
  'grok-proart': { 'george-router': 8, 'kavi-router-2': 5 },
  'high-logic': { 'george-router': 8, 'kavi-router-2': 5 },
  privacy: { 'george-router': 8, 'kavi-router-2': 4 },
  'public-bulk': { 'george-router': 7, 'kavi-router-2': 6 },
  general: { 'george-router': 6, 'kavi-router-2': 6 },
};

export interface RouterCandidate {
  id: RouterId;
  /** Only `on` can win. `out` and `absent` score 0. */
  presence: Presence;
  /** Override the default table for this task. Clamped to 0–10. */
  laneFitness?: number;
}

/** Proofs default false. True means a live path already cleared the 7/10 bar. */
export interface LivePaths {
  okkinProven?: boolean;
  deepseekProven?: boolean;
  jevProven?: boolean;
  /** Named VM desks only. Not a license to send private or secret work there. */
  grokQuotaLive?: boolean;
}

export interface MeritTask {
  id: string;
  privacy: PrivacyClass;
  kind: MeritKind;
  /** Optional link for the second sentence to Nick. Not a body. */
  link?: string;
}

export interface MeritScore {
  id: RouterId;
  eligible: boolean;
  /** Lane fitness when eligible, otherwise 0. */
  score: number;
  presence: Presence;
  laneFitness: number;
  why: string;
}

export type HoldReason = 'no-live-router' | 'self-route-blocked' | 'quota-not-live' | 'no-live-path';

export interface MeritDecision {
  taskId: string;
  /** Router who won this task. Null when the top slot is empty. */
  top: RouterId | null;
  winner: RouterId | null;
  overseer: typeof OVERSEER_ID;
  /** Best score first. */
  scores: MeritScore[];
  lane: MeritLane;
  hold: boolean;
  holdReason?: HoldReason;
  /** `lane=<id>` for the brief. */
  laneTag: string;
  whyCheapest: string;
  /** At most two sentences (owner, then link). Empty when nobody won. */
  nickNote: string;
  /** Set when the winner was the equal-score role split, not a higher fitness. */
  tieBreak: 'role-split' | null;
}

const LANE_OWNER: Record<MeritLane, string> = {
  cursor: 'Cursor',
  deepseek: 'DeepSeek',
  jev: 'Jev',
  okkin: 'Okkin',
  forgel: 'ForgeL',
  'kavi-local': 'Kavi local',
  'hold-private': 'HOLD',
  wait: 'wait',
};

export function isRouterId(id: string): id is RouterId {
  return (ROUTER_IDS as readonly string[]).includes(id);
}

export function isPublicCloudLane(lane: string): boolean {
  return (PUBLIC_CLOUD_LANES as readonly string[]).includes(lane);
}

function clampFitness(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(10, Math.max(0, n));
}

function presenceOf(value: string): Presence {
  return value === 'on' || value === 'out' || value === 'absent' ? value : 'absent';
}

function fitnessFor(candidate: RouterCandidate, kind: MeritKind): number {
  const raw = candidate.laneFitness === undefined ? MERIT_LANE_FITNESS[kind][candidate.id] : candidate.laneFitness;
  return clampFitness(raw);
}

function pathsOf(input?: LivePaths): Required<LivePaths> {
  return {
    okkinProven: input?.okkinProven === true,
    deepseekProven: input?.deepseekProven === true,
    jevProven: input?.jevProven === true,
    grokQuotaLive: input?.grokQuotaLive === true,
  };
}

/** One sentence, then stop. */
function firstSentence(text: string): string {
  const trimmed = text.replace(/\s+/g, ' ').trim();
  const match = trimmed.match(/^.*?[.!?](?=\s|$)/);
  return (match?.[0] ?? trimmed).trim();
}

/** Owner, and a link when there is one. Never a third sentence. */
export function twoSentenceNote(owner: string, link?: string): string {
  const lead = firstSentence(owner);
  const ownerLine = /^owner:/i.test(lead) ? lead : `Owner: ${lead}`;
  const first = ownerLine.endsWith('.') || ownerLine.endsWith('!') || ownerLine.endsWith('?') ? ownerLine : `${ownerLine}.`;
  if (!link?.trim()) return first;
  const raw = link.replace(/\s+/g, ' ').trim();
  const linkLead = firstSentence(/^link:/i.test(raw) ? raw : `Link: ${raw}`);
  const second = linkLead.endsWith('.') || linkLead.endsWith('!') || linkLead.endsWith('?') ? linkLead : `${linkLead}.`;
  return `${first} ${second}`;
}

export function scoreRouter(candidate: RouterCandidate, kind: MeritKind): MeritScore {
  const presence = presenceOf(candidate.presence);
  const laneFitness = fitnessFor(candidate, kind);
  if (presence !== 'on') {
    return { id: candidate.id, eligible: false, score: 0, presence, laneFitness, why: 'not live for routing' };
  }
  return { id: candidate.id, eligible: true, score: laneFitness, presence, laneFitness, why: `live; lane fitness ${laneFitness}` };
}

function byMerit(a: MeritScore, b: MeritScore): number {
  if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
  if (a.score !== b.score) return b.score - a.score;
  if (a.laneFitness !== b.laneFitness) return b.laneFitness - a.laneFitness;
  // Equal merit: keep the overseer off the router seat.
  const aOverseer = a.id === 'kavi-router-2' ? 1 : 0;
  const bOverseer = b.id === 'kavi-router-2' ? 1 : 0;
  if (aOverseer !== bOverseer) return aOverseer - bOverseer;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

interface LaneChoice {
  lane: MeritLane;
  hold: boolean;
  holdReason?: HoldReason;
  whyCheapest: string;
}

function privateLane(winner: RouterId, paths: Required<LivePaths>): LaneChoice {
  if (paths.okkinProven) return { lane: 'okkin', hold: false, whyCheapest: 'private class on a proven local path' };
  if (winner === 'george-router') return { lane: 'kavi-local', hold: false, whyCheapest: 'local path unproven; body goes to Kavi local' };
  return { lane: 'hold-private', hold: true, holdReason: 'self-route-blocked', whyCheapest: 'local path unproven; the router cannot take the body' };
}

/** Private, grey, and secret stay off public cloud. Grey VM work is the named-desk exception. */
function restricted(task: MeritTask): boolean {
  if (task.privacy === 'private' || task.privacy === 'secret' || task.kind === 'privacy') return true;
  return task.privacy === 'grey' && task.kind !== 'grok-proart';
}

function chooseLane(winner: RouterId | null, task: MeritTask, paths: Required<LivePaths>): LaneChoice {
  if (!winner) {
    if (task.privacy === 'public' && task.kind !== 'privacy') {
      return { lane: 'wait', hold: true, holdReason: 'no-live-router', whyCheapest: 'no live router; no lane is invented' };
    }
    return { lane: 'hold-private', hold: true, holdReason: 'no-live-router', whyCheapest: 'no live router; private path holds' };
  }
  if (restricted(task)) return privateLane(winner, paths);
  if (task.kind === 'grok-proart') {
    if (paths.grokQuotaLive) return { lane: 'forgel', hold: false, whyCheapest: 'named VM desk; quota live this turn' };
    return { lane: 'wait', hold: true, holdReason: 'quota-not-live', whyCheapest: 'machine-tied work waits; public cloud is not the failover' };
  }
  if (task.kind === 'high-logic') {
    return { lane: 'cursor', hold: false, whyCheapest: 'high-logic escalates; cheapest-only is forbidden' };
  }
  if (task.kind === 'research' && paths.jevProven) {
    return { lane: 'jev', hold: false, whyCheapest: 'public research; first cheap lane is proven at the bar' };
  }
  if (paths.deepseekProven) {
    return { lane: 'deepseek', hold: false, whyCheapest: 'public cheap lane is proven at the bar' };
  }
  return { lane: 'cursor', hold: false, whyCheapest: 'cheap lanes unproven; cursor is the live public lane' };
}

function seal(winner: RouterId | null, task: MeritTask, choice: LaneChoice): LaneChoice {
  const blockedCloud = task.privacy !== 'public' || task.kind === 'privacy';
  if (blockedCloud && isPublicCloudLane(choice.lane)) {
    return { lane: 'hold-private', hold: true, holdReason: 'no-live-path', whyCheapest: 'this class does not take a public cloud lane' };
  }
  if ((task.privacy === 'private' || task.privacy === 'secret') && choice.lane === 'forgel') {
    return privateLane(winner ?? 'kavi-router-2', { okkinProven: false, deepseekProven: false, jevProven: false, grokQuotaLive: false });
  }
  if (choice.lane === 'kavi-local' && winner === 'kavi-router-2') {
    return { lane: 'hold-private', hold: true, holdReason: 'self-route-blocked', whyCheapest: 'a router does not take the body' };
  }
  if (task.privacy !== 'public' && choice.lane === 'cursor') {
    return { lane: 'hold-private', hold: true, holdReason: 'no-live-path', whyCheapest: 'this class does not take the public lane' };
  }
  return choice;
}

function unique(candidates: readonly RouterCandidate[]): RouterCandidate[] {
  const seen = new Set<string>();
  const out: RouterCandidate[] = [];
  for (const candidate of candidates) {
    if (!isRouterId(candidate.id) || seen.has(candidate.id)) continue;
    seen.add(candidate.id);
    out.push(candidate);
  }
  return out;
}

/**
 * Pick the best live router for one task, then the lane that router may use.
 * The winner never receives the deliverable body.
 */
export function pickMerit(task: MeritTask, candidates: readonly RouterCandidate[], paths?: LivePaths): MeritDecision {
  const live = pathsOf(paths);
  const scores = unique(candidates).map((candidate) => scoreRouter(candidate, task.kind)).sort(byMerit);
  const eligible = scores.filter((score) => score.eligible);
  const winner = eligible[0]?.id ?? null;
  const tieBreak = eligible.length >= 2 && eligible[0].score === eligible[1].score && eligible[0].laneFitness === eligible[1].laneFitness
    ? 'role-split' as const
    : null;
  const choice = seal(winner, task, chooseLane(winner, task, live));
  const nickNote = winner ? twoSentenceNote(LANE_OWNER[choice.lane], task.link) : '';
  return {
    taskId: task.id,
    top: winner,
    winner,
    overseer: OVERSEER_ID,
    scores,
    lane: choice.lane,
    hold: choice.hold,
    holdReason: choice.holdReason,
    laneTag: `lane=${choice.lane}`,
    whyCheapest: choice.whyCheapest,
    nickNote,
    tieBreak,
  };
}

/** Who holds the top slot for a neutral public task. Null when nobody is live. */
export function activeTop(candidates: readonly RouterCandidate[]): RouterId | null {
  return pickMerit({ id: 'seat', privacy: 'public', kind: 'general' }, candidates).top;
}
