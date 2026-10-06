// Local Jev rankings for the office. Both sides use this: the server keeps the JSON file, the
// board draws what rankBoard returns. Nothing here reads a log, a path, or a secret. A later pass
// can hand already-redacted lines to parseJevLine; this module never opens a file.

/** The file under the office data dir (.agent-office/jev-metrics.json). */
export const JEV_FILE = 'jev-metrics.json';

/**
 * How a rank is scored.
 *
 *   work  = linesWritten × 1 + prsMerged × 500 + tasksFinished × 200
 *   idle  = breakroomSeconds × 0.15
 *   score = max(0, work − idle)
 *
 * Written work raises the score. Break-room time lowers it. The office does not invent idle
 * time: breakroomSeconds only moves when an update says so. Scores are rounded to one decimal.
 */
export const JEV_WEIGHTS = {
  line: 1,
  pr: 500,
  task: 200,
  breakroomSecond: 0.15,
} as const;

export const JEV_FORMULA = 'max(0, lines×1 + prs×500 + tasks×200 − breakroomSeconds×0.15)';

/** A desk gets a trophy once an agent's score reaches this, and the agent names a desk. */
export const JEV_MILESTONE_SCORE = 1000;

/** How much floor the standing board takes, in meters, before a map turns it. */
export const JEV_FOOTPRINT = { width: 2.7, depth: 0.72 } as const;

const AGENT_ID = /^[A-Za-z0-9_-]{1,64}$/;
const DESK_ID = /^[A-Za-z0-9_-]{1,32}$/;
const CAP = {
  linesWritten: 10_000_000,
  prsMerged: 100_000,
  tasksFinished: 100_000,
  breakroomSeconds: 10_000_000,
} as const;

export type JevCount = keyof typeof CAP;

export interface JevAgent {
  agentId: string;
  displayName: string;
  linesWritten: number;
  prsMerged: number;
  tasksFinished: number;
  breakroomSeconds: number;
  lastActiveAt: string;
  /** Where a milestone trophy can stand. Omitted until a desk is known. */
  deskId?: string;
}

export interface JevRanking extends JevAgent {
  rankScore: number;
  rank: number;
}

export interface JevBoard {
  version: 1;
  updatedAt: string;
  formula: string;
  rankings: JevRanking[];
}

export interface JevAdd {
  linesWritten?: number;
  prsMerged?: number;
  tasksFinished?: number;
  breakroomSeconds?: number;
}

const LINE_COUNTS: Record<string, JevCount> = {
  lines: 'linesWritten',
  prs: 'prsMerged',
  tasks: 'tasksFinished',
  breakroom: 'breakroomSeconds',
};

const ADD_FIELD = new Set<string>(Object.values(LINE_COUNTS));

