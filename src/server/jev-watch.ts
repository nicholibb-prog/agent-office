import path from 'node:path';
import { finishedTasks, localDay, pullRequestsOf, type JevBoard, type LiveAgent } from '../shared/jev.js';
import { JevStore } from './jev.js';
import { gitAddedLines } from './jev-lines.js';

// Recounts every hired agent through the day, and publishes the board when the local night rolls.
// The office calls this once per floor. It never imports the floor.

const CHECK_MS = 30_000;
/** How often lines are read again on a night that is already on the board. */
const COUNT_MS = 5 * 60_000;

/** What one floor can tell the board about its workers. Paths stay here; the board stores names and numbers. */
export interface AgentFloor {
  dir: string;
  workers: { list(): readonly AgentWorker[] };
  queue: { state(): { tasks: readonly { workerId?: string; status: string; outcome?: string }[] } };
}

interface AgentWorker {
  id: string;
  name: string;
  kind: string;
  deskId: string;
  status: string;
  task?: { name: string };
  pr?: unknown;
  pastPrs?: readonly unknown[];
  worktree?: { path: string; base: string };
  repos?: readonly { path: string; base: string; pr?: unknown }[];
}

/** Every hired agent on the floor, with lines from its own worktrees. A shell is left out. */
export async function agentsOnFloor(floor: AgentFloor, countLines: (cwd: string, base: string) => Promise<number | undefined> = gitAddedLines): Promise<LiveAgent[]> {
  const tasks = floor.queue.state().tasks;
  const out: LiveAgent[] = [];
  for (const w of floor.workers.list()) {
    if (w.kind !== 'agent') continue;
    const spots: { cwd: string; base: string }[] = [];
    if (w.worktree?.path && w.worktree.base) spots.push({ cwd: path.join(floor.dir, w.worktree.path), base: w.worktree.base });
    for (const repo of w.repos ?? []) if (repo.path && repo.base) spots.push({ cwd: path.join(floor.dir, repo.path), base: repo.base });
    let lines: number | undefined;
    if (!spots.length) lines = 0;
    else {
      let sum = 0;
      let any = false;
      for (const spot of spots) {
        const n = await countLines(spot.cwd, spot.base);
        if (n === undefined) continue;
        any = true;
        sum += n;
      }
      if (any) lines = Math.min(1_000_000, sum);
    }
    out.push({
      id: w.id,
      name: w.name,
      deskId: w.deskId,
      lines,
      prs: pullRequestsOf(w),
      tasks: finishedTasks(w.id, tasks, { status: w.status, hasTask: !!w.task?.name }),
    });
  }
  return out;
}

export interface JevWatch {
  /** Looks again now: recounts when a night is due, or when the last count is old. */
  roll(): Promise<void>;
  stop(): void;
}

/**
 * Keeps one floor's board. The first time agents are on the floor it publishes them, then the
 * order stays until the next local midnight (and a start that missed that midnight).
 */
export function watchJev(store: JevStore, opts: {
  load: () => Promise<LiveAgent[]>;
  emit: (board: JevBoard) => void;
  now?: () => Date;
  checkMs?: number;
  countMs?: number;
}): JevWatch {
  let stopped = false;
  let lastCount = 0;
  let running: Promise<void> | undefined;
  const roll = (): Promise<void> => {
    if (stopped) return Promise.resolve();
    if (running) return running;
    running = (async () => {
      const day = localDay(opts.now?.() ?? new Date());
      const due = store.due(day);
      if (!due && Date.now() - lastCount < (opts.countMs ?? COUNT_MS)) return;
      try {
        const live = await opts.load();
        if (stopped) return;
        lastCount = Date.now();
        if (store.observe(live, day)) opts.emit(store.board());
      } catch {
        // last night's order stays up
      }
    })().finally(() => {
      running = undefined;
    });
    return running;
  };
  const timer = setInterval(() => void roll(), opts.checkMs ?? CHECK_MS);
  timer.unref?.();
  void roll();
  return {
    roll,
    stop() {
      stopped = true;
      clearInterval(timer);
    },
  };
}
