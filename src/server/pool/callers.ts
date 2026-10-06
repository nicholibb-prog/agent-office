import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { displayName, botName } from '../../shared/pool.js';
import { poolPath, readPrivate, writePrivate } from './persist.js';

interface CallerRow {
  name: string;
  tokenHash: string;
}

/**
 * Per-bot tokens for the pool. The shared bridge token is not a bot identity.
 * Only the hash is stored. The caller name is whatever was registered, never a body field at claim time.
 */
export class CallerBook {
  private rows: CallerRow[] = [];
  private file: string;

  constructor(dataDir: string) {
    this.file = poolPath(dataDir, 'work-pool-callers.json');
    const raw = readPrivate(this.file);
    if (raw && typeof raw === 'object' && Array.isArray((raw as { callers?: unknown }).callers)) {
      this.rows = (raw as { callers: CallerRow[] }).callers.filter((r) => r && typeof r.name === 'string' && typeof r.tokenHash === 'string');
    }
  }

  register(name: unknown): { name: string; token: string } | { error: string } {
    const shown = displayName(name);
    const key = botName(shown);
    if (!key || !/^[a-z0-9][a-z0-9 .-]{0,31}$/.test(key)) return { error: 'name must be letters, numbers, spaces, dots or hyphens' };
    if (this.rows.some((r) => botName(r.name) === key)) return { error: 'that caller is already registered' };
    if (this.rows.length >= 64) return { error: 'too many callers' };
    const token = randomBytes(32).toString('hex');
    this.rows.push({ name: shown, tokenHash: hashToken(token) });
    this.save();
    return { name: shown, token };
  }

  /** The registered display name for this token, or undefined. */
  nameFor(token: string): string | undefined {
    if (!token || token.length > 128) return undefined;
    const hash = hashToken(token);
    const row = this.rows.find((r) => safeEqual(r.tokenHash, hash));
    return row?.name;
  }

  private save() {
    writePrivate(this.file, { callers: this.rows.map((r) => ({ name: r.name, tokenHash: r.tokenHash })) });
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
