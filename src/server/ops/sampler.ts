// One sampler per process. Routes read its latest snapshot and never re-run adapters.
import { appendFileSync, chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, unlinkSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  METRICS,
  downsample,
  historyNumbers,
  isMetric,
  mtDate,
  shiftDay,
  type Metric,
  type OpsTile,
} from '../../shared/ops.js';
import { capFromEnv } from '../router/budget.js';
import { readRouterFlags } from '../router/flags.js';
import { ADAPTERS, defaultPs, type OpsAdapter, type OpsEnv, type OpsMem } from './adapters.js';

const BUDGET_MS = 2000;
const HISTORY_CAP_BYTES = 50 * 1024 * 1024;
const DAY_FILE = /^\d{4}-\d{2}-\d{2}\.jsonl$/;

export interface OpsConfig {
  on: boolean;
  sampleSec: number;
  historyDays: number;
  crewRouterHome?: string;
  notionLoopLog?: string;
}

export interface OpsHost {
  cfg: { dataDir: string };
  building?: { list(): { dir: string }[] };
}

export interface SamplerOpts {
  env?: NodeJS.ProcessEnv;
  now?: () => number;
  periodSec?: number;
  adapters?: OpsAdapter[];
  log?: (message: string) => void;
  ps?: OpsEnv['ps'];
  mem?: () => OpsMem;
  /** Default true: sample once, then on the interval. Tests pass false and call opsTick. */
  auto?: boolean;
}

interface Active {
  tick(): Promise<void>;
  stop(): void;
  latest: { sampledAt: number; tiles: Record<string, OpsTile> } | null;
  periodSec: number;
  historyDays: number;
  dataDir: string;
  skipped: number;
}

interface CacheEntry {
  mtimeMs: number;
  size: number;
  rows: { t: number; values: Partial<Record<Metric, number>> }[];
}

const historyCache = new Map<string, CacheEntry>();
const bags = new WeakMap<object, Active>();

export function readOpsConfig(env: NodeJS.ProcessEnv): OpsConfig {
  const sample = Number(env.OPS_SAMPLE_SEC);
  const days = Number(env.OPS_HISTORY_DAYS);
  const home = env.OPS_CREW_ROUTER_HOME?.trim();
  const loop = env.OPS_NOTION_LOOP_LOG?.trim();
  return {
    on: env.OPS_ON === '1',
    sampleSec: Number.isFinite(sample) && sample > 0 ? Math.min(900, Math.max(15, Math.round(sample))) : 60,
    historyDays: Number.isFinite(days) && days > 0 ? Math.min(180, Math.max(1, Math.round(days))) : 30,
    ...(home ? { crewRouterHome: home } : {}),
    ...(loop ? { notionLoopLog: loop } : {}),
  };
}

export function opsBag(ctx: object): Active | undefined {
  return bags.get(ctx);
}

export async function opsTick(ctx: object): Promise<void> {
  await bags.get(ctx)?.tick();
}

export function opsSkipped(ctx: object): number {
  return bags.get(ctx)?.skipped ?? 0;
}

function remember(key: string, entry: CacheEntry) {
  if (!historyCache.has(key) && historyCache.size >= 40) {
    const first = historyCache.keys().next().value;
    if (first) historyCache.delete(first);
  }
  historyCache.set(key, entry);
}

function inside(real: string, root: string): boolean {
  return real === root || real.startsWith(root + path.sep);
}

function historyDir(dataDir: string, logOnce: () => void): string | null {
  const ops = path.join(dataDir, 'ops');
  const dir = path.join(ops, 'history');
  try {
    if (existsSync(ops) && lstatSync(ops).isSymbolicLink()) {
      logOnce();
      return null;
    }
    if (existsSync(dir) && lstatSync(dir).isSymbolicLink()) {
      logOnce();
      return null;
    }
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
    if (lstatSync(dir).isSymbolicLink() || lstatSync(ops).isSymbolicLink()) {
      logOnce();
      return null;
    }
    const realData = realpathSync(dataDir);
    const realOps = realpathSync(ops);
    const realDir = realpathSync(dir);
    if (realDir !== path.join(realOps, 'history') || !inside(realDir, realData)) {
      logOnce();
      return null;
    }
    chmodSync(ops, 0o700);
    chmodSync(dir, 0o700);
    return dir;
  } catch {
    logOnce();
    return null;
  }
}

