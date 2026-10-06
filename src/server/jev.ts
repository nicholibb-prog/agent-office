import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { applyBreakroomIdle, boardFrom, cleanAgents, seedAgents, type JevAgent, type JevBoard } from '../shared/jev.js';

/**
 * One floor's Jev counts, in `.agent-office/jev-metrics.json`. Local JSON only: no TypeSafe,
 * no MCP, no API keys. What it writes is names and numbers, never a path or a secret.
 */
export class JevStore {
  private agents: JevAgent[];
  private file: string;

  constructor(dataDir: string) {
    this.file = path.join(dataDir, 'jev-metrics.json');
    const missing = !existsSync(this.file);
    this.agents = this.read();
    if (missing) this.save();
  }

  board(): JevBoard {
    return boardFrom(this.agents);
  }

  /** Records more breakroom idle for one agent already on the board. */
  noteBreakroom(id: string, minutes: number): boolean {
    const i = this.agents.findIndex((a) => a.id === id);
    if (i < 0) return false;
    this.agents[i] = applyBreakroomIdle(this.agents[i], minutes);
    this.save();
    return true;
  }

  private read(): JevAgent[] {
    if (!existsSync(this.file)) return seedAgents();
    try {
      return cleanAgents(JSON.parse(readFileSync(this.file, 'utf8')));
    } catch {
      return seedAgents();
    }
  }

  private save() {
    try {
      const agents = this.agents.map(({ id, name, lines, prs, tasks, breakroomMinutes, deskId }) => ({
        id,
        name,
        lines,
        prs,
        tasks,
        breakroomMinutes,
        ...(deskId ? { deskId } : {}),
      }));
      writeFileSync(this.file, JSON.stringify({ agents }, null, 2), { mode: 0o600 });
    } catch {
      // disk issues shouldn't take the office down
    }
  }
}
