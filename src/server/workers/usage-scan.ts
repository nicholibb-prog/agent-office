// Reads a worker's session log and books the spend since the last scan.
import { providerAdapter } from '../providers/index.js';
import { addUsage, scanTracker, trackerUsage, zeroUsage, type Ledger } from '../usage.js';
import type { Worker, WorkerHandle } from './types.js';

export function scanWorkerUsage(w: Worker, workers: Map<string, Worker>, ledger: Ledger, handleOf: (w: Worker) => WorkerHandle, emit: (w: Worker) => void, persist: () => void) {
  const usage = w.info.kind === 'agent' ? providerAdapter(w.info.provider)?.usage : undefined;
  if (usage?.scan) {
    if (workers.get(w.info.id) === w) usage.scan(handleOf(w));
    return;
  }
  if (!usage?.transcript || !w.tracker.transcript || workers.get(w.info.id) !== w) return;
  try {
    if (!scanTracker(w.tracker)) return;
  } catch {
    return;
  }
  const before = w.info.usage ?? zeroUsage();
  const after = trackerUsage(w.tracker);
  w.info.usage = after;
  ledger.add(addUsage(after, before, -1));
  emit(w);
  persist();
}
