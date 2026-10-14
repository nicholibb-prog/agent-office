// Kill switch + daily paid cap (funnel #1) and the fix-up tax (#10).
// Paid = DeepSeek and the paid crew (ForgeL, PolishL, Grok crew). Day boundaries are MT midnight.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { mtDate } from './routing-log.js';
import type { RouterEnv } from './flags.js';

export const PAID_PROVIDERS = new Set(['deepseek', 'forgel', 'polishl', 'grok-crew']);
export const DEFAULT_CAP_USD = 3;
export const KILL_FILE = 'router-kill';

export type BudgetAlert = { kind: 'cap-80' | 'cap-100'; day: string; spentUsd: number; capUsd: number };

export function capFromEnv(env: RouterEnv): number {
  const v = Number(env.PAID_DAILY_CAP_USD);
  return Number.isFinite(v) && v >= 0 && env.PAID_DAILY_CAP_USD?.trim() ? v : DEFAULT_CAP_USD;
}

export class Budget {
  private day = '';
  private spent = 0;
  private alerted = new Set<string>();
  constructor(
    private opts: { capUsd: number; env?: RouterEnv; dataDir?: string; now?: () => number; alert?: (a: BudgetAlert) => void },
  ) {}
  private roll() {
    const d = mtDate((this.opts.now ?? Date.now)());
    if (d !== this.day) { this.day = d; this.spent = 0; this.alerted.clear(); }
  }
  /** ROUTER_KILL=1, or a <dataDir>/router-kill file containing "1" (the office toggle writes it). */
  killed(): boolean {
    if ((this.opts.env ?? process.env).ROUTER_KILL === '1') return true;
    if (!this.opts.dataDir) return false;
    const f = path.join(this.opts.dataDir, KILL_FILE);
    try { return existsSync(f) && readFileSync(f, 'utf8').trim() === '1'; } catch { return true; }
  }
  spentToday() { this.roll(); return this.spent; }
  get capUsd() { return this.opts.capUsd; }
  spend(usd: number) {
    this.roll();
    if (!(usd > 0)) return;
    this.spent += usd;
    const cap = this.opts.capUsd;
    for (const [kind, frac] of [['cap-80', 0.8], ['cap-100', 1]] as const) {
      if (this.spent >= cap * frac && !this.alerted.has(kind)) {
        this.alerted.add(kind);
        this.opts.alert?.({ kind, day: this.day, spentUsd: this.spent, capUsd: cap });
      }
    }
  }
  /** May a paid call go out now? The kill switch stops everything; Dan security tasks pass the cap only. */
  allowed(opts: { danSecurity?: boolean } = {}): boolean {
    if (this.killed()) return false;
    this.roll();
    if (this.spent < this.opts.capUsd) return true;
    return !!opts.danSecurity;
  }
}

/** Per task type: paid repair cost vs paid direct cost. >50% two MT days running stops free routing. */
export class FixupTax {
  private days = new Map<string, Map<string, { repair: number; direct: number }>>();
  private stopped = new Set<string>();
  constructor(private now: () => number = Date.now) {}
  record(type: string, repairUsd: number, directUsd: number) {
    const d = mtDate(this.now());
    const m = this.days.get(type) ?? new Map();
    const cur = m.get(d) ?? { repair: 0, direct: 0 };
    cur.repair += Math.max(0, repairUsd);
    cur.direct += Math.max(0, directUsd);
    m.set(d, cur);
    this.days.set(type, m);
    const recent = [...m.entries()].sort(([a], [b]) => (a < b ? 1 : -1)).slice(0, 2);
    const consecutive = recent.length === 2 && Date.parse(recent[0][0]) - Date.parse(recent[1][0]) === 86_400_000;
    if (consecutive && recent.every(([, v]) => v.direct > 0 && v.repair / v.direct > 0.5)) this.stopped.add(type);
  }
  freeAllowed(type: string | undefined): boolean {
    return !type || !this.stopped.has(type);
  }
}
