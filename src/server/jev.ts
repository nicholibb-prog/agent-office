import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { applyBreakroomIdle, boardFrom, cleanAgent, isLocalDay, JEV_STAND_INS, mergeAgents, type JevAgent, type JevBoard, type LiveAgent } from '../shared/jev.js';

/**
 * One floor's Jev counts, in `.agent-office/jev-metrics.json`. Local JSON only: no TypeSafe,
 * no MCP, no API keys. What it writes is names and numbers, never a path or a secret.
 *
 * `agents` is the order on the board. `pending` is everyone compared so far, including agents
 * sent home. The board copies pending at local midnight, and the first time anyone is on it.
 */
export class JevStore {
  private agents: JevAgent[] = [];
  private pending: JevAgent[] = [];
  private rankedOn?: string;
  private file: string;

  constructor(dataDir: string) {
    this.file = path.join(dataDir, 'jev-metrics.json');
    const missing = !existsSync(this.file);
    const dropped = this.read();
    if (missing || dropped) this.save();
  }

  board(): JevBoard {
    return boardFrom(this.agents, this.rankedOn);
  }

  /** True when the published order is from before `day`, or has never been published. */
  due(day: string): boolean {
    return !this.rankedOn || this.rankedOn < day;
  }

  /**
   * Folds `live` into the comparison. The board changes when this is the first night with anyone
   * on it, or when `day` is after the night already published. Same-day counts wait for the next night.
   */
  observe(live: readonly LiveAgent[], day: string): boolean {
    if (!isLocalDay(day)) return false;
    this.pending = mergeAgents(this.pending, live);
    const publish = this.rankedOn ? this.rankedOn < day : this.pending.length > 0;
    if (publish) {
      this.agents = this.pending.map((a) => ({ ...a }));
      this.rankedOn = day;
    }
    if (publish || this.pending.length > 0) this.save();
    return publish;
  }

  /** Records more breakroom idle for one agent already on the board. The next night keeps it. */
  noteBreakroom(id: string, minutes: number): boolean {
    const published = this.bump(this.agents, id, minutes);
    this.bump(this.pending, id, minutes);
    if (!published) return false;
    this.save();
    return true;
  }

  private bump(list: JevAgent[], id: string, minutes: number): boolean {
    const i = list.findIndex((a) => a.id === id);
    if (i < 0) return false;
    list[i] = applyBreakroomIdle(list[i], minutes);
    return true;
  }

  /** True when an old sample board was dropped, so the file should be rewritten. */
  private read(): boolean {
    if (!existsSync(this.file)) return false;
    try {
      const raw = JSON.parse(readFileSync(this.file, 'utf8')) as { rankedOn?: unknown; agents?: unknown; pending?: unknown };
      const rankedOn = isLocalDay(raw.rankedOn) ? raw.rankedOn : undefined;
      const agents = agentsOf(raw.agents);
      const pending = Array.isArray(raw.pending) ? agentsOf(raw.pending) : agents;
      if (!rankedOn) {
        this.agents = agents.filter((a) => !JEV_STAND_INS.has(a.id));
        this.pending = pending.filter((a) => !JEV_STAND_INS.has(a.id));
        return agents.length > 0 || pending.length > 0;
      }
      this.agents = agents;
      this.pending = pending;
      this.rankedOn = rankedOn;
      return false;
    } catch {
      return false;
    }
  }

  private save() {
    try {
      const body = {
        ...(this.rankedOn ? { rankedOn: this.rankedOn } : {}),
        agents: this.agents.map(stored),
        pending: this.pending.map(stored),
      };
      writeFileSync(this.file, JSON.stringify(body, null, 2), { mode: 0o600 });
    } catch {
      // disk issues shouldn't take the office down
    }
  }
}

function agentsOf(raw: unknown): JevAgent[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(cleanAgent).filter((a): a is JevAgent => !!a);
}

function stored(a: JevAgent) {
  return { id: a.id, name: a.name, lines: a.lines, prs: a.prs, tasks: a.tasks, breakroomMinutes: a.breakroomMinutes, ...(a.deskId ? { deskId: a.deskId } : {}) };
}
