// The narrow handle a provider adapter is given of one worker (see WorkerHandle).
import type { WorkerStatus } from '../../shared/protocol.js';
import type { Worker, WorkerHandle } from './types.js';

export type HandleOps = {
  setStatus(w: Worker, status: WorkerStatus): void;
  emit(w: Worker): void;
  persist(): void;
  notePrompt(w: Worker, prompt: string): void;
  noteTool(w: Worker, tool: string): void;
  notePr(w: Worker, command: unknown, output: string): void;
  clearTask(w: Worker): void;
  scheduleScan(w: Worker): void;
  prompt(id: string, text: string): string | undefined;
};

/** Built once and kept on the worker. */
export function workerHandle(w: Worker, ops: HandleOps): WorkerHandle {
  return (w.handle ??= {
    get info() {
      return w.info;
    },
    get state() {
      return w.state;
    },
    get running() {
      return !!w.pty;
    },
    get bootBlocked() {
      return !!w.bootBlocked;
    },
    set bootBlocked(v) {
      w.bootBlocked = v;
    },
    get leftNeedsInputAt() {
      return w.leftNeedsInputAt;
    },
    set leftNeedsInputAt(v) {
      w.leftNeedsInputAt = v;
    },
    get failStreak() {
      return w.failStreak;
    },
    set failStreak(v) {
      w.failStreak = v;
    },
    get tracker() {
      return w.tracker;
    },
    get pendingPrompt() {
      return w.pendingPrompt;
    },
    set pendingPrompt(v) {
      w.pendingPrompt = v;
    },
    setStatus: (status) => ops.setStatus(w, status),
    emit: () => ops.emit(w),
    persist: () => ops.persist(),
    notePrompt: (prompt) => ops.notePrompt(w, prompt),
    noteTool: (tool) => ops.noteTool(w, tool),
    notePr: (command, output) => ops.notePr(w, command, output),
    clearTask: () => ops.clearTask(w),
    scheduleScan: () => ops.scheduleScan(w),
    prompt: (text) => ops.prompt(w.info.id, text),
  });
}
