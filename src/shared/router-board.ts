// The router board's shape and its text, shared by the server route and the HUD card (funnel #19).
export interface RouterBoard {
  day: string;
  spentUsd: number;
  capUsd: number;
  /** % of finished attempts that went to free tiers (Okkin + free cloud); null before any. */
  pctFree: number | null;
  /** Requests left today per provider; null = no daily cap known. */
  capsLeft: Record<string, number | null>;
  failures: number;
  scanBlocks: number;
  queued: number;
}

export function boardLines(b: RouterBoard): string[] {
  const caps = Object.entries(b.capsLeft).map(([p, n]) => `${p} ${n === null ? '∞' : n}`).join(' · ');
  return [
    `Paid today $${b.spentUsd.toFixed(2)} of $${b.capUsd.toFixed(2)}`,
    `Routed free ${b.pctFree === null ? '—' : `${b.pctFree}%`}`,
    `Caps left: ${caps}`,
    `Failures ${b.failures} · Scan blocks ${b.scanBlocks} · Queue ${b.queued}`,
  ];
}