function prune(dir: string, today: string, days: number) {
  const realDir = realpathSync(dir);
  const cutoff = shiftDay(today, -days);
  const kept: { full: string; size: number }[] = [];
  for (const name of readdirSync(dir).filter((item) => DAY_FILE.test(item)).sort()) {
    const full = path.join(dir, name);
    try {
      if (lstatSync(full).isSymbolicLink()) continue;
      const real = realpathSync(full);
      if (!inside(real, realDir)) continue;
      const st = statSync(real);
      if (!st.isFile()) continue;
      if (name.slice(0, 10) < cutoff) {
        unlinkSync(full);
        continue;
      }
      kept.push({ full, size: st.size });
    } catch {
      /* leave a name we cannot prove */
    }
  }
  let total = kept.reduce((sum, file) => sum + file.size, 0);
  for (const file of kept) {
    if (total <= HISTORY_CAP_BYTES) break;
    try {
      unlinkSync(file.full);
      total -= file.size;
    } catch {
      /* the next sample can try again */
    }
  }
}

function appendHistory(dir: string, now: number, tiles: Record<string, OpsTile>, days: number, lastDay: { value: string }) {
  const day = mtDate(now);
  if (day !== lastDay.value) {
    lastDay.value = day;
    prune(dir, day, days);
  }
  const row: Record<string, number> = { t: now };
  const nums = historyNumbers(tiles);
  for (const metric of METRICS) {
    const value = nums[metric];
    if (typeof value === 'number' && Number.isFinite(value)) row[metric] = value;
  }
  const file = path.join(dir, `${day}.jsonl`);
  if (existsSync(file) && lstatSync(file).isSymbolicLink()) return;
  appendFileSync(file, JSON.stringify(row) + '\n', { mode: 0o600 });
  chmodSync(file, 0o600);
}

