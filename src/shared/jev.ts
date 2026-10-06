// Local Jev rankings for one floor. Counts live in .agent-office/jev-metrics.json.
// Names and numbers only: no paths, tokens, TypeSafe, or any remote API.
// The board compares every hired agent. The order is published at local midnight.

/** One made-up or local agent on the board. `id` is a slug, never a filesystem path. */
export interface JevAgent {
  id: string;
  name: string;
  lines: number;
  prs: number;
  tasks: number;
  /** Minutes idle in the breakroom. Score halves every BREAKROOM_HALFLIFE_MIN of these. */
  breakroomMinutes: number;
  /** Desk a milestone cup can stand on, such as `desk-12`. Not a path. */
  deskId?: string;
}

export interface JevRow {
  rank: number;
  name: string;
  score: number;
  lines: number;
  prs: number;
  tasks: number;
  breakroomMinutes: number;
}

/** A cup on a desk. The mesh is a stub; the milestone is what earned it. */
export interface JevTrophy {
  deskId: string;
  milestone: string;
  label: string;
}

/** What the center-room board paints, and which desks get a cup. */
export interface JevBoard {
  rows: JevRow[];
  trophies: JevTrophy[];
  /** Local calendar day this order was published, YYYY-MM-DD. The next night replaces it. */
  rankedOn?: string;
}

/**
 * One hired agent as counted today. `lines` left out means the worktree could not be read, so the
 * last count stands. Shells are not agents and never appear here.
 */
export interface LiveAgent {
  id: string;
  name: string;
  deskId?: string;
  lines?: number;
  prs: number;
  tasks: number;
  breakroomMinutes?: number;
}

export const BREAKROOM_HALFLIFE_MIN = 30;

/** The lounge, east of the desks: the couch, the TV and the jukebox. Idle here decays a score. */
export const BREAKROOM = { minX: 8, maxX: 18, minZ: -6, maxZ: 8 } as const;

export function inBreakroom(x: number, z: number): boolean {
  return x >= BREAKROOM.minX && x <= BREAKROOM.maxX && z >= BREAKROOM.minZ && z <= BREAKROOM.maxZ;
}

/**
 * The Jev board in the central aisle, south of the plant at (-6, 0), facing +z.
 * `width` and `height` are the writing face; `bottom` is how high that face starts.
 */
export const JEV_BOARD = { x: -6, z: 2.15, width: 2.6, height: 1.55, bottom: 1 } as const;

const NAME_MAX = 24;
const SLUG = /^[a-z0-9-]{1,24}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** A desk, a bean bag, a meeting chair, or one of the board stations. Not a path. */
const SEAT = /^(?:desk|beanbag|meeting)-\d{1,2}$|^station-(?:issues|pulls|queue)$/;

/** How many agents the nightly board keeps. The ones at a desk always stay. */
export const JEV_KEEP = 24;

/** Sample ids the board used to paint before it ranked hired agents. A file that never published a night drops them. */
export const JEV_STAND_INS = new Set(['ada', 'pip', 'tasker', 'lou', 'nib']);

