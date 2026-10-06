// Local HQ shapes shared by the office and its tests. Seat ids are generic except Okkin,
// the one local persona. Real crew names, tokens, and paths stay in gitignored config.

/** Nine generic seats. The public tree never fills these with a person's name. */
export const GENERIC_SEATS = ['seat-1', 'seat-2', 'seat-3', 'seat-4', 'seat-5', 'seat-6', 'seat-7', 'seat-8', 'seat-9'] as const;

/** The one Okkin seat. There is no second id, variant, or twin. */
export const OKKIN_SEAT = 'okkin' as const;

/** Ten seats: nine generic, then Okkin. */
export const CREW_SEATS = [...GENERIC_SEATS, OKKIN_SEAT] as const;

export type SeatId = (typeof CREW_SEATS)[number];

/** WORKING from a bridge push expires after this. A new push refreshes it. */
export const WORKING_LEASE_MS = 15 * 60_000;

/** After the lease, silence this long is stale, then offline. */
export const STALE_AFTER_MS = 30 * 60_000;
export const OFFLINE_AFTER_MS = 45 * 60_000;

export type HqLocal = {
  crewKeysLower: string[];
  humanAliases: string[];
  humanMapsTo: string;
  /** When true, mapped desks are crew seats instead of shell terminals. */
  crewDesks: boolean;
  /** Seat id → desk id (`desk-N`). Empty while `crewDesks` is on uses seat-1..6 → desk-1..6. Okkin's desk is only this map. */
  seats: Partial<Record<SeatId, string>>;
  ollamaUrl?: string;
  okkinModel?: string;
  okkinAllow?: string[];
  /**
   * Seat id → local display name. Absent on a public checkout, so the roster says `seat-N`.
   * Real names stay in gitignored hq-local.json.
   */
  names?: Partial<Record<SeatId, string>>;
};

export const EMPTY_HQ: HqLocal = {
  crewKeysLower: [],
  humanAliases: [],
  humanMapsTo: '',
  crewDesks: false,
  seats: {},
};

export function isSeatId(value: string): value is SeatId {
  return (CREW_SEATS as readonly string[]).includes(value);
}

const NAME_BAD = /[\\/:]|\d{1,3}(?:\.\d{1,3}){3}/;

/** Local display names only. A path, an address, or a blank is dropped. */
export function sanitizeNames(raw: unknown): Partial<Record<SeatId, string>> {
  const out: Partial<Record<SeatId, string>> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const seat of CREW_SEATS) {
    const value = (raw as Record<string, unknown>)[seat];
    if (typeof value !== 'string') continue;
    const name = value.replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 32);
    if (!name || NAME_BAD.test(name)) continue;
    out[seat] = name;
  }
  return out;
}

/** Public label is the seat id (`seat-1` … `seat-9`, or Okkin). A gitignored `names` map can override it on one machine. */
export function seatDisplayName(seat: SeatId, names?: Partial<Record<SeatId, string>>): string {
  return names?.[seat] || (seat === OKKIN_SEAT ? 'Okkin' : seat);
}

/** The only office line a talk adds when the seat is offline and nobody has replied. */
export function offlineQueuedNotice(displayName: string): string {
  return `offline \u2014 message queued for ${displayName}`;
}

const DESK_ID = /^desk-[1-9][0-9]?$/;

/** Keeps seat ids and desk ids only, one desk each, Okkin at most once. */
export function sanitizeSeatMap(raw: unknown): Partial<Record<SeatId, string>> {
  const out: Partial<Record<SeatId, string>> = {};
  if (!raw || typeof raw !== 'object') return out;
  const used = new Set<string>();
  for (const seat of CREW_SEATS) {
    const value = (raw as Record<string, unknown>)[seat];
    if (typeof value !== 'string' || !DESK_ID.test(value.trim())) continue;
    const desk = value.trim();
    if (used.has(desk)) continue;
    used.add(desk);
    out[seat] = desk;
  }
  return out;
}

/**
 * Desks to bind. Off unless config asks. With `crewDesks` and no map, seat-1..6 take desk-1..6.
 * Okkin is never given a desk the config did not name.
 */
export function activeSeatMap(hq: HqLocal): Partial<Record<SeatId, string>> {
  if (!hq.crewDesks) return {};
  const given = sanitizeSeatMap(hq.seats);
  if (Object.keys(given).length > 0) return given;
  const out: Partial<Record<SeatId, string>> = {};
  for (let i = 1; i <= 6; i++) out[`seat-${i}` as SeatId] = `desk-${i}`;
  return out;
}

export type BridgeBeat = { status: 'working' | 'idle' | 'blocked' | 'done'; at: number };

export type RosterChip = 'working' | 'blocked' | 'idle' | 'done' | 'stale' | 'offline' | 'switching';

/** Honest chip from the last bridge heartbeat. `blocked` (needs input) is never decayed away. */
export function rosterChip(beat: BridgeBeat | undefined, now: number): RosterChip {
  if (!beat || !Number.isFinite(beat.at)) return 'offline';
  const age = now - beat.at;
  if (age < 0) return 'offline';
  if (beat.status === 'blocked') return 'blocked';
  if (age >= OFFLINE_AFTER_MS) return 'offline';
  if (beat.status === 'working') {
    if (age < WORKING_LEASE_MS) return 'working';
    if (age < STALE_AFTER_MS) return 'idle';
    return 'stale';
  }
  if (age >= STALE_AFTER_MS) return 'stale';
  return beat.status === 'done' ? 'done' : 'idle';
}

