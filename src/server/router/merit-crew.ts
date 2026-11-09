// Crew presence → merit candidates. Role ids only. Display names come from gitignored
// hq-local on the machine; this file does not ship a person's name as a seat default.
import path from 'node:path';
import { appendFileSync, mkdirSync } from 'node:fs';
import { WORKING_LEASE_MS, type SeatId } from '../../shared/hq.js';
import { loadHqLocal, readCrewFile } from '../workers/crew.js';
import { readRouterFlags } from './flags.js';
import { OVERSEER_ID, activeTop, type MeritDecision, type MeritKind, type Presence, type PrivacyClass, type RouterCandidate, type RouterId } from './merit.js';

const ROLE_ALIASES: Record<RouterId, readonly string[]> = {
  'george-router': ['george', 'george-router'],
  'kavi-router-2': ['kavi', 'muse', 'kavi-router', 'kavi-router-2'],
};

/** Not live for routing. `offline` stays here, and is not treated as idle. */
const OUT_WORDS = new Set([
  'out', 'absent', 'offline', 'stale', 'switching',
  'usage empty', 'usage-empty', 'usage_empty', 'cover on',
]);

const LIVE_WORDS = new Set(['working', 'busy', 'active', 'on', 'idle', 'done']);
const BLOCKED_WORDS = new Set(['blocked', 'needs_input', 'needs input']);

export interface CrewMeritInput {
  crew?: Record<string, unknown>;
  seen?: Record<string, unknown>;
  /** Seat id → display name from gitignored hq-local. */
  names?: Partial<Record<string, string>>;
  now?: number;
  leaseMs?: number;
}

function norm(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** A status string plus a fresh heartbeat. Unknown words are absent (fail closed). */
export function presenceFromStatus(status: unknown, seenAt: unknown, now: number, leaseMs = WORKING_LEASE_MS): Presence {
  if (typeof status !== 'string') return 'absent';
  const word = norm(status);
  if (!word) return 'absent';
  if (OUT_WORDS.has(word) || BLOCKED_WORDS.has(word)) return 'out';
  if (!LIVE_WORDS.has(word)) return 'absent';
  if (typeof seenAt !== 'number' || !Number.isFinite(seenAt)) return 'absent';
  if (seenAt > now || now - seenAt >= leaseMs) return 'out';
  return 'on';
}

function best(list: Presence[]): Presence {
  if (list.includes('on')) return 'on';
  if (list.includes('out')) return 'out';
  return 'absent';
}

function matches(role: RouterId, key: string, names: Partial<Record<string, string>>): boolean {
  const aliases = ROLE_ALIASES[role];
  if (aliases.includes(norm(key))) return true;
  const named = names[key];
  return typeof named === 'string' && aliases.includes(norm(named));
}

/** One candidate per router role. Missing from the crew file is absent, not guessed live. */
export function candidatesFromCrew(input: CrewMeritInput | null | undefined): RouterCandidate[] {
  const crew = input?.crew ?? {};
  const seen = input?.seen ?? {};
  const names = input?.names ?? {};
  const now = input?.now ?? Date.now();
  const leaseMs = input?.leaseMs ?? WORKING_LEASE_MS;
  return (Object.keys(ROLE_ALIASES) as RouterId[]).map((id) => {
    const presences: Presence[] = [];
    for (const [key, status] of Object.entries(crew)) {
      if (!matches(id, key, names)) continue;
      presences.push(presenceFromStatus(status, seen[key], now, leaseMs));
    }
    return { id, presence: best(presences) };
  });
}

export interface MeritHost {
  cfg: { dataDir: string };
  floors?: { values(): Iterable<{ dir?: string }> };
}

function seatNames(host: MeritHost): Partial<Record<SeatId, string>> {
  const names: Partial<Record<SeatId, string>> = {};
  const files = [path.join(host.cfg.dataDir, 'workers.json')];
  if (host.floors) {
    for (const floor of host.floors.values()) {
      if (floor?.dir) files.push(path.join(floor.dir, '.agent-office', 'workers.json'));
    }
  }
  for (const file of files) Object.assign(names, loadHqLocal(file).names);
  return names;
}

export function candidatesForHost(host: MeritHost, now = Date.now()): RouterCandidate[] {
  const file = readCrewFile(host.cfg.dataDir);
  return candidatesFromCrew({ crew: file?.crew, seen: file?.seen, names: seatNames(host), now });
}

/** Null while ROUTER_ON is off, so crew-status stays the file it already was. */
export function meritCrewAttachment(host: MeritHost, now = Date.now()): { top: RouterId | null; overseer: typeof OVERSEER_ID } | null {
  if (!readRouterFlags(process.env).routerOn) return null;
  return { top: activeTop(candidatesForHost(host, now)), overseer: OVERSEER_ID };
}

/** Counts only. No note, link, or task text. */
export function recordMerit(dataDir: string, decision: MeritDecision, privacy: PrivacyClass, kind: MeritKind, now = Date.now()): void {
  const line = {
    ts: new Date(now).toISOString(),
    task_id: decision.taskId,
    privacy,
    kind,
    top: decision.top,
    lane: decision.lane,
    hold: decision.hold,
    hold_reason: decision.holdReason ?? null,
  };
  try {
    const dir = path.join(dataDir, 'logs', 'routing');
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    appendFileSync(path.join(dir, 'merit.jsonl'), JSON.stringify(line) + '\n', { mode: 0o600 });
  } catch {
    // a full disk must not take the pick down
  }
}
