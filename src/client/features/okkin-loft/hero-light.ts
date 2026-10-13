// The supercomputer's light, worked out from REAL Okkin state only. Pure (no three.js), so the
// mapping and the power sequence are tested.

export type HeroMode = 'off' | 'idle' | 'working';
/** off: power off. working: a request in flight (generating) or a model loading/switching. idle: on, nothing running. */
export function heroMode(s: { power: 'on' | 'off'; busy?: boolean; loading?: boolean }): HeroMode {
  if (s.power !== 'on') return 'off';
  return s.busy || s.loading ? 'working' : 'idle';
}

/** Blades from the bottom (row 0) up. */
export const BLADE_ROWS = 14;
export const OFF_LEVEL = 0.06;

/**
 * How lit a blade row is (0..1) at time `t` (s): dim when off; a slow breathe (~5 s) when idle; a fast
 * ripple running up the tower while working.
 */
export function bladeLevel(mode: HeroMode, t: number, row: number, rows = BLADE_ROWS): number {
  if (mode === 'off') return OFF_LEVEL;
  if (mode === 'idle') return 0.4 + 0.18 * Math.sin((t * 2 * Math.PI) / 5);
  return 0.3 + 0.7 * Math.max(0, Math.sin(t * 9 - (row / rows) * Math.PI * 4));
}

/** Seconds between rows in the power sequence. */
export const SEQ_STEP = 0.07;
export const seqDuration = (rows = BLADE_ROWS) => rows * SEQ_STEP + 0.15;

/**
 * The power sequence: on ON, rows light from the bottom up; on OFF, they go dark from the top down.
 * Returns how far (0..1) toward its new state row `row` is, `elapsed` seconds into the sequence.
 */
export function seqProgress(kind: 'on' | 'off', elapsed: number, row: number, rows = BLADE_ROWS): number {
  const order = kind === 'on' ? row : rows - 1 - row;
  return Math.min(1, Math.max(0, (elapsed - order * SEQ_STEP) / 0.15));
}

/** One accent per model (by dial role), swept across the blades when the dial changes. */
export const MODEL_ACCENT: Record<string, string> = { quick: '#5ac8fa', default: '#e3c25a', chat: '#a78bfa', code: '#34d399', big: '#ff8a5c' };
export const accentFor = (role: string | undefined) => MODEL_ACCENT[role ?? ''] ?? '#e3c25a';

/** The sweep after a dial change: a bright band crossing the rows bottom to top over SWEEP_S seconds. */
export const SWEEP_S = 1.2;
export function sweepBand(elapsed: number, row: number, rows = BLADE_ROWS): number {
  if (elapsed < 0 || elapsed > SWEEP_S) return 0;
  const at = (elapsed / SWEEP_S) * (rows + 2) - 1;
  return Math.max(0, 1 - Math.abs(row - at) / 1.5);
}

/** The halo and floor glow strength for a mode. */
export function haloLevel(mode: HeroMode, t: number): number {
  if (mode === 'off') return 0;
  if (mode === 'idle') return 0.35 + 0.1 * Math.sin((t * 2 * Math.PI) / 5);
  return 0.6 + 0.15 * Math.sin(t * 9);
}

/** The hologram: live tokens/sec and loaded model, real data only; '—' when there's none; MOCK when mock. */
export function hologramLines(h: { tps: number | null; model: string | null; mock: boolean } | null): { top: string; bottom: string; mock: boolean } {
  if (!h) return { top: '—', bottom: '—', mock: false };
  return { top: h.tps !== null && h.tps > 0 ? `${h.tps} tok/s` : '—', bottom: h.model ?? '—', mock: h.mock };
}
