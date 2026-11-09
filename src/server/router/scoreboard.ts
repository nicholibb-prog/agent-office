// Per-model score (funnel #35, #23): our own results by model and difficulty level, kept per MT
// month. A model under a 60% pass rate at a level (with enough samples) drops out of that level.
import { mtDate } from './routing-log.js';

export const MIN_PASS_RATE = 0.6;
export const MIN_SAMPLES = 5;

type Cell = { pass: number; total: number; toolOk: number; toolTotal: number };

export class Scoreboard {
  private months = new Map<string, Map<string, Cell>>();
  constructor(private now: () => number = Date.now) {}
  private month() { return mtDate(this.now()).slice(0, 7); }
  record(model: string, level: number, passed: boolean, tool?: { ok: boolean }) {
    const m = this.months.get(this.month()) ?? new Map<string, Cell>();
    const key = `${model}\u0000${level}`;
    const c = m.get(key) ?? { pass: 0, total: 0, toolOk: 0, toolTotal: 0 };
    c.total++;
    if (passed) c.pass++;
    if (tool) { c.toolTotal++; if (tool.ok) c.toolOk++; }
    m.set(key, c);
    this.months.set(this.month(), m);
  }
  rate(model: string, level: number): number | null {
    const c = this.months.get(this.month())?.get(`${model}\u0000${level}`);
    return c && c.total ? c.pass / c.total : null;
  }
  /** False once a model has ≥5 results this month at this level and passes under 60%. */
  allowed(model: string, level: number): boolean {
    const c = this.months.get(this.month())?.get(`${model}\u0000${level}`);
    return !c || c.total < MIN_SAMPLES || c.pass / c.total >= MIN_PASS_RATE;
  }
  table(): { month: string; model: string; level: number; passRate: number; samples: number; toolCallRate: number | null }[] {
    const month = this.month();
    return [...(this.months.get(month) ?? new Map()).entries()].map(([k, c]) => {
      const [model, level] = k.split('\u0000');
      return { month, model, level: Number(level), passRate: c.pass / c.total, samples: c.total, toolCallRate: c.toolTotal ? c.toolOk / c.toolTotal : null };
    });
  }
}
