// The router (funnel #2, #6, #38; §3 ladder, §8 API). Every dispatch goes through route(); every
// non-Okkin send goes through the injected `cloud` (cloudSend in production). Free-model output is
// returned as text only: never executed, never trusted for tool calls (#27).
import { Breaker, MAX_RETRIES, backoffMs, retryable } from './breaker.js';
import { Budget, FixupTax, PAID_PROVIDERS } from './budget.js';
import { CapLedger } from './cap-ledger.js';
import { ScanBlocked, SendRefused } from './cloud-send.js';
import { classify, isStudentSource, type DataClasses } from './data-classes.js';
import { estimateTokens, sizeAllows } from './estimate.js';
import { providerEnabled, type RouterEnv, type RouterFlags } from './flags.js';
import { deepseekPeak } from './peak.js';
import type { ProviderReply } from './cloud-send.js';
import type { RoutingLogger } from './routing-log.js';
import type { Attempt, CloudProvider, HttpProvider, Label, Level, Provider, ScanHit, Task, WirePayload } from './types.js';

export type Tier = 'okkin' | 'free-cloud' | 'crew' | 'grok-dan' | 'owner';
export const LADDER: readonly Tier[] = ['okkin', 'free-cloud', 'crew', 'grok-dan', 'owner'];
export const FIRST_TIER: Record<Level, Tier> = { 1: 'okkin', 2: 'okkin', 3: 'free-cloud', 4: 'free-cloud', 5: 'crew', 6: 'grok-dan', 7: 'owner' };
export const OKKIN_MAX_LEVEL = 2;
export const FREE_MAX_LEVEL = 4;
export const ATTEMPTS_PER_TIER = 2;

export type QueueReason =
  | 'okkin-down' | 'kill' | 'cap' | 'c6-held' | 'label-above-okkin' | 'scan-hit' | 'owner' | 'no-provider';

export interface Decision {
  taskId: string;
  label: Label;
  tier: Tier;
  provider?: Provider;
  model?: string;
  queue?: QueueReason;
}

export interface Models {
  /** Laguna first, then the other :free models (one shared counter). */
  openrouter: string[];
  groq: string;
  nim: string;
  glm: string;
  deepseek: string;
  okkin: string;
}

export type RouterAlert =
  | { kind: 'scan-block'; taskId: string; types: string[]; count: number }
  | { kind: 'queued-for-owner'; taskId: string; reason: QueueReason };

export interface RouterCtx {
  classes: DataClasses;
  flags: RouterFlags;
  env: RouterEnv;
  budget: Budget;
  ledger: CapLedger;
  breaker: Breaker;
  fixup: FixupTax;
  okkinOk: () => boolean;
  /** C6: the ProArt store holds the owner's student/Drive-ID hashes. */
  studentStoreReady: () => boolean;
  models: Models;
  cloud: (provider: CloudProvider, payload: WirePayload, label: Label) => Promise<ProviderReply>;
  okkin: (prompt: string) => Promise<{ ok: boolean; text: string }>;
  log: RoutingLogger;
  alert: (a: RouterAlert) => void;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  costOf?: (provider: Provider, tokensIn: number, tokensOut: number) => number;
  /** Per-model scoreboard (#35): false drops a model from this level. */
  scoreOk?: (model: string, level: number) => boolean;
}

/** DeepSeek list price per token, as a starting default (the owner can change it). */
export function defaultCost(provider: Provider, tin: number, tout: number): number {
  return provider === 'deepseek' ? (tin * 0.28 + tout * 0.42) / 1e6 : 0;
}

const isPaid = (p: Provider) => PAID_PROVIDERS.has(p);
const above = (a: Tier, b: Tier) => LADDER.indexOf(a) > LADDER.indexOf(b);
const maxTier = (a: Tier, b: Tier) => (above(a, b) ? a : b);
export const nextTier = (t: Tier): Tier | null => LADDER[LADDER.indexOf(t) + 1] ?? null;

/** The free-cloud rotation for a public task, in spec order (§4), filtered by every gate. */
export function rotation(task: Task, ctx: RouterCtx, exclude: ReadonlySet<string> = new Set()): { provider: HttpProvider; model: string } | null {
  const tokens = estimateTokens(task.prompt, task.estTokens);
  const now = (ctx.now ?? Date.now)();
  const order: { provider: HttpProvider; model: string }[] = [
    ...ctx.models.openrouter.map((model) => ({ provider: 'openrouter' as const, model })),
    { provider: 'groq', model: ctx.models.groq },
    { provider: 'nim', model: ctx.models.nim },
    { provider: 'glm', model: ctx.models.glm },
    { provider: 'deepseek', model: ctx.models.deepseek },
  ];
  for (const c of order) {
    if (exclude.has(`${c.provider}:${c.model}`) || exclude.has(c.provider)) continue;
    if (!providerEnabled(c.provider, ctx.flags, ctx.env)) continue;
    if (!ctx.breaker.ok(c.provider)) continue;
    if (ctx.scoreOk && !ctx.scoreOk(c.model, task.level)) continue;
    if (!sizeAllows(c.provider, c.model, tokens)) continue;
    if (!ctx.ledger.available(c.provider, tokens)) continue;
    if (c.provider === 'deepseek' && (deepseekPeak(now) || !ctx.budget.allowed({ danSecurity: task.danSecurity }))) continue;
    return c;
  }
  return null;
}

