// The router board's shape and its text, shared by the server route and the HUD card (funnel #19).
export interface RouterBoard {
  day: string;
  spentUsd: number;
  capUsd: number;
  /** % of finished attempts that went to free tiers (Okkin + free cloud); null before any. */
  pctFree: number | null;
  /** Requests left today per provider; null = no daily limit known. */
  capsLeft: Record<string, number | null>;
  failures: number;
  scanBlocks: number;
  queued: number;
}

/** What GET /api/router/board answers an owner: off, or the numbers. Non-owners get `private` only. */
export type RouterBoardReply = { on: false } | ({ on: true } & RouterBoard) | { private: true };

export const BOARD_TITLE = 'Model use today';
export const ROUTER_OFF_NOTE = 'Model routing is off';

export const PROVIDER_NAMES: Readonly<Record<string, string>> = {
  openrouter: 'OpenRouter free models',
  groq: 'Groq',
  nim: 'NVIDIA',
  glm: 'Zhipu GLM',
  deepseek: 'DeepSeek',
  okkin: 'Okkin (local)',
  forgel: 'ForgeL',
  polishl: 'PolishL',
  'grok-crew': 'Grok crew',
};
export const providerName = (id: string) => PROVIDER_NAMES[id] ?? id;

export function capLine(id: string, left: number | null): string {
  return `${providerName(id)}: ${left === null ? '— limit unknown' : `${left} left`}`;
}

export function boardLines(b: RouterBoard): string[] {
  return [
    `Paid today $${b.spentUsd.toFixed(2)} of $${b.capUsd.toFixed(2)}`,
    b.pctFree === null ? 'Routed free: nothing routed yet today' : `Routed free: ${b.pctFree}%`,
    ...Object.entries(b.capsLeft).map(([p, n]) => capLine(p, n)),
    `Failures ${b.failures} · Scan blocks ${b.scanBlocks} · Queue ${b.queued}`,
  ];
}
