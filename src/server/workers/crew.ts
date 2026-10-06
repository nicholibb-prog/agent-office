import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { WorkerStatus } from '../../shared/protocol.js';
import { clockWork } from './clock.js';
import type { Worker } from './types.js';

/** Shells have no agent hooks: after this much quiet since last real input, return to idle (roam/asleep). */
const SHELL_IDLE_MS = 12_000;
/** WORKING from bridge/hooks expires after this; never overwrite needs_input. */
const WORKING_LEASE_MS = 15 * 60_000;
/** How often quiet shells are forced idle, and how often the crew-status file is read. */
const SHELL_TICK_MS = 3_000;
const CREW_FILE_MS = 4_000;

export type HqLocal = {
  crewKeysLower: string[];
  humanAliases: string[];
  humanMapsTo: string;
};

export const EMPTY_HQ: HqLocal = { crewKeysLower: [], humanAliases: [], humanMapsTo: '' };

/** Local HQ overrides (gitignored `.agent-office/hq-local.json`). Neutral defaults when absent. */
export function loadHqLocal(statePath: string): HqLocal {
  try {
    const file = path.join(path.dirname(statePath), 'hq-local.json');
    if (!existsSync(file)) return EMPTY_HQ;
    const raw = JSON.parse(readFileSync(file, 'utf8')) as Partial<HqLocal>;
    return {
      crewKeysLower: Array.isArray(raw.crewKeysLower) ? raw.crewKeysLower.map(String) : [],
      humanAliases: Array.isArray(raw.humanAliases) ? raw.humanAliases.map(String) : [],
      humanMapsTo: typeof raw.humanMapsTo === 'string' ? raw.humanMapsTo : '',
    };
  } catch {
    return EMPTY_HQ;
  }
}

export type CrewHost = {
  workers: Map<string, Worker>;
  setStatus(w: Worker, status: WorkerStatus): void;
  emitUpdate(w: Worker): void;
};

/** Apply a name→status map from the local bridge onto shell desks. Never overwrites needs_input. */
export function applyCrewPresence(host: CrewHost, crew: Record<string, string>): { applied: string[] } {
  const clean = (s: string) => s.replace(/\s*[^\w\s.-]+\s*$/u, '').trim().toLowerCase();
  const want = new Map<string, 'working' | 'idle'>();
  for (const [k, v] of Object.entries(crew || {})) {
    const n = clean(k);
    const st = String(v).toLowerCase();
    if (!n) continue;
    if (st === 'working' || st === 'busy' || st === 'active') want.set(n, 'working');
    else if (st === 'idle' || st === 'asleep' || st === 'roam' || st === 'offline' || st === 'done') want.set(n, 'idle');
  }
  const applied: string[] = [];
  for (const w of host.workers.values()) {
    if (w.info.kind !== 'shell') continue;
    const n = clean(w.info.name);
    const next = want.get(n);
    if (!next) continue;
    if (w.info.status === 'needs_input') continue;
    if (next === 'working') {
      w.info.lastInput = { by: 'crew-status', at: Date.now() };
      if (w.info.status !== 'working') host.setStatus(w, 'working');
      else host.emitUpdate(w);
      applied.push(w.info.name + '=working');
    } else {
      if (w.info.status === 'working' || w.info.status === 'starting') host.setStatus(w, 'idle');
      applied.push(w.info.name + '=idle');
    }
  }
  return { applied };
}

/** Chat/@mentions no longer force WORKING — only authenticated bridge push or agent hooks. */
export function chatWorking(_host: CrewHost, _name: string, _text?: string): void {
  /* honesty: no-op */
}

export function tickCrewStatusFile(host: CrewHost, statePath: string): void {
  try {
    const file = path.join(path.dirname(statePath), 'crew-status.json');
    if (!existsSync(file)) return;
    const raw = JSON.parse(readFileSync(file, 'utf8')) as { crew?: Record<string, string> };
    if (raw?.crew) applyCrewPresence(host, raw.crew);
  } catch {
    /* ignore bad/missing file */
  }
}

/**
 * WORKING lease / shell idle: bridge lease uses `leaseMs` (max 15 min); quiet shells use `shellIdleMs`.
 * Never clears needs_input.
 */
export function tickWorkingLease(
  host: CrewHost,
  opts: { shellIdleMs: number; leaseMs: number },
): void {
  const now = Date.now();
  for (const w of host.workers.values()) {
    if (w.info.status === 'needs_input') continue;
    if (w.info.status !== 'working' && w.info.status !== 'starting') continue;
    const at = w.info.lastInput?.at ?? 0;
    const fromBridge = w.info.lastInput?.by === 'crew-status';
    const ttl = fromBridge || w.info.kind !== 'shell' ? opts.leaseMs : opts.shellIdleMs;
    if (at && now - at < ttl) continue;
    host.setStatus(w, 'idle');
  }
}

/**
 * Shells never get agent hooks: after quiet since last real input, go idle so they roam/asleep.
 * Called on the way out to browsers, before the snapshot is sent.
 */
export function settleQuietShell(w: Worker, now = Date.now()): void {
  if (w.info.kind !== 'shell' || w.info.status !== 'working') return;
  const at = w.info.lastInput?.at ?? 0;
  if (at && now - at < SHELL_IDLE_MS) return;
  clockWork(w.info, 'idle', now);
  w.info.status = 'idle';
  w.info.action = undefined;
}

/** The crew-status file watch and the WORKING lease, owned outside the worker manager. */
export type CrewWatch = {
  start(): void;
  stop(): void;
  apply(crew: Record<string, string>): { applied: string[] };
  chat(name: string, text?: string): void;
};

export function createCrewWatch(
  workers: Map<string, Worker>,
  statePath: string,
  setStatus: (w: Worker, status: WorkerStatus) => void,
  emitUpdate: (w: Worker) => void,
): CrewWatch {
  const host: CrewHost = { workers, setStatus, emitUpdate };
  let shellIdleTick: ReturnType<typeof setInterval> | undefined;
  let crewStatusTick: ReturnType<typeof setInterval> | undefined;
  return {
    start() {
      // Shells: force idle when quiet so a desk is only for WORKING. The file is the bridge's push.
      shellIdleTick = setInterval(() => tickWorkingLease(host, { shellIdleMs: SHELL_IDLE_MS, leaseMs: WORKING_LEASE_MS }), SHELL_TICK_MS);
      crewStatusTick = setInterval(() => tickCrewStatusFile(host, statePath), CREW_FILE_MS);
      tickCrewStatusFile(host, statePath);
    },
    stop() {
      if (shellIdleTick) clearInterval(shellIdleTick);
      if (crewStatusTick) clearInterval(crewStatusTick);
      shellIdleTick = undefined;
      crewStatusTick = undefined;
    },
    apply: (crew) => applyCrewPresence(host, crew),
    chat: (name, text) => chatWorking(host, name, text),
  };
}