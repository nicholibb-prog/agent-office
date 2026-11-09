// Routing log (funnel #18, §7): JSONL at <dataDir>/logs/routing/YYYY-MM-DD.jsonl (Mountain Time date),
// one line per attempt, owner-only (0600). Only whitelisted fields are written: never a prompt,
// payload, match or key. The log is private and is never sent to the cloud.
import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import type { ScanHit } from './types.js';

export interface RoutingLogEntry {
  ts: string;
  task_id: string;
  level: number;
  label: string;
  source: string;
  tier: string;
  provider: string;
  model: string;
  attempt: number;
  tokens_in: number;
  tokens_out: number;
  cost_usd: number;
  result: string;
  escalated_to: string | null;
  scan_hits: ScanHit[];
  latency_ms: number;
}

export const ROUTING_LOG_DIR = path.join('logs', 'routing');
const SHORT = (v: unknown, n = 80) => (typeof v === 'string' ? v.replace(/[\r\n\t]/g, ' ').slice(0, n) : '');
const NUM = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const TYPES = /^[A-Z_]{3,20}$/;

/** YYYY-MM-DD in America/Denver. */
export function mtDate(ms: number): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Denver', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
}

/** Only {type, sha8, offset_bucket}, re-checked, whatever the caller passed. */
export function cleanHits(hits: unknown): ScanHit[] {
  if (!Array.isArray(hits)) return [];
  return hits.flatMap((h) => {
    const x = h as Record<string, unknown>;
    if (typeof x?.type !== 'string' || !TYPES.test(x.type) || typeof x.sha8 !== 'string' || !/^[0-9a-f]{8}$/.test(x.sha8)) return [];
    return [{ type: x.type as ScanHit['type'], sha8: x.sha8, offset_bucket: Math.max(0, Math.floor(NUM(x.offset_bucket))) }];
  });
}

export function cleanEntry(e: Partial<RoutingLogEntry>): RoutingLogEntry {
  return {
    ts: SHORT(e.ts, 40),
    task_id: SHORT(e.task_id, 64),
    level: NUM(e.level),
    label: SHORT(e.label, 16),
    source: SHORT(e.source, 64),
    tier: SHORT(e.tier, 32),
    provider: SHORT(e.provider, 32),
    model: SHORT(e.model, 96),
    attempt: NUM(e.attempt),
    tokens_in: NUM(e.tokens_in),
    tokens_out: NUM(e.tokens_out),
    cost_usd: NUM(e.cost_usd),
    result: SHORT(e.result, 24),
    escalated_to: e.escalated_to ? SHORT(e.escalated_to, 32) : null,
    scan_hits: cleanHits(e.scan_hits),
    latency_ms: NUM(e.latency_ms),
  };
}

export type RoutingLogger = (e: Partial<RoutingLogEntry>) => void;

export function routingLogger(dataDir: string, now: () => number = Date.now): RoutingLogger {
  return (e) => {
    const at = now();
    const entry = cleanEntry({ ...e, ts: e.ts ?? new Date(at).toISOString() });
    const dir = path.join(dataDir, ROUTING_LOG_DIR);
    try {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      appendFileSync(path.join(dir, `${mtDate(at)}.jsonl`), JSON.stringify(entry) + '\n', { mode: 0o600 });
    } catch {
      // a full disk must not take routing down
    }
  };
}