/** A path, a credential, or a "Major Files" mention: the board must not keep or show it. */
export function looksSensitive(text: string): boolean {
  return /(?:^|[\s"'=])(?:\.\.[\\/]|\/|~\/|[A-Za-z]:\\)/.test(text)
    || /\b(?:sk-|ghp_|github_pat_|xox[baprs]-|AKIA)[A-Za-z0-9_-]{8,}/.test(text)
    || /\b(?:api[\s_-]*key|secret|password|authorization|bearer|token)\b/i.test(text)
    || /major\s*files/i.test(text);
}

export function cleanDisplayName(name: string): string | null {
  if (looksSensitive(name)) return null;
  const cleaned = name.replace(/[^\p{L}\p{N} .'_-]/gu, '').trim().slice(0, 40);
  return cleaned || null;
}

export function rankScore(agent: Pick<JevAgent, JevCount>): number {
  const work = agent.linesWritten * JEV_WEIGHTS.line + agent.prsMerged * JEV_WEIGHTS.pr + agent.tasksFinished * JEV_WEIGHTS.task;
  const idle = agent.breakroomSeconds * JEV_WEIGHTS.breakroomSecond;
  return Math.max(0, Math.round((work - idle) * 10) / 10);
}

export function rankBoard(agents: readonly JevAgent[], updatedAt: string): JevBoard {
  const rankings = agents
    .map((agent) => ({ ...agent, rankScore: rankScore(agent), rank: 0 }))
    .sort((a, b) => b.rankScore - a.rankScore || a.displayName.localeCompare(b.displayName))
    .map((agent, i) => ({ ...agent, rank: i + 1 }));
  return { version: 1, updatedAt, formula: JEV_FORMULA, rankings };
}

const SEED_AT = '2026-01-15T12:00:00.000Z';

/** Three example agents so the board has ranks before any real work is recorded. */
export function seedAgents(): JevAgent[] {
  return [
    { agentId: 'nova', displayName: 'Nova', linesWritten: 1840, prsMerged: 3, tasksFinished: 5, breakroomSeconds: 120, lastActiveAt: SEED_AT },
    { agentId: 'quill', displayName: 'Quill', linesWritten: 960, prsMerged: 1, tasksFinished: 4, breakroomSeconds: 2400, lastActiveAt: SEED_AT },
    { agentId: 'bramble', displayName: 'Bramble', linesWritten: 420, prsMerged: 0, tasksFinished: 2, breakroomSeconds: 5400, lastActiveAt: SEED_AT },
  ];
}

export function clampCount(n: number, cap: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(cap, Math.round(n)));
}

/** Adds a delta onto an agent. Counts never go below 0. Work (not break-room time) refreshes lastActiveAt. */
export function applyAdd(agent: JevAgent, add: JevAdd, now: string): JevAgent {
  const next: JevAgent = {
    ...agent,
    linesWritten: clampCount(agent.linesWritten + (add.linesWritten ?? 0), CAP.linesWritten),
    prsMerged: clampCount(agent.prsMerged + (add.prsMerged ?? 0), CAP.prsMerged),
    tasksFinished: clampCount(agent.tasksFinished + (add.tasksFinished ?? 0), CAP.tasksFinished),
    breakroomSeconds: clampCount(agent.breakroomSeconds + (add.breakroomSeconds ?? 0), CAP.breakroomSeconds),
  };
  const worked = (add.linesWritten ?? 0) > 0 || (add.prsMerged ?? 0) > 0 || (add.tasksFinished ?? 0) > 0;
  if (worked) next.lastActiveAt = now;
  return next;
}

export function validAgentId(id: string): boolean {
  return AGENT_ID.test(id);
}

export function validDeskId(id: string): boolean {
  return DESK_ID.test(id);
}

/** `add` from a POST body: only the four counts, each a safe integer. */
export function parseAdd(value: unknown): JevAdd | string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'add should be an object';
  const out: JevAdd = {};
  for (const [key, raw] of Object.entries(value)) {
    if (!ADD_FIELD.has(key)) return 'Unexpected field';
    if (typeof raw !== 'number' || !Number.isSafeInteger(raw)) return 'Bad number';
    const cap = CAP[key as JevCount];
    if (Math.abs(raw) > cap) return 'Bad number';
    out[key as JevCount] = raw;
  }
  return out;
}

export type JevLine =
  | { ok: true; agentId: string; displayName?: string; deskId?: string; add: JevAdd }
  | { ok: false; reason: string };

/**
 * One already-redacted metric line, for a later log pass to feed in.
 *
 *   jev agent=nova name="Nova" desk=desk-1 lines=+12 prs=+1 tasks=+1 breakroom=+30
 *
 * A path, a credential, or anything that isn't this grammar is refused whole. This does not read a file.
 */
export function parseJevLine(raw: string): JevLine {
  const line = raw.trim();
  if (!line) return { ok: false, reason: 'empty' };
  if (line.length > 500) return { ok: false, reason: 'too long' };
  if (looksSensitive(line)) return { ok: false, reason: 'redacted' };
  if (!line.startsWith('jev ')) return { ok: false, reason: 'not a jev line' };
  const tokens = splitTokens(line.slice(4));
  if (!tokens) return { ok: false, reason: 'bad line' };
  let agentId = '';
  let displayName: string | undefined;
  let deskId: string | undefined;
  const add: JevAdd = {};
  const seen = new Set<string>();
  for (const token of tokens) {
    const eq = token.indexOf('=');
    if (eq <= 0) return { ok: false, reason: 'bad line' };
    const key = token.slice(0, eq);
    let value = token.slice(eq + 1);
    if (seen.has(key)) return { ok: false, reason: 'bad line' };
    seen.add(key);
    if (key === 'name') {
      if (!(value.startsWith('"') && value.endsWith('"') && value.length >= 2)) return { ok: false, reason: 'bad line' };
      value = value.slice(1, -1);
      const cleaned = cleanDisplayName(value);
      if (!cleaned) return { ok: false, reason: 'redacted' };
      displayName = cleaned;
    } else if (key === 'agent') {
      if (!validAgentId(value)) return { ok: false, reason: 'bad agent' };
      agentId = value;
    } else if (key === 'desk') {
      if (!validDeskId(value)) return { ok: false, reason: 'bad desk' };
      deskId = value;
    } else if (Object.hasOwn(LINE_COUNTS, key)) {
      if (!/^[+-]?\d{1,9}$/.test(value)) return { ok: false, reason: 'bad number' };
      add[LINE_COUNTS[key]] = Number(value);
    } else {
      return { ok: false, reason: 'bad line' };
    }
  }
  if (!agentId) return { ok: false, reason: 'bad agent' };
  return { ok: true, agentId, displayName, deskId, add };
}

function splitTokens(rest: string): string[] | null {
  const out: string[] = [];
  let i = 0;
  while (i < rest.length) {
    while (rest[i] === ' ') i++;
    if (i >= rest.length) break;
    if (rest.startsWith('name="', i)) {
      const end = rest.indexOf('"', i + 6);
      if (end < 0) return null;
      out.push(rest.slice(i, end + 1));
      i = end + 1;
      continue;
    }
    const next = rest.indexOf(' ', i);
    out.push(next < 0 ? rest.slice(i) : rest.slice(i, next));
    if (next < 0) break;
    i = next + 1;
  }
  return out;
}

export function isJevBoard(value: unknown): value is JevBoard {
  if (!value || typeof value !== 'object') return false;
  const board = value as Partial<JevBoard>;
  if (board.version !== 1 || !Array.isArray(board.rankings)) return false;
  return board.rankings.every((row) => {
    if (!row || typeof row !== 'object') return false;
    const ranking = row as Partial<JevRanking>;
    return typeof ranking.agentId === 'string' && typeof ranking.displayName === 'string' && typeof ranking.rank === 'number' && typeof ranking.rankScore === 'number';
  });
}
