import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { botName, displayName, isPoolSeatId, reservedPoolName } from '../../shared/pool.js';
import { poolPath, readPrivate, writePrivate } from './persist.js';

interface CallerRow {
  id: string;
  name: string;
  tokenHash: string;
  /** Bound seat for presence. Presence never uses the display label alone. */
  seatId: string;
}

const books = new Set<CallerBook>();
const extraReserved = new Set<string>();

/** Names from the gitignored policy. They are not written into source. */
export function rememberReservedNames(names: readonly string[]) {
  for (const name of names) {
    const key = botName(name);
    if (key) extraReserved.add(key);
  }
}

/** True for a built-in role name, a seat-* id, or a name listed in the pool policy. */
export function poolNameBlocked(name: unknown): boolean {
  const key = botName(name);
  return reservedPoolName(name) || (!!key && extraReserved.has(key));
}

/**
 * True when any loaded caller book already uses this name.
 * Account creation checks it so the two namespaces cannot share a name.
 */
export function callerNameUsed(name: string): boolean {
  const key = botName(name);
  if (!key) return false;
  for (const book of books) if (book.hasName(key)) return true;
  return false;
}

/**
 * Per-bot tokens for the pool. The shared bridge token is not a bot identity.
 * Only the hash is stored. The id is what policy allowlists name.
 * Each caller is bound to a seatId; presence resolves through that map only.
 */
export class CallerBook {
  private rows: CallerRow[] = [];
  private file: string;

  constructor(dataDir: string) {
    this.file = poolPath(dataDir, 'work-pool-callers.json');
    const raw = readPrivate(this.file);
    if (raw && typeof raw === 'object' && Array.isArray((raw as { callers?: unknown }).callers)) {
      this.rows = (raw as { callers: CallerRow[] }).callers
        .filter((r) => r && typeof r.id === 'string' && typeof r.name === 'string' && typeof r.tokenHash === 'string')
        .map((r) => ({
          id: r.id,
          name: r.name,
          tokenHash: r.tokenHash,
          seatId: typeof r.seatId === 'string' && isPoolSeatId(r.seatId) ? r.seatId : '',
        }));
    }
    books.add(this);
  }

  hasName(key: string): boolean {
    return this.rows.some((r) => botName(r.name) === key);
  }

  hasSeat(seatId: string): boolean {
    return this.rows.some((r) => r.seatId === seatId);
  }

  /** callerId → seatId. Empty when the caller was never bound to a seat. */
  seatOf(callerId: string): string | undefined {
    const row = this.rows.find((r) => r.id === callerId);
    return row?.seatId && isPoolSeatId(row.seatId) ? row.seatId : undefined;
  }

  /**
   * `accountNames` are the office accounts. A caller cannot take one of those names,
   * a role name, a seat-* id, or a name listed in the pool policy.
   * `seatId` binds presence; when omitted, the next free seat-N is assigned.
   */
  register(
    name: unknown,
    accountNames: readonly string[] = [],
    seatId?: unknown,
  ): { id: string; name: string; token: string; seatId: string } | { error: string } {
    const shown = displayName(name);
    const key = botName(shown);
    if (!key || !/^[a-z0-9][a-z0-9 .-]{0,31}$/.test(key)) return { error: 'name must be letters, numbers, spaces, dots or hyphens' };
    if (poolNameBlocked(shown)) return { error: 'that name is reserved' };
    if (accountNames.some((n) => botName(n) === key)) return { error: 'that name is an account' };
    if (this.hasName(key)) return { error: 'that caller is already registered' };
    if (this.rows.length >= 64) return { error: 'too many callers' };
    const seat = this.pickSeat(seatId);
    if ('error' in seat) return seat;
    const token = randomBytes(32).toString('hex');
    const id = randomBytes(8).toString('hex');
    this.rows.push({ id, name: shown, tokenHash: hashToken(token), seatId: seat.seatId });
    this.save();
    return { id, name: shown, token, seatId: seat.seatId };
  }

  /** The registered id, label, and seat for this token, or undefined. */
  who(token: string): { id: string; label: string; seatId: string } | undefined {
    if (!token || token.length > 128) return undefined;
    const hash = hashToken(token);
    const row = this.rows.find((r) => safeEqual(r.tokenHash, hash));
    if (!row) return undefined;
    return { id: row.id, label: row.name, seatId: row.seatId };
  }

  private pickSeat(seatId: unknown): { seatId: string } | { error: string } {
    if (seatId !== undefined && seatId !== null && seatId !== '') {
      const asked = typeof seatId === 'string' ? seatId.trim().toLowerCase() : '';
      if (!isPoolSeatId(asked)) return { error: 'seat must be seat-N or okkin' };
      if (asked === 'okkin') return { error: 'that seat is reserved' };
      if (this.hasSeat(asked)) return { error: 'that seat is already taken' };
      return { seatId: asked };
    }
    for (let n = 1; n <= 99; n++) {
      const id = `seat-${n}`;
      if (!this.hasSeat(id)) return { seatId: id };
    }
    return { error: 'no free seat' };
  }

  private save() {
    writePrivate(this.file, {
      callers: this.rows.map((r) => ({ id: r.id, name: r.name, tokenHash: r.tokenHash, seatId: r.seatId })),
    });
  }
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}
