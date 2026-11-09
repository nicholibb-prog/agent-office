// Job board (funnel #24, #25): a claim is a lease that expires after 20 minutes with no heartbeat.
// Okkin may claim only levels ≤2; free cloud only ≤4 and only public tasks. Self-sourced tasks come
// only from sources the owner approved (config/task-sources.json), at most `dailyCap` (60) a day.
import { readFileSync } from 'node:fs';
import { mtDate } from './routing-log.js';
import type { Label, Level } from './types.js';

export const LEASE_MS = 20 * 60_000;
export type Claimant = 'okkin' | 'free-cloud' | 'crew' | 'grok-dan' | 'owner';

export interface BoardTask { id: string; level: Level; label: Label; gated?: boolean }
interface Lease { by: Claimant; worker: string; heartbeat: number }

export function mayClaim(by: Claimant, t: BoardTask): boolean {
  if (by === 'okkin') return t.level <= 2 && !t.gated;
  if (by === 'free-cloud') return t.level <= 4 && t.label === 'public' && !t.gated;
  return true;
}

export class JobBoard {
  private leases = new Map<string, Lease>();
  constructor(private now: () => number = Date.now) {}
  private live(id: string): Lease | undefined {
    const l = this.leases.get(id);
    if (l && this.now() - l.heartbeat > LEASE_MS) { this.leases.delete(id); return undefined; }
    return l;
  }
  claim(t: BoardTask, by: Claimant, worker: string): boolean {
    if (!mayClaim(by, t) || this.live(t.id)) return false;
    this.leases.set(t.id, { by, worker, heartbeat: this.now() });
    return true;
  }
  heartbeat(id: string, worker: string): boolean {
    const l = this.live(id);
    if (!l || l.worker !== worker) return false;
    l.heartbeat = this.now();
    return true;
  }
  release(id: string, worker: string) {
    if (this.live(id)?.worker === worker) this.leases.delete(id);
  }
  holder(id: string): string | undefined { return this.live(id)?.worker; }
}

export interface TaskSources { dailyCap: number; sources: string[] }
export function loadTaskSources(file = 'config/task-sources.json'): TaskSources {
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as { dailyCap?: unknown; sources?: unknown };
    const cap = typeof raw.dailyCap === 'number' && raw.dailyCap >= 0 ? Math.min(raw.dailyCap, 60) : 0;
    const sources = Array.isArray(raw.sources) ? raw.sources.filter((s): s is string => typeof s === 'string') : [];
    return { dailyCap: cap, sources };
  } catch {
    return { dailyCap: 0, sources: [] };
  }
}

export class SelfSource {
  private day = '';
  private count = 0;
  constructor(private cfg: TaskSources, private now: () => number = Date.now) {}
  /** May a bot add a task it found itself from this source? Counts it when yes. */
  admit(source: string): boolean {
    const d = mtDate(this.now());
    if (d !== this.day) { this.day = d; this.count = 0; }
    if (!this.cfg.sources.includes(source) || this.count >= this.cfg.dailyCap) return false;
    this.count++;
    return true;
  }
}