function withBudget(adapter: OpsAdapter, env: OpsEnv): Promise<OpsTile> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<OpsTile>((resolve) => {
    timer = setTimeout(() => resolve({ id: adapter.id, state: 'not-wired', reason: 'timed out' }), BUDGET_MS);
  });
  return Promise.race([
    adapter.run(env).then((tile) => ({ ...tile, id: adapter.id }), () => ({ id: adapter.id, state: 'not-wired' as const, reason: 'failed' })),
    timeout,
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function liveMem(): OpsMem {
  return { total: os.totalmem(), free: os.freemem(), load: os.loadavg(), rss: process.memoryUsage().rss };
}

/** Read history off disk. Repeated polls reuse a file+mtime cache. At most 31 day files, then ≤ 500 points. */
export function readOpsHistory(dataDir: string, metric: Metric, since: number, now: number): [number, number][] {
  const dir = path.join(dataDir, 'ops', 'history');
  let names: string[] = [];
  try {
    if (!existsSync(dir) || lstatSync(dir).isSymbolicLink()) return [];
    const realData = realpathSync(dataDir);
    const realDir = realpathSync(dir);
    if (!inside(realDir, realData)) return [];
    names = readdirSync(dir);
  } catch {
    return [];
  }
  const sinceDay = mtDate(since);
  const nowDay = mtDate(now);
  const picked = names
    .filter((name) => DAY_FILE.test(name) && name.slice(0, 10) >= sinceDay && name.slice(0, 10) <= nowDay)
    .sort()
    .slice(-31);
  const points: [number, number][] = [];
  for (const name of picked) {
    const file = path.join(dir, name);
    let st;
    try {
      if (lstatSync(file).isSymbolicLink()) continue;
      const real = realpathSync(file);
      if (!inside(real, realpathSync(dir))) continue;
      st = statSync(real);
      if (!st.isFile()) continue;
    } catch {
      continue;
    }
    const key = `${file}:${metric}`;
    const hit = historyCache.get(key);
    let rows = hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size ? hit.rows : null;
    if (!rows) {
      rows = [];
      let text = '';
      try {
        text = readFileSync(file, 'utf8');
      } catch {
        text = '';
      }
      for (const line of text.split('\n')) {
        if (!line.trim()) continue;
        try {
          const row = JSON.parse(line) as Record<string, unknown>;
          const t = row.t;
          if (typeof t !== 'number' || !Number.isFinite(t)) continue;
          const values: Partial<Record<Metric, number>> = {};
          for (const item of METRICS) {
            const value = row[item];
            if (typeof value === 'number' && Number.isFinite(value)) values[item] = value;
          }
          rows.push({ t, values });
        } catch {
          /* skip a torn line */
        }
      }
      remember(key, { mtimeMs: st.mtimeMs, size: st.size, rows });
    }
    for (const row of rows) {
      const value = row.values[metric];
      if (row.t >= since && row.t <= now && typeof value === 'number') points.push([row.t, value]);
    }
  }
  points.sort((a, b) => a[0] - b[0]);
  return downsample(points, 500);
}

/** Start the shared sampler. Unset OPS_ON returns a no-op and does not sample. */
export function startOpsSampler(ctx: OpsHost, opts: SamplerOpts = {}): () => void {
  const env = opts.env ?? process.env;
  const config = readOpsConfig(env);
  if (!config.on) return () => {};
  bags.get(ctx)?.stop();
  const now = opts.now ?? Date.now;
  const adapters = opts.adapters ?? ADAPTERS;
  const periodSec = opts.periodSec ?? config.sampleSec;
  let running = false;
  let stopped = false;
  let logged = false;
  let timer: NodeJS.Timeout | undefined;
  const lastDay = { value: '' };
  const logOnce = () => {
    if (logged) return;
    logged = true;
    (opts.log ?? ((message: string) => console.error(message)))('ops history dir refused');
  };
  const sampler: Active = {
    latest: null,
    periodSec,
    historyDays: config.historyDays,
    dataDir: ctx.cfg.dataDir,
    skipped: 0,
    stop() {
      stopped = true;
      if (timer) clearInterval(timer);
    },
    async tick() {
      if (stopped) return;
      if (running) {
        sampler.skipped += 1;
        return;
      }
      running = true;
      try {
        const flags = readRouterFlags(env);
        const source: OpsEnv = {
          dataDir: ctx.cfg.dataDir,
          floorDirs: (ctx.building?.list() ?? []).map((floor) => path.join(floor.dir, '.agent-office')),
          ...(config.crewRouterHome ? { crewRouterHome: config.crewRouterHome } : {}),
          ...(config.notionLoopLog ? { notionLoopLog: config.notionLoopLog } : {}),
          routerOn: flags.routerOn,
          capUsd: capFromEnv(env),
          now: now(),
          ps: opts.ps ?? defaultPs,
          mem: opts.mem ? opts.mem() : liveMem(),
        };
        const tiles: Record<string, OpsTile> = {};
        const rows = await Promise.all(adapters.map((adapter) => withBudget(adapter, source)));
        for (const tile of rows) tiles[tile.id] = tile;
        sampler.latest = { sampledAt: source.now, tiles };
        const dir = historyDir(ctx.cfg.dataDir, logOnce);
        if (dir) appendHistory(dir, source.now, tiles, config.historyDays, lastDay);
      } catch {
        if (opts.log) opts.log('ops sample failed');
      } finally {
        running = false;
      }
    },
  };
  bags.set(ctx, sampler);
  if (opts.auto !== false) {
    void sampler.tick();
    timer = setInterval(() => void sampler.tick(), periodSec * 1000);
    timer.unref();
  }
  return () => {
    if (timer) clearInterval(timer);
    sampler.stop();
    if (bags.get(ctx) === sampler) bags.delete(ctx);
  };
}

export function parseSince(raw: string | null, now: number, historyDays: number): number | 'bad' {
  const min = now - historyDays * 86_400_000;
  let since = now - 7 * 86_400_000;
  if (raw !== null && raw !== '') {
    const parsed = /^-?\d+$/.test(raw) ? Number(raw) : Date.parse(raw);
    if (!Number.isFinite(parsed)) return 'bad';
    since = parsed;
  }
  return since < min ? min : since;
}

export function historyMetric(raw: string | null): Metric | null {
  return raw && isMetric(raw) ? raw : null;
}
