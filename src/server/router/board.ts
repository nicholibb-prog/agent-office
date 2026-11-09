// Office board numbers (funnel #19): spend today vs the cap, % routed free, caps left per provider,
// failures and the queue, from today's routing log only. Counts and names, never task text.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { PAID_PROVIDERS } from './budget.js';
import { INITIAL_LIMITS } from './cap-ledger.js';
import { cleanEntry, mtDate, ROUTING_LOG_DIR } from './routing-log.js';
import type { RouterBoard } from '../../shared/router-board.js';

export function boardFromLog(dataDir: string, capUsd: number, now = Date.now(), live?: Record<string, { reqLeftToday: number }>): RouterBoard {
  const day = mtDate(now);
  let lines: string[] = [];
  try { lines = readFileSync(path.join(dataDir, ROUTING_LOG_DIR, `${day}.jsonl`), 'utf8').split('\n'); } catch { /* no routing yet today */ }
  let spent = 0;
  let done = 0;
  let free = 0;
  let failures = 0;
  let blocked = 0;
  const queued = new Set<string>();
  const used: Record<string, number> = {};
  for (const line of lines) {
    if (!line.trim()) continue;
    let e;
    try { e = cleanEntry(JSON.parse(line)); } catch { continue; }
    spent += e.cost_usd;
    if (e.provider && e.provider !== 'okkin') used[e.provider] = (used[e.provider] ?? 0) + (e.result === 'queued' ? 0 : 1);
    if (e.result === 'ok') { done++; if (!PAID_PROVIDERS.has(e.provider)) free++; queued.delete(e.task_id); }
    else if (e.result === 'queued') queued.add(e.task_id);
    else if (e.result === 'blocked') blocked++;
    else if (e.result === 'fail' || e.result.startsWith('http-')) failures++;
  }
  const capsLeft: Record<string, number | null> = {};
  for (const [p, l] of Object.entries(INITIAL_LIMITS)) {
    const fromLive = live?.[p]?.reqLeftToday;
    capsLeft[p] = typeof fromLive === 'number' && Number.isFinite(fromLive) ? fromLive : Number.isFinite(l.rpd) ? Math.max(0, l.rpd - (used[p] ?? 0)) : null;
  }
  return { day, spentUsd: Math.round(spent * 10000) / 10000, capUsd, pctFree: done ? Math.round((free / done) * 100) : null, capsLeft, failures, scanBlocks: blocked, queued: queued.size };
}
