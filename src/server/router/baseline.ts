// Baseline metric plan (funnel #5, #20): log current paid usage per task type before the switch
// (3 days), then savings % = (baseline cost/task × tasks − actual paid cost) ÷ (baseline × tasks),
// repair cost included in the actual. Files: <dataDir>/logs/routing/baseline-YYYY-MM-DD.jsonl.
import { appendFileSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { mtDate, ROUTING_LOG_DIR } from './routing-log.js';

export interface BaselineEntry { ts: string; task_type: string; provider: string; tokens_in: number; tokens_out: number; cost_usd: number }

const clean = (e: Partial<BaselineEntry>): BaselineEntry => ({
  ts: typeof e.ts === 'string' ? e.ts.slice(0, 40) : new Date().toISOString(),
  task_type: typeof e.task_type === 'string' ? e.task_type.replace(/[^\w-]/g, '').slice(0, 40) : 'unknown',
  provider: typeof e.provider === 'string' ? e.provider.replace(/[^\w-]/g, '').slice(0, 32) : '',
  tokens_in: Number.isFinite(e.tokens_in) ? Number(e.tokens_in) : 0,
  tokens_out: Number.isFinite(e.tokens_out) ? Number(e.tokens_out) : 0,
  cost_usd: Number.isFinite(e.cost_usd) ? Number(e.cost_usd) : 0,
});

export function logBaseline(dataDir: string, e: Partial<BaselineEntry>, now = Date.now()) {
  const dir = path.join(dataDir, ROUTING_LOG_DIR);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  appendFileSync(path.join(dir, `baseline-${mtDate(now)}.jsonl`), JSON.stringify(clean({ ts: new Date(now).toISOString(), ...e })) + '\n', { mode: 0o600 });
}

/** Average paid cost per task, by type, over every baseline file (one line = one task). */
export function baselinePerTask(dataDir: string): Record<string, { tasks: number; costPerTask: number }> {
  const dir = path.join(dataDir, ROUTING_LOG_DIR);
  const sum: Record<string, { tasks: number; cost: number }> = {};
  let files: string[] = [];
  try { files = readdirSync(dir).filter((f) => /^baseline-\d{4}-\d{2}-\d{2}\.jsonl$/.test(f)); } catch { return {}; }
  for (const f of files) {
    for (const line of readFileSync(path.join(dir, f), 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try {
        const e = clean(JSON.parse(line));
        const s = (sum[e.task_type] ??= { tasks: 0, cost: 0 });
        s.tasks++;
        s.cost += e.cost_usd;
      } catch { /* skip a torn line */ }
    }
  }
  return Object.fromEntries(Object.entries(sum).map(([k, v]) => [k, { tasks: v.tasks, costPerTask: v.cost / v.tasks }]));
}

/** Savings % (0-100; negative when we spent more). null when there is no baseline to compare with. */
export function savingsPct(baselineCostPerTask: number, tasks: number, actualPaidUsd: number, repairUsd = 0): number | null {
  const base = baselineCostPerTask * tasks;
  if (!(base > 0)) return null;
  return ((base - (actualPaidUsd + repairUsd)) / base) * 100;
}
