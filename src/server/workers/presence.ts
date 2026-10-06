// Shells have no agent hooks, so setStatus never hears that they are in the middle of something.
// Output from the terminal is that signal: a shell that is printing counts as working, and a few
// seconds of silence puts it back to idle. Agents stay on their hooks and on OSC progress
// (see lifecycle.ts and ProviderAdapter.screen). The desk laptops read the status this sets.
import { providerAdapter } from '../providers/index.js';
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
