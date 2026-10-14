// Pure view rules for the owner-only windows (crew talk, Kavi thread, Kavi outbox). No DOM here.
import { DESK_BY_ID } from './layout.js';
import { OKKIN_SEAT, UNMAPPED_SEAT_LABEL, type OutboxRow } from './hq.js';
import { MEETING_SEAT } from './seat-provider.js';

export const SESSION_EXPIRED_NOTE = 'Session expired, sign in again';
export const KAVI_PRIVATE_NOTE = 'The Kavi thread is private — unlock owner to see it.';
export const KAVI_SENT_PRIVATE_NOTE = 'Sent. Only the owner can see the thread';
export const UNLOCK_OWNER_LABEL = 'Unlock owner';
/** Neutral grey for every private note (never the error red). */
export const PRIVATE_NOTE_GREY = '#9aa0a6';

/** A 401 is a lapsed office session: one fixed line, never "could not load". */
export function loadFailNote(status: number | undefined, fallback: string): string {
  return status === 401 ? SESSION_EXPIRED_NOTE : fallback;
}

/** Crew seat → friendly name from the roster (`names`); the generic id when no name is known. */
export function crewName(seat: string | null | undefined, names: Readonly<Record<string, string | undefined>> = {}): string {
  if (!seat) return UNMAPPED_SEAT_LABEL;
  const n = names[seat]?.trim();
  if (n) return n;
  return seat === OKKIN_SEAT ? 'Okkin' : seat;
}

/** Desk or meeting id → its label in the layout ("Desk 3", "Meeting room"). Unknown ids stay as given. */
export function deskName(id: string): string {
  if (id === MEETING_SEAT) return 'Meeting room';
  return DESK_BY_ID.get(id)?.label ?? id;
}

/** An outbox item title for people: "seat:<floor>:<desk>" → "Desk 3 turn"; "reply:…" → "Desk 3 reply". */
export function outboxTitle(title: string): string {
  const m = /^(seat|reply):[^:]+:(.+)$/.exec(title);
  if (!m) return title;
  return `${deskName(m[2]!)} ${m[1] === 'seat' ? 'turn' : 'reply'}`;
}

export type FriendlyOutboxRow = OutboxRow & { label: string; who: string; raw: string };

export function friendlyOutbox(rows: readonly OutboxRow[], names: Readonly<Record<string, string | undefined>> = {}): FriendlyOutboxRow[] {
  return rows.map((r) => ({ ...r, raw: r.title, label: outboxTitle(r.title), who: r.mapped ? crewName(r.seat, names) : UNMAPPED_SEAT_LABEL }));
}

/**
 * What a thread window shows after a load. When the server goes private (owner lock or the idle
 * timeout) the last thread stays on screen and the note sits above it; nothing is wiped.
 */
export function keepOnLock<T>(prev: readonly T[], next: { private?: boolean | null; items: readonly T[] }, privateNote: string): { items: T[]; note: string | null; stale: boolean } {
  if (next.private === true) return prev.length ? { items: [...prev], note: privateNote, stale: true } : { items: [], note: privateNote, stale: false };
  return { items: [...next.items], note: null, stale: false };
}

/** A non-owner's own Kavi sends this session: shown with the sent note, since the thread itself is private. */
export function kaviPrivateView<T extends { from: string }>(prevOwnerItems: readonly T[], localSent: readonly T[], isPrivate: boolean): { items: T[]; note: string | null } {
  if (!isPrivate) return { items: [...prevOwnerItems, ...localSent], note: null };
  if (prevOwnerItems.length) return { items: [...prevOwnerItems, ...localSent], note: KAVI_PRIVATE_NOTE };
  return { items: [...localSent], note: localSent.length ? KAVI_SENT_PRIVATE_NOTE : KAVI_PRIVATE_NOTE };
}
