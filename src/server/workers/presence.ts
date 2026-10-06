// Shells have no agent hooks, so setStatus never hears that they are in the middle of something.
// Output from the terminal is that signal: a shell that is printing counts as working, and a few
// seconds of silence puts it back to idle. Agents stay on their hooks and on OSC progress
// (see lifecycle.ts and ProviderAdapter.screen). The desk laptops read the status this sets.
import { providerAdapter } from '../providers/index.js';
import { clockWork } from './clock.js';
import { flushScreens, screenText } from './terminal.js';
import type { Worker, WorkerEvents } from './types.js';
import type { WorkerStatus } from '../../shared/protocol.js';

/** How long a shell can sit quiet before it counts as idle again. */
export const SHELL_QUIET_MS = 8000;

/**
 * A shell printed something. Remembers when, and says to mark it working when it was sitting still.
 * An agent is left alone: its hooks already call setStatus.
 */
export function noteShellOutput(w: Worker, now = Date.now()): WorkerStatus | undefined {
  if (w.info.kind !== 'shell') return;
  w.outputAt = now;
  const s = w.info.status;
  if (s === 'idle' || s === 'done' || s === 'starting') return 'working';
}

/** A working shell that has stopped printing. Undefined while it is still going, or it is not a shell. */
export function shellQuiet(w: Worker, now = Date.now()): WorkerStatus | undefined {
  if (w.info.kind !== 'shell' || w.info.status !== 'working') return;
  if (w.outputAt === undefined || now - w.outputAt < SHELL_QUIET_MS) return;
  return 'idle';
}

/**
 * An agent can sit at its prompt without being usable: Claude stuck on a first-run screen, or not
 * signed in on this machine (see ProviderAdapter.screen). Flag that as needing a human, and clear
 * it once the screen moves on.
 */
function checkBlocked(w: Worker, setStatus: (status: WorkerStatus) => void) {
  const blockedBy = w.info.kind === 'agent' ? providerAdapter(w.info.provider)?.screen?.blocked : undefined;
  if (!w.term || !blockedBy) return;
  const s = w.info.status;
  if (s !== 'starting' && s !== 'idle' && !(w.bootBlocked && s === 'needs_input')) return;
  // Only this run's output counts: a "Not logged in" in the scrollback from before is old news.
  const text = screenText(w.term, w.term.buffer.active.type === 'normal' ? Math.max(0, w.fresh?.line ?? 0) : 0);
  const blocked = blockedBy(text, s === 'starting' || !!w.bootBlocked);
  if (blocked && s !== 'needs_input') {
    w.bootBlocked = true;
    w.info.activity = blocked;
    setStatus('needs_input');
  } else if (!blocked && w.bootBlocked && s === 'needs_input') {
    w.bootBlocked = false;
    w.info.activity = undefined;
    setStatus('idle');
  }
}

/** What committing a status still asks the manager for: telling everyone, saving, and catching a new branch. */
export type StatusFx = {
  emit(): void;
  persist(): void;
  syncBranch(): void;
};

/**
 * Applies `status` to a worker: the worked-time clock, the waiting flag, then everyone hears it.
 * At rest, a branch it made this turn is picked up. Same status twice is a no-op.
 */
export function commitStatus(w: Worker, status: WorkerStatus, fx: StatusFx) {
  if (w.info.status === status) return;
  if (w.info.status === 'needs_input') w.leftNeedsInputAt = Date.now();
  clockWork(w.info, status);
  w.info.status = status;
  // Done, idle or asleep: it's not acting anything out any more.
  if (status !== 'working' && status !== 'needs_input') w.info.action = undefined;
  // Nobody is looking at the terminal right now -> raise the flag (the worker jumps). A worker at the
  // meeting table that ends its part is waiting on the meeting, not on anyone, so it stays quiet.
  if (status === 'done' || status === 'needs_input') {
    w.info.acked = status === 'done' && (w.viewers.size > 0 || !!w.info.meeting);
    w.info.waitingSince = Date.now();
  } else w.info.acked = true;
  fx.emit();
  // What a restarted office picks the worker back up as, should its terminal outlive this one.
  if (w.pty?.id || w.dsh) fx.persist();
  // At rest: it may have made a branch of its own this turn, and opened its PR from there.
  if (status === 'done' || status === 'idle') fx.syncBranch();
}

/** Copies who is watching a terminal onto the worker everyone else sees. False when nothing changed. */
export function syncViewerList(w: Worker): boolean {
  const names = [...new Set(w.viewers.values())];
  const ids = [...w.viewers.keys()];
  const same = (a: string[], b: string[]) => a.length === b.length && a.every((n, i) => n === b[i]);
  if (same(names, w.info.viewers) && same(ids, w.info.viewerIds)) return false;
  w.info.viewers = names;
  w.info.viewerIds = ids;
  return true;
}

/** Once a screen interval: shells that have gone quiet sit down, then screens that changed are sent. */
export function tickWorkers(
  workers: { values(): Iterable<Worker> },
  events: WorkerEvents,
  setStatus: (w: Worker, status: WorkerStatus) => void,
  now = Date.now(),
) {
  for (const w of workers.values()) {
    const next = shellQuiet(w, now);
    if (next) setStatus(w, next);
  }
  flushScreens(workers.values(), events, (w) => checkBlocked(w, (status) => setStatus(w, status)));
}
