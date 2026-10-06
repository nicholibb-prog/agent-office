// What an idle hired worker may do. Productivity wins: WORKING and Needs-Nick never wander off into play.
// Roam and ball belong to the presence work. This module only decides that they are allowed;
// the huddle performs the meeting act.

import type { WorkerStatus } from './protocol/workers.js';

export type IdleAct = 'roam' | 'meeting' | 'ball';

export interface IdleWorker {
  status: WorkerStatus;
  /** False while a finished turn is still waiting on a person. */
  acked: boolean;
}

/** WORKING, still starting, or Needs-Nick (a question, or a finished turn nobody has looked at). */
export function productivityBlocks(w: IdleWorker): boolean {
  if (w.status === 'working' || w.status === 'starting') return true;
  if (w.status === 'needs_input') return true;
  if (w.status === 'done' && !w.acked) return true;
  return false;
}

/** Offline and exited workers are not in the office. Don't treat them as present. */
export function presentToAct(w: { status: WorkerStatus }): boolean {
  return w.status !== 'offline' && w.status !== 'exited';
}

/** Empty when productivity wins. Otherwise the idle acts presence and the huddle share. */
export function allowedIdleActs(w: IdleWorker): IdleAct[] {
  if (!presentToAct(w) || productivityBlocks(w)) return [];
  return ['roam', 'meeting', 'ball'];
}
