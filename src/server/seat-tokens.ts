// Per-seat bridge tokens. Only a sha256 hash of each token is stored, in a 0600 file in the
// gitignored office data directory. The plain token is returned once, at creation, and never again.
import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync } from 'node:fs';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import path from 'node:path';

export const SEAT_ID_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;
const FILE = 'seat-tokens.json';

interface Entry { hash: string; createdAt: string }
interface Store { seats: Record<string, Entry> }

function file(dataDir: string): string {
  return path.join(dataDir, FILE);
}

function load(dataDir: string): Store {
  try {
    if (!existsSync(file(dataDir))) return { seats: {} };
    const s = JSON.parse(readFileSync(file(dataDir), 'utf8')) as Store;
    return s && typeof s.seats === 'object' && s.seats ? s : { seats: {} };
  } catch {
    return { seats: {} };
  }
}

function save(dataDir: string, s: Store): void {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  writeFileSync(file(dataDir), JSON.stringify(s, null, 2) + '\n', { mode: 0o600 });
  chmodSync(file(dataDir), 0o600);
}

function hashOf(token: string): Buffer {
  return createHash('sha256').update(token, 'utf8').digest();
}

/** Create or rotate one seat's token. Returns the plain token; only its hash is kept. */
export function issueSeatToken(dataDir: string, seat: string): string {
  if (!SEAT_ID_RE.test(seat)) throw new Error('bad seat id');
  const token = randomBytes(32).toString('base64url');
  const s = load(dataDir);
  s.seats[seat] = { hash: hashOf(token).toString('hex'), createdAt: new Date().toISOString() };
  save(dataDir, s);
  return token;
}

/** Revoke one seat. Returns false when it had no token. */
export function revokeSeatToken(dataDir: string, seat: string): boolean {
  const s = load(dataDir);
  if (!s.seats[seat]) return false;
  delete s.seats[seat];
  save(dataDir, s);
  return true;
}

/** Seat ids with a live token (never hashes or tokens). */
export function listSeats(dataDir: string): { seat: string; createdAt: string }[] {
  return Object.entries(load(dataDir).seats).map(([seat, e]) => ({ seat, createdAt: e.createdAt }));
}

/** The seat a token belongs to, or null. Compares hashes in constant time against every entry. */
export function seatForToken(dataDir: string, token: string): string | null {
  if (!token) return null;
  const got = hashOf(token);
  let found: string | null = null;
  for (const [seat, e] of Object.entries(load(dataDir).seats)) {
    const want = Buffer.from(String(e.hash), 'hex');
    if (want.length === got.length && timingSafeEqual(want, got) && found === null) found = seat;
  }
  return found;
}
