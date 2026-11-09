// Model drift check (funnel #34): a weekly diff of the configured free models against the live
// list; dead models are removed automatically (never added automatically: new ones need a person).
export interface Drift { removed: string[]; added: string[]; kept: string[] }

export function freeModelDrift(configured: string[], live: string[]): Drift {
  const liveSet = new Set(live);
  const confSet = new Set(configured);
  return {
    removed: configured.filter((m) => !liveSet.has(m)),
    added: live.filter((m) => m.endsWith(':free') && !confSet.has(m)),
    kept: configured.filter((m) => liveSet.has(m)),
  };
}

export const WEEK_MS = 7 * 86_400_000;
export const driftDue = (lastRunMs: number | undefined, now: number) => lastRunMs === undefined || now - lastRunMs >= WEEK_MS;

/** Applies a drift: the configured list minus dead models. Refuses to empty the list from a bad fetch. */
export function applyDrift(configured: string[], live: string[]): string[] {
  if (!live.length) return configured;
  const { kept } = freeModelDrift(configured, live);
  return kept.length ? kept : configured;
}