/** The office machine's calendar day, the night the ranking rolls over. */
export function localDay(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function isLocalDay(day: unknown): day is string {
  return typeof day === 'string' && DAY.test(day);
}

/** A display name. Paths, URLs and token-shaped text are refused. */
export function cleanJevName(name: unknown): string {
  if (typeof name !== 'string') return '';
  const flat = name.replace(/[\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!flat || /[/\\]/.test(flat) || /:\/\//.test(flat) || /\b(sk-|ghp_|github_pat_|xox[baprs]-|AKIA)/.test(flat)) return '';
  return [...flat].slice(0, NAME_MAX).join('');
}

function whole(n: unknown): number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.min(1_000_000, Math.floor(n)) : 0;
}

/** Lines, plus pull requests and finished tasks, before breakroom decay. */
export function rawScore(a: { lines: number; prs: number; tasks: number }): number {
  return a.lines + a.prs * 50 + a.tasks * 25;
}

/** Half the raw score for every half-hour spent idle in the breakroom. */
export function decayedScore(raw: number, breakroomMinutes: number): number {
  const idle = breakroomMinutes > 0 ? breakroomMinutes : 0;
  if (idle === 0 || raw <= 0) return Math.max(0, raw);
  return raw * Math.pow(0.5, idle / BREAKROOM_HALFLIFE_MIN);
}

export const TROPHY_MILESTONES = [
  { id: 'lines-100', field: 'lines', at: 100, label: '100 lines' },
  { id: 'pr-1', field: 'prs', at: 1, label: 'First PR' },
  { id: 'tasks-5', field: 'tasks', at: 5, label: '5 tasks' },
] as const;

export function trophiesFor(agent: JevAgent): JevTrophy[] {
  if (!agent.deskId || !SEAT.test(agent.deskId)) return [];
  const out: JevTrophy[] = [];
  for (const m of TROPHY_MILESTONES) if (agent[m.field] >= m.at) out.push({ deskId: agent.deskId, milestone: m.id, label: m.label });
  return out;
}

export function rankAgents(agents: readonly JevAgent[]): JevRow[] {
  const scored = agents.map((a) => ({
    name: a.name,
    score: Math.round(decayedScore(rawScore(a), a.breakroomMinutes)),
    lines: a.lines,
    prs: a.prs,
    tasks: a.tasks,
    breakroomMinutes: a.breakroomMinutes,
  }));
  scored.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  return scored.map((row, i) => ({ rank: i + 1, ...row }));
}

export function boardFrom(agents: readonly JevAgent[], rankedOn?: string): JevBoard {
  return { rows: rankAgents(agents), trophies: agents.flatMap(trophiesFor), ...(rankedOn ? { rankedOn } : {}) };
}

/** Pull requests this agent has open now, opened before, or opened in another repository. */
export function pullRequestsOf(w: { pr?: unknown; pastPrs?: readonly unknown[]; repos?: readonly { pr?: unknown }[] }): number {
  return (w.pr ? 1 : 0) + (w.pastPrs?.length ?? 0) + (w.repos?.filter((r) => r.pr).length ?? 0);
}

/**
 * Finished queue tasks for this agent. A turn that ended with no queue task behind it still counts
 * as one, once. A task that was stopped or failed does not.
 */
export function finishedTasks(workerId: string, tasks: readonly { workerId?: string; status: string; outcome?: string }[], worker?: { status: string; hasTask: boolean }): number {
  const done = tasks.filter((t) => t.workerId === workerId && t.status === 'done' && t.outcome === 'done').length;
  if (done > 0) return done;
  return worker?.status === 'done' && worker.hasTask ? 1 : 0;
}

function liveAgent(a: LiveAgent, prev?: JevAgent): JevAgent | undefined {
  const name = cleanJevName(a.name);
  const id = SLUG.test(a.id) ? a.id : '';
  if (!name || !id) return undefined;
  const deskId = a.deskId && SEAT.test(a.deskId) ? a.deskId : undefined;
  return {
    id,
    name,
    lines: a.lines === undefined ? (prev?.lines ?? 0) : whole(a.lines),
    prs: whole(a.prs),
    tasks: whole(a.tasks),
    breakroomMinutes: Math.max(whole(a.breakroomMinutes), prev?.breakroomMinutes ?? 0),
    ...(deskId ? { deskId } : {}),
  };
}

/**
 * Every agent the board knows, with today's counts laid over the last ones. Someone sent home stays,
 * with the numbers they had. A worktree that could not be read keeps its last line count.
 */
export function mergeAgents(previous: readonly JevAgent[], live: readonly LiveAgent[]): JevAgent[] {
  const byId = new Map(previous.map((a) => [a.id, a]));
  const liveIds = new Set<string>();
  for (const a of live) {
    const prev = SLUG.test(a.id) ? byId.get(a.id) : undefined;
    const next = liveAgent(a, prev);
    if (!next) continue;
    liveIds.add(next.id);
    byId.set(next.id, next);
  }
  const all = [...byId.values()];
  if (all.length <= JEV_KEEP) return all;
  const ranked = [...all].sort((a, b) => rawScore(b) - rawScore(a) || a.name.localeCompare(b.name));
  const keep = new Set(liveIds);
  for (const a of ranked) {
    if (keep.size >= JEV_KEEP) break;
    keep.add(a.id);
  }
  return all.filter((a) => keep.has(a.id));
}

/** The sample board the props lab paints. The office ranks hired agents instead. */
export function seedAgents(): JevAgent[] {
  return [
    { id: 'ada', name: 'Ada Lines', lines: 420, prs: 2, tasks: 4, breakroomMinutes: 0, deskId: 'desk-12' },
    { id: 'pip', name: 'Pip Merges', lines: 80, prs: 6, tasks: 3, breakroomMinutes: 0, deskId: 'desk-13' },
    { id: 'tasker', name: 'Tasker', lines: 40, prs: 1, tasks: 8, breakroomMinutes: 10, deskId: 'desk-14' },
    { id: 'lou', name: 'Lounge Lou', lines: 300, prs: 4, tasks: 4, breakroomMinutes: 90, deskId: 'desk-15' },
    { id: 'nib', name: 'Nib', lines: 12, prs: 0, tasks: 1, breakroomMinutes: 0, deskId: 'desk-16' },
  ];
}

export function cleanAgent(raw: unknown): JevAgent | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Partial<Record<keyof JevAgent, unknown>>;
  const name = cleanJevName(r.name);
  const id = typeof r.id === 'string' && SLUG.test(r.id) ? r.id : '';
  if (!name || !id) return undefined;
  const deskId = typeof r.deskId === 'string' && SEAT.test(r.deskId) ? r.deskId : undefined;
  return { id, name, lines: whole(r.lines), prs: whole(r.prs), tasks: whole(r.tasks), breakroomMinutes: whole(r.breakroomMinutes), ...(deskId ? { deskId } : {}) };
}

/** Agents read back from disk. A broken file, or one with nothing safe in it, is the seed. */
export function cleanAgents(raw: unknown): JevAgent[] {
  const list = raw && typeof raw === 'object' && Array.isArray((raw as { agents?: unknown }).agents) ? (raw as { agents: unknown[] }).agents : null;
  if (!list) return seedAgents();
  const agents = list.map(cleanAgent).filter((a): a is JevAgent => !!a);
  return agents.length ? agents : seedAgents();
}

/** Adds breakroom idle. The next ranking applies the half-life. */
export function applyBreakroomIdle(agent: JevAgent, minutes: number): JevAgent {
  return { ...agent, breakroomMinutes: agent.breakroomMinutes + whole(minutes) };
}
