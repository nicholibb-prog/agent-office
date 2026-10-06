// First-frame unblock queue and the morning delta. Pure: no files, no replies.
// Seat labels come from the caller's book (gitignored hq-local.json). This module
// never names a person.

import type { WorkerInfo } from './protocol.js';

/** A generic seat token: `seat-a`, `desk-1`, `queue`. Not a display name. */
export const SEAT_KEY = /^[a-z0-9][a-z0-9-]{0,31}$/;

/** Lines kept in each morning bucket, newest first. */
export const LINE_CAP = 6;
export const TITLE_MAX = 80;
/** Longer than this, or a line break, and it is an essay — dropped. */
export const ESSAY_MAX = 200;
/** First open, with no stamp yet: only the last twelve hours. */
export const FIRST_WINDOW_MS = 12 * 60 * 60 * 1000;

/** What a one-tap Yes/No types into the worker. The same keys as a permission prompt. */
export const YES_KEY = '1';
export const NO_KEY = '2';

export type BlockKind = 'yesno' | 'talk';
export type BoardState = 'done' | 'progress' | 'blocked';

export type Decision = {
  id: string;
  seat: string;
  title: string;
  at: number;
  kind: BlockKind;
  workerId?: string;
};

export type BoardItem = {
  id: string;
  seat: string;
  title: string;
  state: BoardState;
  at: number;
};

export type SeatBook = {
  seats: Record<string, string>;
  crewKeysLower: string[];
};

export const EMPTY_BOOK: SeatBook = { seats: {}, crewKeysLower: [] };

export type LiveWorker = {
  id: string;
  deskId: string;
  name: string;
  status: WorkerInfo['status'];
  activity?: string;
  taskName?: string;
  waitingSince?: number;
  createdAt: number;
  lastInputAt?: number;
};

export type LiveTask = {
  id: string;
  title: string;
  status: 'queued' | 'running' | 'done';
  addedAt: number;
  startedAt?: number;
  finishedAt?: number;
  workerId?: string;
};

export type DigestLine = { title: string; at: number };
export type DigestSeat = { seat: string; lines: DigestLine[] };
export type DigestBucket = { seats: DigestSeat[]; capped: boolean };
export type Digest = {
  since: number;
  done: DigestBucket;
  progress: DigestBucket;
  blocked: DigestBucket;
};

export type Brief = {
  headline: string;
  blocks: Decision[];
  digest: Digest;
};

const YESNO = /permission|approve|allow\b|\(y\/n\)|yes\/no/i;

/** Desk id, a mapped seat, or a crew key. An unmapped name becomes the desk id, or `seat`. */
export function seatKey(name: string, deskId: string | undefined, book: SeatBook): string {
  const desk = (deskId || '').trim().toLowerCase();
  const fromDesk = desk && book.seats[desk];
  if (fromDesk && SEAT_KEY.test(fromDesk)) return fromDesk;
  const n = name.trim().toLowerCase();
  const fromName = n && book.seats[n];
  if (fromName && SEAT_KEY.test(fromName)) return fromName;
  if (n && book.crewKeysLower.some((k) => k.toLowerCase() === n) && SEAT_KEY.test(n)) return n;
  if (desk && SEAT_KEY.test(desk)) return desk;
  return 'seat';
}

/** A seat string already generic (`seat-*`, `desk-*`, `queue`) or listed in the book. */
export function acceptSeat(raw: string, book: SeatBook): string | null {
  const s = raw.trim().toLowerCase();
  if (!SEAT_KEY.test(s)) return null;
  if (book.crewKeysLower.some((k) => k.toLowerCase() === s)) return s;
  if (Object.values(book.seats).includes(s)) return s;
  if (/^desk-[a-z0-9-]+$/.test(s) || /^seat-[a-z0-9-]+$/.test(s) || s === 'queue') return s;
  return null;
}

function resolveSeat(raw: string, book: SeatBook): string {
  return acceptSeat(raw, book) ?? seatKey(raw, undefined, book);
}

/** One short line, or null when it is blank or an essay. */
export function blockTitle(raw: string | undefined): string | null {
  if (!raw) return null;
  if (raw.length > ESSAY_MAX || /[\r\n]/.test(raw)) return null;
  const t = raw.replace(/\s+/g, ' ').trim();
  if (!t) return null;
  return t.length > TITLE_MAX ? `${t.slice(0, TITLE_MAX - 1)}…` : t;
}

