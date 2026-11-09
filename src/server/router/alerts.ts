// Alert noise (funnel §7, #39): the owner is alerted only for 80%/100% of the cap, a P0 failure, a
// secret-scan block, or a provider down for more than an hour. Everything else waits for the
// daily digest at 8 PM MT. Alerts carry IDs, types and counts only, never values.
import { mtClock } from './peak.js';
import { mtDate } from './routing-log.js';

export type AlertKind = 'cap-80' | 'cap-100' | 'p0-failure' | 'scan-block' | 'provider-down';
export const IMMEDIATE: ReadonlySet<string> = new Set<AlertKind>(['cap-80', 'cap-100', 'p0-failure', 'scan-block', 'provider-down']);
export const DIGEST_HOUR_MT = 20;
export const PROVIDER_DOWN_MS = 3_600_000;

export interface Alert { kind: string; taskId?: string; provider?: string; types?: string[]; count?: number }

export class AlertGate {
  private digest: Alert[] = [];
  private lastDigestDay = '';
  private downSince = new Map<string, number>();
  private downAlerted = new Set<string>();
  private scanAlerted = new Set<string>();
  constructor(private send: (a: Alert | { kind: 'digest'; items: number; byKind: Record<string, number> }) => void, private now: () => number = Date.now) {}
  push(a: Alert) {
    const safe: Alert = { kind: a.kind, taskId: a.taskId, provider: a.provider, types: a.types, count: a.count };
    if (a.kind === 'scan-block') {
      // Once per task.
      if (a.taskId && this.scanAlerted.has(a.taskId)) return;
      if (a.taskId) this.scanAlerted.add(a.taskId);
    }
    if (IMMEDIATE.has(a.kind)) this.send(safe);
    else this.digest.push(safe);
  }
  /** Feed the breaker's open set; a provider continuously down for an hour alerts once. */
  providers(open: string[]) {
    const t = this.now();
    for (const p of open) if (!this.downSince.has(p)) this.downSince.set(p, t);
    for (const p of [...this.downSince.keys()]) if (!open.includes(p)) { this.downSince.delete(p); this.downAlerted.delete(p); }
    for (const [p, since] of this.downSince) {
      if (t - since > PROVIDER_DOWN_MS && !this.downAlerted.has(p)) {
        this.downAlerted.add(p);
        this.push({ kind: 'provider-down', provider: p });
      }
    }
  }
  /** Call every few minutes: at/after 8 PM MT, once a day, the digest goes out. */
  tick() {
    const t = this.now();
    const day = mtDate(t);
    if (mtClock(t).hour < DIGEST_HOUR_MT || day === this.lastDigestDay) return;
    this.lastDigestDay = day;
    const byKind: Record<string, number> = {};
    for (const a of this.digest) byKind[a.kind] = (byKind[a.kind] ?? 0) + 1;
    this.send({ kind: 'digest', items: this.digest.length, byKind });
    this.digest = [];
  }
}
