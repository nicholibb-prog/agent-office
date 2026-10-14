// 429/5xx handling (funnel #14): exponential backoff, at most 2 retries, then the next provider.
// Three failures within 5 minutes trips a provider's breaker for 15 minutes.
export const MAX_RETRIES = 2;
export const BREAKER_WINDOW_MS = 5 * 60_000;
export const BREAKER_OPEN_MS = 15 * 60_000;

export const backoffMs = (retry: number, baseMs = 1000) => baseMs * 2 ** retry;
export const retryable = (status: number) => status === 429 || (status >= 500 && status <= 599);

export class Breaker {
  private fails = new Map<string, number[]>();
  private openUntil = new Map<string, number>();
  constructor(private now: () => number = Date.now) {}
  fail(provider: string) {
    const t = this.now();
    const list = (this.fails.get(provider) ?? []).filter((x) => t - x < BREAKER_WINDOW_MS);
    list.push(t);
    this.fails.set(provider, list);
    if (list.length >= 3) this.trip(provider);
  }
  trip(provider: string) {
    this.openUntil.set(provider, this.now() + BREAKER_OPEN_MS);
    this.fails.set(provider, []);
  }
  ok(provider: string): boolean {
    const until = this.openUntil.get(provider);
    return !until || this.now() >= until;
  }
  /** Providers whose breaker has been open this long (for the "down > 1 h" alert). */
  open(): string[] {
    return [...this.openUntil.entries()].filter(([, u]) => this.now() < u).map(([p]) => p);
  }
}
