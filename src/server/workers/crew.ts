// A loopback report of whether the worker at a desk is working. Parked desks are left alone.
import type { WorkerStatus } from '../../shared/protocol.js';
import type { Worker } from './types.js';

/** A process is running at this desk. A parked offline worker has none. */
export function deskLive(w: Worker | undefined): boolean {
  return !!w && !!(w.pty || w.dsh);
}

/**
 * Working seats a live worker at the desk they already have. Idle clears WORKING and does not
 * touch a shell's own quiet timer. Offline, exited, or no process stays as it is.
 */
export function pushDeskStatus(
  w: Worker | undefined,
  status: 'working' | 'idle',
  setStatus: (w: Worker, status: WorkerStatus) => void,
): WorkerStatus | 'parked' | 'missing' {
  if (!w) return 'missing';
  const parked = w.info.status === 'offline' || w.info.status === 'exited' || !(w.pty || w.dsh);
  if (status === 'working') {
    if (parked) return 'parked';
    setStatus(w, 'working');
    return w.info.status;
  }
  if (w.info.status === 'working') {
    w.info.activity = undefined;
    setStatus(w, 'idle');
  }
  return w.info.status;
}
