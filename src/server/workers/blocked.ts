// A worker stuck on a first-run or sign-in screen needs a person, until that screen moves on.
import { providerAdapter } from '../providers/index.js';
import type { WorkerStatus } from '../../shared/protocol.js';
import { screenText } from './terminal.js';
import type { Worker } from './types.js';

/** Flags `w` as needing a human while its screen is blocked, and clears that once the screen moves on. */
export function noteBlocked(w: Worker, setStatus: (status: WorkerStatus) => void) {
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