/** Age for a row. Always a number, including the first minute. */
export function ageLabel(at: number, now: number): string {
  const s = Math.max(0, Math.floor((now - at) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

export function answerKey(answer: 'yes' | 'no'): string {
  return answer === 'yes' ? YES_KEY : NO_KEY;
}

/** Stable hash of the title a person tapped. The server rechecks it against the live desk. */
export function titleHash(title: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < title.length; i++) {
    h ^= title.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export function sinceOf(requested: number | undefined, stored: number | undefined, now: number): number {
  const ok = (n: number | undefined): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0 && n <= now + 60_000;
  const hits = [requested, stored].filter(ok);
  if (!hits.length) return now - FIRST_WINDOW_MS;
  return Math.max(...hits);
}

/** Strip headline. A short token from the local file, otherwise a fixed phrase. */
export function headlineFor(humanMapsTo: string): string {
  const s = humanMapsTo.trim().toLowerCase();
  if (SEAT_KEY.test(s)) return `Needs ${s}`;
  return 'Needs a decision';
}

type Raw = Record<string, unknown>;

function essayish(raw: Raw): boolean {
  return raw.body != null || raw.essay != null || raw.text != null || raw.note != null || raw.markdown != null;
}

/** A file block is actionable only when it says so, and only as yes/no or talk. */
export function fileBlock(raw: unknown, book: SeatBook): Decision | null {
  if (!raw || typeof raw !== 'object') return null;
  const b = raw as Raw;
  if (b.actionable !== true || essayish(b)) return null;
  if (b.kind !== 'yesno' && b.kind !== 'talk') return null;
  if (typeof b.title !== 'string' || /[\r\n]/.test(b.title)) return null;
  const title = b.title.replace(/\s+/g, ' ').trim();
  if (!title || title.length > TITLE_MAX) return null;
  if (typeof b.at !== 'number' || !Number.isFinite(b.at)) return null;
  if (typeof b.id !== 'string' || !b.id.trim()) return null;
  const seatRaw = typeof b.seat === 'string' ? b.seat : '';
  const workerId = typeof b.workerId === 'string' && b.workerId.trim() ? b.workerId.trim().slice(0, 64) : undefined;
  return {
    id: b.id.trim().slice(0, 64),
    seat: resolveSeat(seatRaw, book),
    title,
    at: b.at,
    kind: b.kind,
    workerId,
  };
}

/** A live desk is actionable only while it needs input and the ask is one short line. */
export function liveBlock(w: LiveWorker, book: SeatBook): Decision | null {
  if (w.status !== 'needs_input') return null;
  const title = blockTitle(w.activity) || blockTitle(w.taskName);
  if (!title) return null;
  return {
    id: `live:${w.id}`,
    seat: seatKey(w.name, w.deskId, book),
    title,
    at: w.waitingSince ?? w.createdAt,
    kind: YESNO.test(title) ? 'yesno' : 'talk',
    workerId: w.id,
  };
}

/** Live rows win over a file row for the same worker. Oldest wait first. */
export function mergeBlocks(file: readonly Decision[], live: readonly Decision[]): Decision[] {
  const ids = new Set(live.map((b) => b.workerId).filter((id): id is string => !!id));
  const rest = file.filter((b) => !b.workerId || !ids.has(b.workerId));
  return [...live, ...rest].sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
}

export function liveFromInfo(w: Pick<WorkerInfo, 'id' | 'deskId' | 'name' | 'status' | 'activity' | 'task' | 'waitingSince' | 'createdAt' | 'lastInput'>): LiveWorker {
  return {
    id: w.id,
    deskId: w.deskId,
    name: w.name,
    status: w.status,
    activity: w.activity,
    taskName: w.task?.name,
    waitingSince: w.waitingSince,
    createdAt: w.createdAt,
    lastInputAt: w.lastInput?.at,
  };
}

function itemTitle(raw: string | undefined): string | null {
  if (!raw || /[\r\n]/.test(raw)) return null;
  const t = raw.replace(/\s+/g, ' ').trim();
  if (!t || t.length > TITLE_MAX) return null;
  return t;
}

export function fileItem(raw: unknown, book: SeatBook): BoardItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const b = raw as Raw;
  if (essayish(b)) return null;
  if (b.state !== 'done' && b.state !== 'progress' && b.state !== 'blocked') return null;
  const title = itemTitle(typeof b.title === 'string' ? b.title : undefined);
  if (!title || typeof b.at !== 'number' || !Number.isFinite(b.at)) return null;
  if (typeof b.id !== 'string' || !b.id.trim()) return null;
  const seatRaw = typeof b.seat === 'string' ? b.seat : '';
  return { id: b.id.trim().slice(0, 64), seat: resolveSeat(seatRaw, book), title, state: b.state, at: b.at };
}

/** Status lines from a desk. Working stays working only when the desk already says so. */
export function workerItems(w: LiveWorker, book: SeatBook): BoardItem[] {
  const seat = seatKey(w.name, w.deskId, book);
  const named = itemTitle(w.taskName);
  const ask = blockTitle(w.activity);
  if (w.status === 'done' && w.waitingSince) {
    return [{ id: `w:${w.id}:done`, seat, title: named || 'finished', state: 'done', at: w.waitingSince }];
  }
  if (w.status === 'working' || w.status === 'starting') {
    return [{ id: `w:${w.id}:progress`, seat, title: named || 'in progress', state: 'progress', at: w.lastInputAt ?? w.createdAt }];
  }
  if (w.status === 'needs_input' && w.waitingSince && (ask || named)) {
    return [{ id: `w:${w.id}:blocked`, seat, title: ask || named!, state: 'blocked', at: w.waitingSince }];
  }
  return [];
}

export function taskSeat(t: LiveTask, workers: readonly LiveWorker[], book: SeatBook): string {
  const w = t.workerId ? workers.find((x) => x.id === t.workerId) : undefined;
  if (w) return seatKey(w.name, w.deskId, book);
  return 'queue';
}

export function taskItems(t: LiveTask, seat: string): BoardItem[] {
  const title = itemTitle(t.title);
  if (!title || !SEAT_KEY.test(seat)) return [];
  if (t.status === 'done' && t.finishedAt) return [{ id: `q:${t.id}`, seat, title, state: 'done', at: t.finishedAt }];
  if (t.status === 'running') return [{ id: `q:${t.id}`, seat, title, state: 'progress', at: t.startedAt ?? t.addedAt }];
  return [];
}

export function collectItems(file: readonly BoardItem[], workers: readonly LiveWorker[], tasks: readonly LiveTask[], book: SeatBook): BoardItem[] {
  const items = [...file];
  for (const w of workers) items.push(...workerItems(w, book));
  for (const t of tasks) items.push(...taskItems(t, taskSeat(t, workers, book)));
  return items;
}

function bucket(items: readonly BoardItem[], state: BoardState): DigestBucket {
  const all = items.filter((i) => i.state === state);
  const picked = all.slice(0, LINE_CAP);
  const seats: DigestSeat[] = [];
  for (const item of picked) {
    let g = seats.find((s) => s.seat === item.seat);
    if (!g) {
      g = { seat: item.seat, lines: [] };
      seats.push(g);
    }
    g.lines.push({ title: item.title, at: item.at });
  }
  return { seats, capped: all.length > LINE_CAP };
}

/** Newest first, then grouped by seat. Items at or before `since` are not a delta. */
export function buildDigest(items: readonly BoardItem[], since: number, now: number): Digest {
  const seen = new Set<string>();
  const uniq: BoardItem[] = [];
  const fresh = items.filter((i) => i.at > since && i.at <= now + 60_000).sort((a, b) => b.at - a.at || a.id.localeCompare(b.id));
  for (const i of fresh) {
    const k = `${i.state}|${i.seat}|${i.title}`;
    if (seen.has(k)) continue;
    seen.add(k);
    uniq.push(i);
  }
  return { since, done: bucket(uniq, 'done'), progress: bucket(uniq, 'progress'), blocked: bucket(uniq, 'blocked') };
}

export function digestHasLines(d: Digest): boolean {
  return d.done.seats.length + d.progress.seats.length + d.blocked.seats.length > 0;
}