/** classify -> C6 hold -> label/gated limits -> kill/cap -> ladder tier -> rotation pick. */
export function route(task: Task, ctx: RouterCtx, from?: Tier, exclude?: ReadonlySet<string>): Decision {
  const label = classify(task, ctx.classes);
  const base = { taskId: task.id, label };
  if (isStudentSource(task, ctx.classes) && !(ctx.flags.c6StudentDrive && ctx.studentStoreReady())) return { ...base, tier: 'owner', queue: 'c6-held' };
  const gated = !!task.gated || task.level >= 6;
  let tier = from ?? FIRST_TIER[task.level];
  // The gated tier never goes to Okkin, nor to free models.
  if (gated) tier = maxTier(tier, 'grok-dan');
  if (tier === 'okkin' && task.level > OKKIN_MAX_LEVEL) tier = 'free-cloud';
  if (tier === 'free-cloud' && task.level > FREE_MAX_LEVEL) tier = 'crew';

  if (label !== 'public') {
    if (tier === 'okkin') return ctx.okkinOk() ? { ...base, tier, provider: 'okkin', model: ctx.models.okkin } : { ...base, tier, queue: 'okkin-down' };
    // C1 (default OFF): a secret task may go to the Grok crew at the gated tier, nothing else.
    if (label === 'secret' && ctx.flags.c1SecretToGrokCrew && !above(tier, 'grok-dan')) {
      if (!ctx.budget.allowed({ danSecurity: task.danSecurity })) return { ...base, tier: 'grok-dan', queue: ctx.budget.killed() ? 'kill' : 'cap' };
      return { ...base, tier: 'grok-dan', provider: 'grok-crew', model: 'grok-crew' };
    }
    return { ...base, tier: 'owner', queue: tier === 'owner' ? 'owner' : 'label-above-okkin' };
  }

  for (let t: Tier | null = tier; t; t = nextTier(t)) {
    if (t === 'okkin') {
      if (ctx.okkinOk()) return { ...base, tier: t, provider: 'okkin', model: ctx.models.okkin };
      continue; // public may move up to free cloud
    }
    if (t === 'free-cloud') {
      if (task.level > FREE_MAX_LEVEL || !ctx.fixup.freeAllowed(task.type)) continue;
      const pick = rotation(task, ctx, exclude);
      if (pick) return { ...base, tier: t, ...pick };
      continue;
    }
    if (t === 'crew' || t === 'grok-dan') {
      const provider: CloudProvider = t === 'grok-dan' ? 'grok-crew' : task.type === 'screenshot-review' ? 'polishl' : 'forgel';
      if (exclude?.has(provider)) continue;
      if (!ctx.budget.allowed({ danSecurity: task.danSecurity })) return { ...base, tier: t, queue: ctx.budget.killed() ? 'kill' : 'cap' };
      return { ...base, tier: t, provider, model: provider };
    }
    return { ...base, tier: 'owner', queue: 'owner' };
  }
  return { ...base, tier: 'owner', queue: 'no-provider' };
}

export interface DispatchResult {
  taskId: string;
  status: 'done' | 'queued';
  text?: string;
  reason?: QueueReason;
  decision: Decision;
  history: Attempt[];
}

function payloadOf(task: Task, d: Decision): WirePayload {
  return {
    model: d.model ?? '',
    prompt: task.prompt,
    history: (task.history ?? []).map((a) => ({ attempt: a.attempt, provider: a.provider, result: a.result, log: a.log })),
    attachments: task.attachments,
    metadata: { task_id: task.id, level: task.level },
  };
}

