import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { botName, displayName, reservedPoolName } from '../../shared/pool.js';
import { poolPath, readPrivate, writePrivate } from './persist.js';

interface CallerRow {
  id: string;
  name: string;
  tokenHash: string;
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

/** True for a built-in role name or a name listed in the pool policy. */
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
 */
export class CallerBook {
  private rows: CallerRow[] = [];
  private file: string;

  constructor(dataDir: string) {
    this.file = poolPath(dataDir, 'work-pool-callers.json');
    const raw = readPrivate(this.file);
    if (raw && typeof raw === 'object' && Array.isArray((raw as { callers?: unknown }).callers)) {
      this.rows = (raw as { callers: CallerRow[] }).callers.filter((r) => r && typeof r.id === 'string' && typeof r.name === 'string' && typeof r.tokenHash === 'string');
    }
    books.add(this);
  }

  hasName(key: string): boolean {
    return this.rows.some((r) => botName(r.name) === key);
  }

  /**
   * `accountNames` are the office accounts. A caller cannot take one of those names,
   * a role name, or a name listed in the pool policy.
   */
  register(name: unknown, accountNames: readonly string[] = []): { id: string; name: string; token: string } | { error: string } {
    const shown = displayName(name);
    const key = botName(shown);
    if (!key || !/^[a-z0-9][a-z0-9 .-]{0,31}$/.test(key)) return { error: 'name must be letters, numbers, spaces, dots or hyphens' };
    if (poolNameBlocked(shown)) return { error: 'that name is reserved' };
    if (accountNames.some((n) => botName(n) === key)) return { error: 'that name is an account' };
    if (this.hasName(key)) return { error: 'that caller is already registered' };
    if (this.rows.length >= 64) return { error: 'too many callers' };
    const token = randomBytes(32).toString('hex');
    const id = randomBytes(8).toString('hex');
    this.rows.push({ id, name: shown, tokenHash: hashToken(token) });
    this.save();
    return { id, name: shown, token };
  }

  /** The registered id and label for this token, or undefined. */
  who(token: string): { id: string; label: string } | undefined {
    if (!token || token.length > 128) return undefined;
    const hash = hashToken(token);
    const row = this.rows.find((r) => safeEqual(r.tokenHash, hash));
    return row ? { id: row.id, label: row.name } : undefined;
  }

  private save() {
    writePrivate(this.file, { callers: this.rows.map((r) => ({ id: r.id, name: r.name, tokenHash: r.tokenHash })) });
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
