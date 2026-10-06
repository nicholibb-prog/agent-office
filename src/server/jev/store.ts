// The office's Jev rankings, in .agent-office/jev-metrics.json. Local only: this never calls a
// network API and never reads a log. Hand edits of the JSON show up on the next read. A later
// pass can POST already-redacted lines (see parseJevLine) instead of pointing this at a file.
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  JEV_FILE,
  JEV_FORMULA,
  applyAdd,
  cleanDisplayName,
  clampCount,
  parseJevLine,
  rankBoard,
  rankScore,
  seedAgents,
  validAgentId,
  validDeskId,
  type JevAdd,
  type JevAgent,
  type JevBoard,
  type JevCount,
} from '../../shared/jev.js';

const MAX_AGENTS = 32;

const openStores = new Map<string, JevStore>();

/** One store per data directory, so a hand edit and a POST share the file. */
export function openJevStore(dataDir: string): JevStore {
  let store = openStores.get(dataDir);
  if (!store) openStores.set(dataDir, (store = new JevStore(dataDir)));
  return store;
}

interface Loaded {
  agents: JevAgent[];
  updatedAt: string;
  /** rankScore as it was written, so a hand edit of the counts gets saved back with the formula. */
  scores: number[];
  /** Rows dropped on the way in (a secret in a name, a bad id): the file is rewritten without them. */
  dropped: number;
}

export class JevStore {
  readonly path: string;
  private agents: JevAgent[] = [];
  private updatedAt = '';
  private mtime = 0;

  constructor(
    dataDir: string,
    private now: () => string = () => new Date().toISOString(),
  ) {
    this.path = path.join(dataDir, JEV_FILE);
    const loaded = this.read();
    if (loaded) this.adopt(loaded);
    else {
      this.agents = seedAgents();
      this.updatedAt = this.now();
      this.write();
    }
  }

  /** Rankings as of now. Re-reads the file when something else has written it. */
  board(): JevBoard {
    this.reloadIfChanged();
    return rankBoard(this.agents, this.updatedAt);
  }

  /**
   * Applies a metric delta for one agent. Returns the new board, or a short reason the update
   * was refused. Reasons never echo the submitted name.
   */
  add(input: { agentId: string; displayName?: string; deskId?: string | null; add: JevAdd }): JevBoard | string {
    this.reloadIfChanged();
    if (!validAgentId(input.agentId)) return 'Bad agent';
    if (input.deskId !== undefined && input.deskId !== null && input.deskId !== '' && !validDeskId(input.deskId)) return 'Bad desk';
    const renaming = input.displayName !== undefined;
    const displayName = renaming ? cleanDisplayName(input.displayName ?? '') : undefined;
    if (renaming && !displayName) return 'Name rejected';
    let agent = this.agents.find((row) => row.agentId === input.agentId);
    if (!agent) {
      if (this.agents.length >= MAX_AGENTS) return 'Too many agents';
      const created = displayName ?? cleanDisplayName(input.agentId);
      if (!created) return 'Name rejected';
      agent = {
        agentId: input.agentId,
        displayName: created,
        linesWritten: 0,
        prsMerged: 0,
        tasksFinished: 0,
        breakroomSeconds: 0,
        lastActiveAt: this.now(),
      };
      this.agents.push(agent);
    } else if (displayName) agent.displayName = displayName;
    if (input.deskId === null || input.deskId === '') delete agent.deskId;
    else if (input.deskId) agent.deskId = input.deskId;
    Object.assign(agent, applyAdd(agent, input.add, this.now()));
    this.updatedAt = this.now();
    this.write();
    return this.board();
  }

  /** One redacted `jev agent=…` line. Refused lines are not stored. */
  ingest(line: string): { ok: true; board: JevBoard } | { ok: false; reason: string } {
    const parsed = parseJevLine(line);
    if (!parsed.ok) return parsed;
    const result = this.add({ agentId: parsed.agentId, displayName: parsed.displayName, deskId: parsed.deskId, add: parsed.add });
    if (typeof result === 'string') return { ok: false, reason: result };
    return { ok: true, board: result };
  }

  private adopt(loaded: Loaded) {
    this.agents = loaded.agents;
    this.updatedAt = loaded.updatedAt;
    const stale = loaded.dropped > 0 || loaded.agents.some((agent, i) => loaded.scores[i] !== rankScore(agent));
    if (stale) this.write();
    else this.noteMtime();
  }

  private reloadIfChanged() {
    let mtime = 0;
    try {
      mtime = statSync(this.path).mtimeMs;
    } catch {
      return;
    }
    if (mtime === this.mtime) return;
    const loaded = this.read();
    if (!loaded) {
      this.mtime = mtime;
      return;
    }
    this.adopt(loaded);
  }

  private read(): Loaded | null {
    try {
      const parsed = JSON.parse(readFileSync(this.path, 'utf8')) as unknown;
      if (!parsed || typeof parsed !== 'object') return null;
      const body = parsed as { updatedAt?: unknown; agents?: unknown };
      if (!Array.isArray(body.agents)) return null;
      const agents: JevAgent[] = [];
      const scores: number[] = [];
      let dropped = 0;
      for (const row of body.agents) {
        const agent = parseStored(row);
        if (!agent) {
          dropped++;
          continue;
        }
        agents.push(agent.agent);
        scores.push(agent.score);
      }
      if (!agents.length) return null;
      const updatedAt = typeof body.updatedAt === 'string' && body.updatedAt.length <= 40 ? body.updatedAt : this.now();
      return { agents, updatedAt, scores, dropped };
    } catch {
      return null;
    }
  }

  private write() {
    const agents = this.agents.map((agent) => ({ ...agent, rankScore: rankScore(agent) }));
    const body = { version: 1 as const, updatedAt: this.updatedAt, formula: JEV_FORMULA, agents };
    mkdirSync(path.dirname(this.path), { recursive: true, mode: 0o700 });
    writeFileSync(this.path, `${JSON.stringify(body, null, 2)}\n`, { mode: 0o600 });
    this.noteMtime();
  }

  private noteMtime() {
    try {
      this.mtime = statSync(this.path).mtimeMs;
    } catch {
      this.mtime = 0;
    }
  }
}

function parseStored(value: unknown): { agent: JevAgent; score: number } | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  if (typeof row.agentId !== 'string' || !validAgentId(row.agentId)) return null;
  if (typeof row.displayName !== 'string') return null;
  const displayName = cleanDisplayName(row.displayName);
  if (!displayName) return null;
  const agent: JevAgent = {
    agentId: row.agentId,
    displayName,
    linesWritten: count(row.linesWritten, 'linesWritten'),
    prsMerged: count(row.prsMerged, 'prsMerged'),
    tasksFinished: count(row.tasksFinished, 'tasksFinished'),
    breakroomSeconds: count(row.breakroomSeconds, 'breakroomSeconds'),
    lastActiveAt: typeof row.lastActiveAt === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(row.lastActiveAt) && row.lastActiveAt.length <= 40 ? row.lastActiveAt : '1970-01-01T00:00:00.000Z',
  };
  if (typeof row.deskId === 'string' && validDeskId(row.deskId)) agent.deskId = row.deskId;
  const score = typeof row.rankScore === 'number' ? row.rankScore : Number.NaN;
  return { agent, score };
}

function count(value: unknown, key: JevCount): number {
  return typeof value === 'number' ? clampCount(value, key === 'prsMerged' || key === 'tasksFinished' ? 100_000 : 10_000_000) : 0;
}
