// Kavi's desk: a read-only activity twin of the local Kavi-George bridge folder.
// It only stats packet files in <dir>/in and <dir>/out. It never reads packet text,
// never returns file names or paths, never writes, and never calls any service.
import { readdirSync, realpathSync, statSync } from 'node:fs';
import { isMajorFiles } from './kavi-send.js';
import path from 'node:path';

export type KaviDeskState = 'unconfigured' | 'unreachable' | 'quiet' | 'waiting' | 'answered';

export interface KaviDesk {
  state: KaviDeskState;
  /** Always false: this desk mirrors files, it is not a live call. */
  live: false;
  inCount: number;
  outCount: number;
  lastIn: string | null;
  lastOut: string | null;
  checkedAt: string;
}

function scan(dir: string): { count: number; newest: number } | null {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return null;
  }
  let count = 0;
  let newest = 0;
  for (const n of names) {
    if (n.startsWith('.') || n.startsWith('~') || n.endsWith('.tmp')) continue;
    try {
      const st = statSync(path.join(dir, n));
      if (!st.isFile()) continue;
      count++;
      if (st.mtimeMs > newest) newest = st.mtimeMs;
    } catch {
      /* vanished between list and stat */
    }
  }
  return { count, newest };
}

export function readKaviDesk(dir: string | undefined, now = Date.now()): KaviDesk {
  const base = { live: false as const, inCount: 0, outCount: 0, lastIn: null, lastOut: null, checkedAt: new Date(now).toISOString() };
  if (!dir) return { ...base, state: 'unconfigured' };
  // Major Files is never listed: check the configured path and where it really points.
  if (isMajorFiles(dir)) return { ...base, state: 'unreachable' };
  try {
    if (isMajorFiles(realpathSync(dir))) return { ...base, state: 'unreachable' };
  } catch {
    return { ...base, state: 'unreachable' };
  }
  const inn = scan(path.join(dir, 'in'));
  const out = scan(path.join(dir, 'out'));
  if (!inn || !out) return { ...base, state: 'unreachable' };
  const iso = (t: number) => (t ? new Date(t).toISOString() : null);
  let state: KaviDeskState = 'quiet';
  if (inn.newest || out.newest) state = inn.newest > out.newest ? 'waiting' : 'answered';
  return { ...base, state, inCount: inn.count, outCount: out.count, lastIn: iso(inn.newest), lastOut: iso(out.newest) };
}
