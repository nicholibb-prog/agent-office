import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { SEAT_KEY } from '../../shared/hq-brief.js';
import type { WorkerStatus } from '../../shared/protocol.js';
import { botName, deskForPoolSeat, isPoolSeatId } from '../../shared/pool.js';
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
  /** Lowercased desk id or local label → generic seat key (`seat-a`, `desk-1`). */
  seats: Record<string, string>;
};

export const EMPTY_HQ: HqLocal = { crewKeysLower: [], humanAliases: [], humanMapsTo: '', seats: {} };

function seatMap(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object') return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v !== 'string') continue;
    const key = k.trim().toLowerCase();
    const seat = v.trim().toLowerCase();
    if (!key || !SEAT_KEY.test(seat)) continue;
    out[key] = seat;
  }
  return out;
}

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
      seats: seatMap(raw.seats),
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

export type CrewApplyOpts = {
  now?: number;
  /** Seat id → last real heartbeat (ms). WORKING without a fresh seen stays idle. */
  seen?: Record<string, number>;
  leaseMs?: number;
  /** A seat authenticated by a #20 seat token on this request; applied even if it is not a pool seat id. */
  tokenSeat?: string;
};

type CrewFile = { updatedAt: string; crew: Record<string, string>; seen: Record<string, number>; source: string };

function crewFilePath(dataDir: string) {
  return path.join(dataDir, 'crew-status.json');
}

export function readCrewFile(dataDir: string): CrewFile | null {
  try {
    const file = crewFilePath(dataDir);
    if (!existsSync(file)) return null;
    const raw = JSON.parse(readFileSync(file, 'utf8')) as Partial<CrewFile>;
    return {
      updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : '',
      crew: raw.crew && typeof raw.crew === 'object' ? (raw.crew as Record<string, string>) : {},
      seen: raw.seen && typeof raw.seen === 'object' ? (raw.seen as Record<string, number>) : {},
      source: typeof raw.source === 'string' ? raw.source : '',
    };
  } catch {
    return null;
  }
}

/**
 * Records a bridge push keyed by seat id only. Display names are dropped.
 * `seen` is stamped from this push (a real adapter heartbeat), not a clock nudge elsewhere.
 */
/**
 * `tokenSeat` is set when the patch key was taken from an authenticated #20 seat token; that seat is
 * trusted as-is. Without it only pool seat ids are accepted.
 */
export function writeCrewPush(dataDir: string, patch: Record<string, string>, source: string, now = Date.now(), tokenSeat?: string): CrewFile {
  const prev = readCrewFile(dataDir);
  const crew = { ...(prev?.crew ?? {}) };
  const seen = { ...(prev?.seen ?? {}) };
  for (const [key, value] of Object.entries(patch)) {
    const seat = key.trim().toLowerCase();
    if (!isPoolSeatId(seat) && seat !== tokenSeat) continue;
    const st = String(value).toLowerCase();
    if (st !== 'working' && st !== 'idle' && st !== 'busy' && st !== 'active' && st !== 'asleep' && st !== 'roam' && st !== 'offline' && st !== 'done') continue;
    crew[seat] = st === 'busy' || st === 'active' ? 'working' : st === 'asleep' || st === 'roam' || st === 'offline' || st === 'done' ? 'idle' : st;
    seen[seat] = now;
  }
  const next: CrewFile = { updatedAt: new Date(now).toISOString(), crew, seen, source };
  writeFileSync(crewFilePath(dataDir), JSON.stringify(next, null, 2) + '\n', { mode: 0o600 });
  return next;
}

/** Match a worker to a seat id via desk / crew id / literal seat name — never a free person label. */
function seatMatch(w: Worker, seat: string): boolean {
  if (w.info.id === seat || w.info.id === `crew-${seat}`) return true;
  const desk = deskForPoolSeat(seat);
  if (desk && w.info.deskId === desk) return true;
  // Only when the worker's own name is the seat id (e.g. "seat-3"), not a person label.
  return botName(w.info.name) === seat;
}

/**
 * Apply a seatId→status map from the local bridge onto desks.
 * Keys must be seat ids. Display labels alone never flip a desk.
 * WORKING needs a fresh `seen` heartbeat; needs_input is left alone.
 */
export function applyCrewPresence(host: CrewHost, crew: Record<string, string>, opts: CrewApplyOpts = {}): { applied: string[] } {
  const now = opts.now ?? Date.now();
  const lease = opts.leaseMs ?? WORKING_LEASE_MS;
  const want = new Map<string, 'working' | 'idle'>();
  for (const [k, v] of Object.entries(crew || {})) {
    const seat = k.trim().toLowerCase();
    if (!isPoolSeatId(seat) && seat !== opts.tokenSeat) continue;
    const st = String(v).toLowerCase();
    if (st === 'working' || st === 'busy' || st === 'active') want.set(seat, 'working');
    else if (st === 'idle' || st === 'asleep' || st === 'roam' || st === 'offline' || st === 'done') want.set(seat, 'idle');
  }
  const applied: string[] = [];
  for (const [seat, next] of want) {
    for (const w of host.workers.values()) {
      if (!seatMatch(w, seat)) continue;
      if (w.info.status === 'needs_input') continue;
      if (next === 'working') {
        const seenAt = opts.seen?.[seat];
        const fresh = typeof seenAt === 'number' && Number.isFinite(seenAt) && now - seenAt < lease;
        if (!fresh) {
          if (w.info.status === 'working' || w.info.status === 'starting') host.setStatus(w, 'idle');
          applied.push(w.info.name + '=idle');
          continue;
        }
        w.info.lastInput = { by: 'crew-status', at: seenAt };
        if (w.info.status !== 'working') host.setStatus(w, 'working');
        else host.emitUpdate(w);
        applied.push(w.info.name + '=working');
      } else {
        if (w.info.status === 'working' || w.info.status === 'starting') host.setStatus(w, 'idle');
        applied.push(w.info.name + '=idle');
      }
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
    const dataDir = path.dirname(statePath);
    const raw = readCrewFile(dataDir);
    if (raw?.crew) applyCrewPresence(host, raw.crew, { seen: raw.seen });
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
  apply(crew: Record<string, string>, opts?: CrewApplyOpts): { applied: string[] };
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
    apply: (crew, opts) => applyCrewPresence(host, crew, opts),
    chat: (name, text) => chatWorking(host, name, text),
  };
}
