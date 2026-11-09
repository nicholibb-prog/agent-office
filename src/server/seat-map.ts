// Explicit server-side map from a floor's desk or meeting seat to its crew seat.
// .agent-office/seat-map.json (gitignored): { "<floorId>:<deskOrMeetingId>": "<crewSeatId>" }.
// Never derived from client data or defaults. Unmapped or invalid means null (owner-only).
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { isSeatId, type SeatId } from '../shared/hq.js';

export const SEAT_MAP_FILE = 'seat-map.json';

export function loadSeatMap(dataDir: string): Record<string, SeatId> {
  const out: Record<string, SeatId> = {};
  try {
    const file = path.join(dataDir, SEAT_MAP_FILE);
    if (!existsSync(file)) return out;
    const raw = JSON.parse(readFileSync(file, 'utf8')) as unknown;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (!/^[^:\s]+:[^:\s]+$/.test(k) || typeof v !== 'string' || !isSeatId(v)) continue;
      out[k] = v;
    }
  } catch {
    /* unreadable map: everything stays owner-only */
  }
  return out;
}

/** Crew seat for one seat-provider turn, or null. Exact key match only. */
export function crewSeatFor(dataDir: string, floorId: string, seatId: string): SeatId | null {
  const map = loadSeatMap(dataDir);
  const key = `${floorId}:${seatId}`;
  return Object.prototype.hasOwnProperty.call(map, key) ? map[key]! : null;
}
