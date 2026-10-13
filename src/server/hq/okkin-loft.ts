// Okkin's loft config: which installed models the dial may offer, their tuning, best use, and the
// idle auto-sleep. Read from `<dataDir>/okkin-loft.json` (gitignored data dir). No model list lives
// in code: the dial offers config ∩ /api/tags. docs/okkin-loft.example.json has the shape, with
// UNVERIFIED example values only.
import { existsSync, readFileSync } from 'node:fs';
import { freemem } from 'node:os';
import path from 'node:path';
import { modelTagOk } from '../../shared/hq.js';

export const LOFT_FILE = 'okkin-loft.json';

export type LoftModel = { tag: string; role: string; bestFor: string[]; num_ctx?: number; keep_alive?: string | number; minFreeRamGB?: number };
export type LoftConfig = { models: LoftModel[]; idleSleepMin: number | null };

export function parseLoftConfig(raw: unknown): LoftConfig {
  const out: LoftConfig = { models: [], idleSleepMin: null };
  if (!raw || typeof raw !== 'object') return out;
  const r = raw as { models?: unknown; idleSleepMin?: unknown };
  if (typeof r.idleSleepMin === 'number' && Number.isInteger(r.idleSleepMin) && r.idleSleepMin >= 5 && r.idleSleepMin <= 1440) out.idleSleepMin = r.idleSleepMin;
  if (!Array.isArray(r.models)) return out;
  for (const m of r.models.slice(0, 16)) {
    if (!m || typeof m !== 'object') continue;
    const x = m as Record<string, unknown>;
    const tag = typeof x.tag === 'string' ? x.tag.trim() : '';
    if (!modelTagOk(tag) || out.models.some((o) => o.tag === tag)) continue;
    const model: LoftModel = {
      tag,
      role: typeof x.role === 'string' ? x.role.slice(0, 24) : '',
      bestFor: Array.isArray(x.bestFor) ? x.bestFor.filter((b): b is string => typeof b === 'string').map((b) => b.slice(0, 24)).slice(0, 8) : [],
    };
    if (typeof x.num_ctx === 'number' && Number.isInteger(x.num_ctx) && x.num_ctx > 0 && x.num_ctx <= 1_048_576) model.num_ctx = x.num_ctx;
    if ((typeof x.keep_alive === 'string' && /^-?\d+(ms|s|m|h)?$/.test(x.keep_alive)) || (typeof x.keep_alive === 'number' && Number.isFinite(x.keep_alive))) model.keep_alive = x.keep_alive as string | number;
    if (typeof x.minFreeRamGB === 'number' && x.minFreeRamGB > 0 && x.minFreeRamGB < 4096) model.minFreeRamGB = x.minFreeRamGB;
    out.models.push(model);
  }
  return out;
}

export function loadLoftConfig(dataDir: string): LoftConfig {
  const file = path.join(dataDir, LOFT_FILE);
  try {
    if (!existsSync(file)) return parseLoftConfig(null);
    return parseLoftConfig(JSON.parse(readFileSync(file, 'utf8')));
  } catch {
    return parseLoftConfig(null);
  }
}

/** The dial's stops: config order, kept only when /api/tags has the exact tag. */
export function dialStops(config: LoftConfig, installed: readonly string[]): LoftModel[] {
  const have = new Set(installed);
  return config.models.filter((m) => have.has(m.tag));
}

/** A model gated on free RAM may only be picked when the box has that much free right now. */
export function ramAllows(model: LoftModel | undefined, freeBytes = freemem()): boolean {
  if (!model?.minFreeRamGB) return true;
  return freeBytes / 1024 ** 3 >= model.minFreeRamGB;
}

/** Rule-based: the first dial stop whose bestFor names the job type, else the `default` role, else none. */
export function bestModelFor(job: string, stops: readonly LoftModel[]): LoftModel | null {
  const j = job.trim().toLowerCase();
  return stops.find((m) => m.bestFor.map((b) => b.toLowerCase()).includes(j)) ?? stops.find((m) => m.role === 'default') ?? null;
}