/** Route, attempt (≤2 per tier, the 2nd with the 1st's failure log), escalate up with history, same ID. */
export async function dispatch(task: Task, ctx: RouterCtx): Promise<DispatchResult> {
  const now = ctx.now ?? Date.now;
  const sleep = ctx.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const history: Attempt[] = [...(task.history ?? [])];
  let n = history.length;
  let tier: Tier | undefined;
  const exclude = new Set<string>();
  const log = (d: Decision, extra: Record<string, unknown>) =>
    ctx.log({ task_id: task.id, level: task.level, label: d.label, source: task.source ?? task.repo ?? '', tier: d.tier, provider: d.provider ?? '', model: d.model ?? '', attempt: n, ...extra });
  const queued = (d: Decision, reason: QueueReason): DispatchResult => {
    log(d, { result: 'queued', escalated_to: null });
    if (reason !== 'okkin-down') ctx.alert({ kind: 'queued-for-owner', taskId: task.id, reason });
    return { taskId: task.id, status: 'queued', reason, decision: d, history };
  };

  for (let guard = 0; guard < 20; guard++) {
    const d = route({ ...task, history }, ctx, tier, exclude);
    if (d.queue || !d.provider) return queued(d, d.queue ?? 'no-provider');
    let tierAttempts = 0;
    let retries = 0;
    while (tierAttempts < ATTEMPTS_PER_TIER) {
      n++;
      const started = now();
      const t = { ...task, history };
      try {
        let text = '';
        let tin = 0;
        let tout = 0;
        if (d.provider === 'okkin') {
          const r = await ctx.okkin(task.prompt + (history.length ? `\n\nEarlier attempts:\n${history.map((h) => `#${h.attempt} ${h.provider}: ${h.result}${h.log ? ` (${h.log})` : ''}`).join('\n')}` : ''));
          if (!r.ok) throw new Error('okkin failed');
          text = r.text;
        } else {
          const reply = await ctx.cloud(d.provider as CloudProvider, payloadOf(t, d), d.label);
          ctx.ledger.record(d.provider, reply.tokensIn + reply.tokensOut);
          ctx.ledger.update(d.provider, reply.limits);
          if (retryable(reply.status)) {
            ctx.breaker.fail(d.provider);
            if (retries < MAX_RETRIES) { await sleep(backoffMs(retries++)); n--; continue; }
            // Out of retries: next provider in the same tier.
            history.push({ attempt: n, tier: d.tier, provider: d.provider, model: d.model ?? '', result: 'fail', log: `HTTP ${reply.status}` });
            log(d, { result: `http-${reply.status}`, latency_ms: now() - started });
            exclude.add(d.provider);
            break;
          }
          if (reply.status !== 200 || !reply.text.trim()) throw new Error(`HTTP ${reply.status}`);
          text = reply.text;
          tin = reply.tokensIn;
          tout = reply.tokensOut;
        }
        const cost = (ctx.costOf ?? defaultCost)(d.provider, tin, tout);
        if (isPaid(d.provider)) ctx.budget.spend(cost);
        history.push({ attempt: n, tier: d.tier, provider: d.provider, model: d.model ?? '', result: 'ok' });
        log(d, { result: 'ok', tokens_in: tin, tokens_out: tout, cost_usd: cost, latency_ms: now() - started, escalated_to: null });
        return { taskId: task.id, status: 'done', text, decision: d, history };
      } catch (err) {
        if (err instanceof ScanBlocked) return scanBlocked(task, ctx, d, err.hits, history, log, n);
        if (err instanceof SendRefused) {
          history.push({ attempt: n, tier: d.tier, provider: d.provider, model: d.model ?? '', result: 'refused', log: err.reason });
          log(d, { result: 'refused' });
          exclude.add(d.provider);
          break;
        }
        tierAttempts++;
        // The failure log the next attempt carries: a short reason, never a payload.
        history.push({ attempt: n, tier: d.tier, provider: d.provider, model: d.model ?? '', result: 'fail', log: String((err as Error)?.message ?? 'failed').slice(0, 120) });
        log(d, { result: 'fail', latency_ms: now() - started });
      }
    }
    if (exclude.has(d.provider) && d.tier === 'free-cloud' && rotation(task, ctx, exclude)) { tier = d.tier; continue; }
    const up = nextTier(d.tier);
    if (!up) return queued(d, 'owner');
    log(d, { result: 'escalate', escalated_to: up });
    tier = up;
  }
  return queued({ taskId: task.id, label: classify(task, ctx.classes), tier: 'owner' }, 'owner');
}

/** Spec §3: block, log hash-only, alert once; reroute to Okkin (same ID) if it may take it, else queue. */
async function scanBlocked(task: Task, ctx: RouterCtx, d: Decision, hits: ScanHit[], history: Attempt[], log: (d: Decision, e: Record<string, unknown>) => void, n: number): Promise<DispatchResult> {
  history.push({ attempt: n, tier: d.tier, provider: d.provider!, model: d.model ?? '', result: 'blocked' });
  log(d, { result: 'blocked', scan_hits: hits });
  ctx.alert({ kind: 'scan-block', taskId: task.id, types: [...new Set(hits.map((h) => h.type))], count: hits.length });
  if (task.level <= OKKIN_MAX_LEVEL && !task.gated && ctx.okkinOk()) {
    const od: Decision = { taskId: task.id, label: d.label, tier: 'okkin', provider: 'okkin', model: ctx.models.okkin };
    const r = await ctx.okkin(task.prompt);
    history.push({ attempt: n + 1, tier: 'okkin', provider: 'okkin', model: od.model ?? '', result: r.ok ? 'ok' : 'fail' });
    ctx.log({ task_id: task.id, level: task.level, label: d.label, tier: 'okkin', provider: 'okkin', model: od.model, attempt: n + 1, result: r.ok ? 'ok' : 'fail' });
    if (r.ok) return { taskId: task.id, status: 'done', text: r.text, decision: od, history };
  }
  ctx.log({ task_id: task.id, level: task.level, label: d.label, tier: d.tier, attempt: n, result: 'queued' });
  return { taskId: task.id, status: 'queued', reason: 'scan-hit', decision: d, history };
}
