// Which provider a pluggable seat may use. The meeting room and the three front desks.
// A missing CLI is "no provider — needs owner". A local model that isn't answering is "offline".
// Neither state is WORKING, and neither invents a reply.

import type { DeskDef } from './layout.js';

export const SEAT_PROVIDERS = ['claude', 'grok', 'cursor-agent', 'bridge', 'ollama'] as const;
export type SeatProviderId = (typeof SEAT_PROVIDERS)[number];

export function isSeatProvider(value: unknown): value is SeatProviderId {
  return (SEAT_PROVIDERS as readonly unknown[]).includes(value);
}

/** The meeting room as one seat. Not a chair id. */
export const MEETING_SEAT = 'meeting-room';

export const NEEDS_OWNER = 'no provider — needs owner';
export const OFFLINE = 'offline';
/** A second local-model call for a seat that already has one in flight. */
export const LOCAL_BUSY = 'Local model is busy';
export const QUEUED_FOR_CREW = 'queued for crew';

/** Binaries we only look for. Nothing here installs them. */
export const SEAT_BINARIES = {
  claude: 'claude',
  grok: 'grok',
  'cursor-agent': 'cursor-agent',
} as const;

export type CliProviderId = keyof typeof SEAT_BINARIES;

export interface CliPresence {
  claude: boolean;
  grok: boolean;
  'cursor-agent': boolean;
}

export type OllamaHealth = 'ready' | 'offline';

/** The three desks on the south (street-facing) row, nearest the middle of the room. */
export function frontDeskIds(desks: Pick<DeskDef, 'id' | 'x' | 'z' | 'beanbag' | 'station' | 'room' | 'wing'>[]): string[] {
  const room = desks.filter((d) => !d.beanbag && !d.station && !d.room && !d.wing);
  if (!room.length) return [];
  const maxZ = Math.max(...room.map((d) => d.z));
  return room
    .filter((d) => d.z === maxZ)
    .sort((a, b) => Math.abs(a.x) - Math.abs(b.x) || a.x - b.x)
    .slice(0, 3)
    .map((d) => d.id);
}

export function isPluggableSeat(id: string, desks: Pick<DeskDef, 'id' | 'x' | 'z' | 'beanbag' | 'station' | 'room' | 'wing'>[]): boolean {
  return id === MEETING_SEAT || frontDeskIds(desks).includes(id);
}

/**
 * Ollama when the probe succeeded and a model is configured. Bridge otherwise.
 * An unset model is not healthy enough to take a turn: we do not invent one.
 */
export function defaultSeatProvider(ollama: OllamaHealth, modelSet: boolean): 'ollama' | 'bridge' {
  return ollama === 'ready' && modelSet ? 'ollama' : 'bridge';
}

export interface OutboxItem {
  title: string;
  text: string;
  at: string;
}

export function seatTurnTitle(floorId: string, seatId: string): string {
  return `seat:${floorId}:${seatId}`;
}

export function seatReplyTitle(floorId: string, seatId: string): string {
  return `reply:${floorId}:${seatId}`;
}

/** A turn the office queues for a real crew bot. Does not add a reply. */
export function appendSeatTurn(items: OutboxItem[], floorId: string, seatId: string, text: string, at: string): OutboxItem[] {
  const clean = text.trim().slice(0, 4000);
  if (!clean) return items;
  return [...items, { title: seatTurnTitle(floorId, seatId), text: clean, at }];
}

/** A reply only counts when something else posted `reply:…` with text. We never write those. */
export function latestCrewReply(items: OutboxItem[], floorId: string, seatId: string): OutboxItem | null {
  const title = seatReplyTitle(floorId, seatId);
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    if (it && it.title === title && it.text.trim()) return it;
  }
  return null;
}

/** Provider picked from a socket message. A url on the same object is not read. */
export function readSeatChoice(input: { provider?: unknown }): SeatProviderId | null {
  return isSeatProvider(input.provider) ? input.provider : null;
}
