// Cap ledger (funnel #13, #32, #36): requests and tokens per provider per minute and per day.
// OpenRouter :free models share one counter (#13). Response headers, when present, overwrite the
// research numbers (#32). Each provider keeps its own reset time; bulk work is scheduled after it (#36).
import type { HttpProvider } from './types.js';

export interface Limits { rpm: number; rpd: number; tpm: number; tpd: number }
/** Research starting values only (routing-funnel-v2 §4); headers replace them as they arrive. */
export const INITIAL_LIMITS: Record<HttpProvider, Limits> = {
  openrouter: { rpm: 20, rpd: 50, tpm: Infinity, tpd: Infinity },
  groq: { rpm: 30, rpd: 1000, tpm: 6000, tpd: 100_000 },
  nim: { rpm: 40, rpd: Infinity, tpm: Infinity, tpd: Infinity },
  glm: { rpm: 30, rpd: Infinity, tpm: Infinity, tpd: Infinity },
  deepseek: { rpm: 60, rpd: Infinity, tpm: Infinity, tpd: Infinity },
};
/** With the $10 credit (flag a) OpenRouter :free allows 1,000 requests a day. */
export const OPENROUTER_CREDIT_RPD = 1000;

type Window = { start: number; req: number; tok: number };
type Row = { limits: Limits; minute: Window; day: Window; remainingReq?: number; remainingTok?: number; resetAt?: number };

const MIN = 60_000;
const DAY = 86_400_000;

/** "1m30s", "12ms", "2.5s", "60" (seconds) -> ms. */
export function parseReset(v: string): number | null {
  const s = v.trim();
  if (/^\d+(\.\d+)?$/.test(s)) return Number(s) * 1000;
  let ms = 0;
  let any = false;
  for (const m of s.matchAll(/(\d+(?:\.\d+)?)(ms|h|m|s)/g)) {
    any = true;
    const n = Number(m[1]);
    ms += m[2] === 'ms' ? n : m[2] === 's' ? n * 1000 : m[2] === 'm' ? n * MIN : n * 3_600_000;
  }
  return any ? ms : null;
}

export class CapLedger {
  private rows = new Map<string, Row>();
  constructor(private now: () => number = Date.now, opts: { openrouterCredit?: boolean } = {}) {
    for (const [p, l] of Object.entries(INITIAL_LIMITS)) {
      const t = this.now();
      this.rows.set(p, { limits: { ...l, ...(p === 'openrouter' && opts.openrouterCredit ? { rpd: OPENROUTER_CREDIT_RPD } : {}) }, minute: { start: t, req: 0, tok: 0 }, day: { start: t, req: 0, tok: 0 } });
    }
  }
  /** Every OpenRouter model id shares the one 'openrouter' row. */
  static key(provider: string): string {
    return provider.startsWith('openrouter') ? 'openrouter' : provider;
  }
  private row(provider: string): Row | undefined {
    const r = this.rows.get(CapLedger.key(provider));
    if (!r) return undefined;
    const t = this.now();
    if (t - r.minute.start >= MIN) r.minute = { start: t, req: 0, tok: 0 };
    if (t - r.day.start >= DAY) r.day = { start: t, req: 0, tok: 0 };
    if (r.resetAt && t >= r.resetAt) { r.remainingReq = undefined; r.remainingTok = undefined; }
    return r;
  }
  record(provider: string, tokens: number) {
    const r = this.row(provider);
    if (!r) return;
    r.minute.req++; r.day.req++;
    r.minute.tok += tokens; r.day.tok += tokens;
    if (r.remainingReq !== undefined) r.remainingReq = Math.max(0, r.remainingReq - 1);
    if (r.remainingTok !== undefined) r.remainingTok = Math.max(0, r.remainingTok - tokens);
  }
  /** Rate-limit headers from a reply (already filtered to known names by the client). */
  update(provider: string, headers: Record<string, string>) {
    const r = this.row(provider);
    if (!r) return;
    const num = (k: string) => (headers[k] !== undefined && /^\d+$/.test(headers[k]) ? Number(headers[k]) : undefined);
    const lr = num('x-ratelimit-limit-requests') ?? num('x-ratelimit-limit');
    const lt = num('x-ratelimit-limit-tokens');
    if (lr !== undefined) r.limits.rpd = lr;
    if (lt !== undefined) r.limits.tpm = lt;
    const rr = num('x-ratelimit-remaining-requests') ?? num('x-ratelimit-remaining');
    const rt = num('x-ratelimit-remaining-tokens');
    if (rr !== undefined) r.remainingReq = rr;
    if (rt !== undefined) r.remainingTok = rt;
    const reset = headers['x-ratelimit-reset-requests'] ?? headers['x-ratelimit-reset'] ?? headers['retry-after'];
    const ms = reset ? parseReset(reset) : null;
    if (ms !== null) r.resetAt = this.now() + ms;
  }
  available(provider: string, tokens: number): boolean {
    const r = this.row(provider);
    if (!r) return false;
    if (r.remainingReq !== undefined && r.remainingReq <= 0) return false;
    if (r.remainingTok !== undefined && r.remainingTok < tokens) return false;
    const l = r.limits;
    return r.minute.req < l.rpm && r.day.req < l.rpd && r.minute.tok + tokens <= l.tpm && r.day.tok + tokens <= l.tpd;
  }
  resetAt(provider: string): number | undefined {
    return this.row(provider)?.resetAt;
  }
  /** When bulk work for this provider should next run: right after its stored reset, or now. */
  bulkSlot(provider: string): number {
    const t = this.now();
    const r = this.resetAt(provider);
    return r && r > t ? r + 1000 : t;
  }
  snapshot(): Record<string, { reqLeftToday: number; resetAt?: number }> {
    const out: Record<string, { reqLeftToday: number; resetAt?: number }> = {};
    for (const k of this.rows.keys()) {
      const r = this.row(k)!;
      out[k] = { reqLeftToday: Math.max(0, Math.min(r.limits.rpd - r.day.req, r.remainingReq ?? Infinity)), resetAt: r.resetAt };
    }
    return out;
  }
}
