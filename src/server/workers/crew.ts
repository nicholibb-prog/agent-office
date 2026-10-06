import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { newTracker } from '../usage.js';
import type { WorkerInfo, WorkerStatus } from '../../shared/protocol.js';
import {
  EMPTY_HQ,
  OKKIN_SEAT,
  WORKING_LEASE_MS,
  activeSeatMap,
  bridgeBeat,
  isSeatId,
  sanitizeSeatMap,
  type HqLocal,
  type SeatId,
} from '../../shared/hq.js';
import { probeOkkin } from '../hq/okkin.js';
import { clockWork } from './clock.js';
import type { Worker } from './types.js';
import { newWorker } from './worker.js';

/** Shells have no agent hooks: after this much quiet since last real input, return to idle (roam/asleep). */
const SHELL_IDLE_MS = 12_000;
/** How often quiet shells are forced idle, and how often the crew-status file is read. */
const SHELL_TICK_MS = 3_000;
const CREW_FILE_MS = 4_000;

export type { HqLocal };
export { EMPTY_HQ };

/** Local HQ overrides (gitignored `.agent-office/hq-local.json`). Neutral defaults when absent. */
export function loadHqLocal(statePath: string): HqLocal {
  try {
    const file = path.join(path.dirname(statePath), 'hq-local.json');
    if (!existsSync(file)) return EMPTY_HQ;
    const raw = JSON.parse(readFileSync(file, 'utf8')) as Partial<HqLocal> & { seats?: unknown };
    return {
      crewKeysLower: Array.isArray(raw.crewKeysLower) ? raw.crewKeysLower.map(String) : [],
      humanAliases: Array.isArray(raw.humanAliases) ? raw.humanAliases.map(String) : [],
      humanMapsTo: typeof raw.humanMapsTo === 'string' ? raw.humanMapsTo : '',
      crewDesks: raw.crewDesks === true,
      seats: sanitizeSeatMap(raw.seats),
      ollamaUrl: typeof raw.ollamaUrl === 'string' ? raw.ollamaUrl : undefined,
      okkinModel: typeof raw.okkinModel === 'string' ? raw.okkinModel : undefined,
      okkinAllow: Array.isArray(raw.okkinAllow) ? raw.okkinAllow.map(String) : undefined,
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
  seen?: Record<string, number>;
  leaseMs?: number;
  seats?: Partial<Record<SeatId, string>>;
};

type CrewFile = { updatedAt: string; crew: Record<string, string>; seen: Record<string, number>; source: string };

function crewFile(dataDir: string) {
  return path.join(dataDir, 'crew-status.json');
}

export function readCrewFile(dataDir: string): CrewFile | null {
  try {
    const file = crewFile(dataDir);
    if (!existsSync(file)) return null;
    const raw = JSON.parse(readFileSync(file, 'utf8')) as Partial<CrewFile>;
    return {
      updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : '',
      crew: raw.crew && typeof raw.crew === 'object' ? raw.crew : {},
      seen: raw.seen && typeof raw.seen === 'object' ? raw.seen : {},
      source: typeof raw.source === 'string' ? raw.source : '',
    };
  } catch {
    return null;
  }
}

/** Records a bridge push. Okkin is not stored: that seat is probed, not painted. */
export function writeCrewPush(dataDir: string, patch: Record<string, string>, source: string, now = Date.now()): CrewFile {
  const prev = readCrewFile(dataDir);
  const crew = { ...(prev?.crew ?? {}) };
  const seen = { ...(prev?.seen ?? {}) };
  for (const [key, value] of Object.entries(patch)) {
    if (!isSeatId(key) || key === OKKIN_SEAT) continue;
    if (!bridgeBeat(value)) continue;
    crew[key] = value;
    seen[key] = now;
  }
  const next: CrewFile = { updatedAt: new Date(now).toISOString(), crew, seen, source };
  writeFileSync(crewFile(dataDir), JSON.stringify(next, null, 2) + '\n', { mode: 0o600 });
  return next;
}

/**
 * Bridge presence applies to crew seats only. A shell is never painted WORKING.
 * A WORKING push with no fresh heartbeat stays idle. needs_input is left alone.
 * Okkin is skipped: that seat follows the Ollama probe.
 */
export function applyCrewPresence(host: CrewHost, crew: Record<string, string>, opts: CrewApplyOpts = {}): { applied: string[] } {
  const now = opts.now ?? Date.now();
  const lease = opts.leaseMs ?? WORKING_LEASE_MS;
  const applied: string[] = [];
  for (const [key, value] of Object.entries(crew || {})) {
    if (!isSeatId(key) || key === OKKIN_SEAT) continue;
    const beat = bridgeBeat(value);
    if (!beat) continue;
    const seenAt = opts.seen?.[key];
    const fresh = typeof seenAt === 'number' && now - seenAt < lease;
    for (const w of host.workers.values()) {
      if (!crewMatch(w, key, opts.seats)) continue;
      if (w.info.status === 'needs_input') continue;
      if (beat === 'blocked') {
        w.info.lastInput = { by: 'crew-status', at: seenAt ?? now };
        host.setStatus(w, 'needs_input');
        applied.push(w.info.name + '=blocked');
        continue;
      }
      if (beat === 'working' && fresh) {
        w.info.lastInput = { by: 'crew-status', at: seenAt ?? now };
        if (w.info.status !== 'working') host.setStatus(w, 'working');
        else host.emitUpdate(w);
        applied.push(w.info.name + '=working');
        continue;
      }
      if (w.info.status === 'working' || w.info.status === 'starting') host.setStatus(w, 'idle');
      applied.push(w.info.name + '=idle');
    }
  }
  return { applied };
}

function crewMatch(w: Worker, seat: SeatId, seats: Partial<Record<SeatId, string>> | undefined): boolean {
  if (w.info.kind !== 'crew') return false;
  if (w.info.id === `crew-${seat}`) return true;
  if (w.info.name.toLowerCase() === seat) return true;
  const desk = seats?.[seat];
  return !!desk && w.info.deskId === desk;
}

/** Chat never forces WORKING. */
export function chatWorking(_host: CrewHost, _name: string, _text?: string): void {
  /* honesty: no-op */
}

export function tickCrewStatusFile(host: CrewHost, statePath: string): void {
  try {
    const dataDir = path.dirname(statePath);
    const hq = loadHqLocal(statePath);
    const raw = readCrewFile(dataDir);
    if (raw?.crew) applyCrewPresence(host, raw.crew, { seen: raw.seen, seats: activeSeatMap(hq) });
    void syncOkkin(host, hq);
  } catch {
    /* ignore bad files */
  }
}

async function syncOkkin(host: CrewHost, hq: HqLocal) {
  const w = [...host.workers.values()].find((item) => item.info.id === `crew-${OKKIN_SEAT}`);
  if (!w || w.info.status === 'needs_input') return;
  const snap = await probeOkkin(process.env, hq);
  if (snap.chip === 'switching') {
    w.info.activity = 'switching…';
    if (w.info.status === 'working') host.setStatus(w, 'idle');
    else host.emitUpdate(w);
    return;
  }
  const next: WorkerStatus = snap.chip === 'working' ? 'working' : snap.chip === 'offline' ? 'offline' : 'idle';
  if (next === 'working') w.info.lastInput = { by: 'okkin-request', at: Date.now() };
  if (w.info.status !== next) host.setStatus(w, next);
  else if (w.info.activity === 'switching…') {
    w.info.activity = undefined;
    host.emitUpdate(w);
  }
}

/**
 * WORKING lease. Bridge heartbeats use `leaseMs`. Quiet shells keep their own shorter idle.
 * Never clears needs_input. Crew seats are not shells, so a shell's own output cannot refresh a crew lease.
 */
export function tickWorkingLease(host: CrewHost, opts: { shellIdleMs: number; leaseMs: number }): void {
  const now = Date.now();
  for (const w of host.workers.values()) {
    if (w.info.status === 'needs_input') continue;
    if (w.info.status !== 'working' && w.info.status !== 'starting') continue;
    const at = w.info.lastInput?.at ?? 0;
    const fromBridge = w.info.lastInput?.by === 'crew-status' || w.info.lastInput?.by === 'okkin-request';
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

/**
 * Seats configured crew desks. Replaces a shell on that desk and does not start a CLI.
 * Does nothing until gitignored config sets crewDesks.
 */
export async function bindCrewDesks(
  workers: Map<string, Worker>,
  statePath: string,
  hooks: { retire(id: string): Promise<unknown>; emit(w: Worker): void; persist(): void },
): Promise<void> {
  const seats = activeSeatMap(loadHqLocal(statePath));
  const entries = Object.entries(seats) as [SeatId, string][];
  if (!entries.length) return;
  let changed = false;
  for (const [, desk] of entries) {
    for (const w of [...workers.values()]) {
      if (w.info.deskId !== desk || w.info.kind !== 'shell') continue;
      await hooks.retire(w.info.id);
      changed = true;
    }
  }
  for (const [seat, desk] of entries) {
    const id = `crew-${seat}`;
    if ([...workers.values()].some((w) => w.info.id === id)) continue;
    if ([...workers.values()].some((w) => w.info.deskId === desk)) continue;
    const w = newWorker(crewInfo(seat, desk), newTracker());
    workers.set(id, w);
    hooks.emit(w);
    changed = true;
  }
  if (changed) hooks.persist();
}

function crewInfo(seat: SeatId, deskId: string): WorkerInfo {
  return {
    id: `crew-${seat}`,
    kind: 'crew',
    deskId,
    name: seat === OKKIN_SEAT ? 'Okkin' : seat,
    color: seat === OKKIN_SEAT ? '#7aa2f7' : '#8d99ae',
    status: 'idle',
    acked: true,
    createdBy: 'office',
    createdAt: Date.now(),
    cols: 100,
    rows: 30,
    viewers: [],
    viewerIds: [],
  };
}