export function ageLabel(at: number | undefined, now: number): string {
  if (at === undefined || !Number.isFinite(at)) return '—';
  const s = Math.max(0, Math.floor((now - at) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h`;
}

export type DeskCard = {
  task: string;
  milestone: string;
  link: string;
  condition: string;
  actions: string[];
  needs: string;
};

export const EMPTY_CARD: DeskCard = {
  task: 'No task yet',
  milestone: 'No milestone yet',
  link: '',
  condition: 'quiet',
  actions: [],
  needs: 'Nothing asked',
};

function clip(value: unknown, max: number): string {
  return String(value ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max);
}

/** http(s) only, no userinfo, no whitespace. Anything else is dropped. */
export function sanitizeLink(value: unknown): string {
  const raw = clip(value, 300);
  if (!raw) return '';
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    if (url.username || url.password) return '';
    return url.toString().slice(0, 300);
  } catch {
    return '';
  }
}

export function sanitizeCard(raw: unknown): DeskCard {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const actions = Array.isArray(o.actions) ? o.actions.map((a) => clip(a, 80)).filter(Boolean).slice(0, 6) : [];
  const task = clip(o.task, 120);
  const milestone = clip(o.milestone, 120);
  const condition = clip(o.condition, 40);
  const needs = clip(o.needs, 160);
  return {
    task: task || EMPTY_CARD.task,
    milestone: milestone || EMPTY_CARD.milestone,
    link: sanitizeLink(o.link),
    condition: condition || EMPTY_CARD.condition,
    actions,
    needs: needs || EMPTY_CARD.needs,
  };
}

const QUIET = new Set(['', 'quiet', 'idle', 'clear']);

/** A desk card that is live work, so the bot stays seated. */
export function liveDesk(card: DeskCard): boolean {
  return !QUIET.has(card.condition.trim().toLowerCase());
}

export type TalkRole = 'player' | 'bot' | 'office' | 'guest';

export type TalkMessage = { id: string; role: TalkRole; text: string; at: number; by?: string };

export type OutboxLine = {
  v: 1;
  kind: 'talk' | 'tchat';
  seat?: SeatId;
  role: TalkRole;
  text: string;
  at: string;
  thread?: SeatId;
  /** Account id of the person who sent a player or guest line. Omitted for the shared office password. */
  by?: string;
};

/** One outbox record, or null when the text is empty. `by` is present only when an account id was given. */
export function outboxLine(input: { kind: OutboxLine['kind']; role: TalkRole; text: string; at: number; seat?: string; by?: string }): OutboxLine | null {
  const text = clip(input.text, 500);
  if (!text) return null;
  const seat = input.seat && isSeatId(input.seat) ? input.seat : undefined;
  const by = typeof input.by === 'string' ? input.by.replace(/[\u0000-\u001f]/g, '').trim().slice(0, 64) : '';
  return {
    v: 1,
    kind: input.kind,
    ...(seat ? { seat, thread: seat } : {}),
    role: input.role,
    text,
    at: new Date(input.at).toISOString(),
    ...(by ? { by } : {}),
  };
}

/** Player chat never invents a crew reply. */
export function crewAutoReply(): null {
  return null;
}

export type Agency = 'seated' | 'aisle' | 'huddle' | 'hoop' | 'arcade';

/**
 * Idle crew may use the room. Working, blocked, switching, a live desk, or an open talk keeps them seated.
 * The choice never changes their status chip.
 */
export function chooseAgency(input: {
  idleClear: boolean;
  seatIndex: number;
  now: number;
  meetingOn: boolean;
  hoop: boolean;
  arcade: boolean;
}): Agency {
  if (!input.idleClear) return 'seated';
  const options: Agency[] = ['aisle'];
  if (input.meetingOn) options.push('huddle');
  if (input.hoop) options.push('hoop');
  if (input.arcade) options.push('arcade');
  const step = Math.floor(input.now / 45_000);
  return options[(step + input.seatIndex) % options.length]!;
}

export function bridgeBeat(status: unknown): BridgeBeat['status'] | null {
  if (typeof status !== 'string') return null;
  const s = status.toLowerCase();
  if (s === 'working' || s === 'busy' || s === 'active') return 'working';
  if (s === 'idle' || s === 'asleep' || s === 'roam' || s === 'offline' || s === 'done') return s === 'done' ? 'done' : 'idle';
  if (s === 'blocked' || s === 'needs_input' || s === 'needs input') return 'blocked';
  return null;
}

/** Model tags the desk may offer: allowlist ∩ installed, exact, no path-like names. */
export function modelChoices(allow: readonly string[], installed: readonly string[]): string[] {
  const have = new Set(installed);
  const out: string[] = [];
  for (const name of allow) {
    if (!modelTagOk(name) || !have.has(name) || out.includes(name)) continue;
    out.push(name);
  }
  return out;
}

export function modelTagOk(name: string): boolean {
  return name.length > 0 && name.length <= 80 && !/[\r\n\0]/.test(name) && !name.includes('..') && !/^[a-zA-Z]:[\\/]/.test(name);
}
