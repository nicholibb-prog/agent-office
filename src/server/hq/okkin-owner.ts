// Okkin's controls (power, the model switch, Ask) are the owner's alone, checked here on the server.
//
// The owner proves it with a SEPARATE owner passphrase, set once on the office machine with
// `npm run owner:set` (TTY prompt, no echo, asked twice). Only a salted scrypt hash is stored, in an
// owner-only file (0600, in a 0700 folder) outside the repo; the plaintext never touches disk, argv,
// env or logs. 'Unlock owner' in the Okkin panel checks the passphrase (constant-time), rate-limited
// (5 failures per 15 minutes per address, and 20 per 15 minutes across all addresses, each then
// locked out for 15 minutes), and on success sets a
// separate owner cookie: HttpOnly, SameSite=Strict, Secure on https, 15 minutes idle, 1 hour at most,
// in memory only (a restart or Lock clears it). Power needs a fresh unlock (within 5 minutes).
//
// Who may unlock: anyone in an office-password session (or an account session) who types the right
// passphrase. The owner does NOT need an account, and the approvers list (work-pool-policy.json) is
// deliberately NOT consulted: it was dropped on purpose, so the passphrase is the one thing that makes
// the owner. The session alone is never enough.
//
// Nothing else is the owner: not the office password session, not an account, and never a request
// carrying a bot credential (x-bridge-token / seat token, x-pool-caller, any Authorization), even with
// an owner cookie alongside. Every refusal is logged: time, route, caller kind; never input or tokens.
//
// TODO: a passkey (WebAuthn) instead of, or as well as, the passphrase.
import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isMajorFiles } from '../major-files.js';
import type http from 'node:http';
import os from 'node:os';
import path from 'node:path';

export const OKKIN_REFUSALS_LOG = 'okkin-refusals.log';
export const OWNER_COOKIE = 'ao_okkin_owner';
export const OWNER_IDLE_MS = 15 * 60_000;
export const OWNER_MAX_MS = 60 * 60_000;
export const OWNER_FRESH_MS = 5 * 60_000;
export const UNLOCK_TRIES = 5;
export const UNLOCK_WINDOW_MS = 15 * 60_000;
export const PASSPHRASE_MIN = 12;
const SCRYPT = { N: 1 << 15, r: 8, p: 1, keylen: 32 } as const;

/** Where the hash lives: AGENT_OFFICE_OWNER_FILE (a path, never a secret), else the user's config folder, outside any repo. */
export function ownerFile(env: NodeJS.ProcessEnv = process.env): string {
  if (env.AGENT_OFFICE_OWNER_FILE) return path.resolve(env.AGENT_OFFICE_OWNER_FILE);
  const base = process.platform === 'win32' ? (env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming')) : (env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config'));
  return path.join(base, 'agent-office', 'okkin-owner.json');
}

/** The repo (or installed package) this code runs from: the owner file may never live inside it. */
export const CODE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

/** Where `p` really leads: the realpath of its nearest existing ancestor, plus the rest. */
function realpathNearest(p: string): string {
  let dir = path.resolve(p);
  const rest: string[] = [];
  for (;;) {
    try {
      return path.join(realpathSync(dir), ...rest);
    } catch {
      const up = path.dirname(dir);
      if (up === dir) return path.resolve(p);
      rest.unshift(path.basename(dir));
      dir = up;
    }
  }
}
const inside = (child: string, root: string) => child === root || child.startsWith(root.endsWith(path.sep) ? root : root + path.sep);

/**
 * Why `file` may not hold the owner hash, or null if it may. Major Files is checked on the path as
 * given (no fs call at all), then on its realpath; and never inside the code's own repo. Every fs
 * entry point below asks this first, so a refused path is never read or written.
 */
export function ownerFileRefusal(file: string): string | null {
  if (isMajorFiles(path.resolve(file))) return 'inside Major Files';
  const real = realpathNearest(file);
  if (isMajorFiles(real)) return 'inside Major Files';
  let root = CODE_ROOT;
  try {
    root = realpathSync(CODE_ROOT);
  } catch {
    // keep the resolved path
  }
  if (inside(real, root) || inside(path.resolve(file), CODE_ROOT)) return 'inside the repo';
  return null;
}

type Stored = { v: 1; kdf: 'scrypt'; N: number; r: number; p: number; salt: string; hash: string };

function derive(pass: string, salt: Buffer, s: { N: number; r: number; p: number }): Promise<Buffer> {
  return new Promise((resolve, reject) => scrypt(pass.normalize('NFKC'), salt, SCRYPT.keylen, { N: s.N, r: s.r, p: s.p, maxmem: 128 * s.N * s.r * 2 }, (e, k) => (e ? reject(e) : resolve(k))));
}

/** Writes the hash (never the passphrase) to `file`: folder 0700, file 0600, atomically. */
export async function setOwnerPassphrase(file: string, pass: string): Promise<void> {
  const refused = ownerFileRefusal(file);
  if (refused) throw new Error(`refusing AGENT_OFFICE_OWNER_FILE ${refused}; keep it in your user config folder`);
  if (pass.length < PASSPHRASE_MIN) throw new Error(`the owner passphrase needs at least ${PASSPHRASE_MIN} characters`);
  const salt = randomBytes(16);
  const hash = await derive(pass, salt, SCRYPT);
  const body: Stored = { v: 1, kdf: 'scrypt', N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, salt: salt.toString('base64'), hash: hash.toString('base64') };
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(body), { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, file);
  chmodSync(file, 0o600);
  // The new sha256, noted beside it. A running office still holds the old pin: it refuses until restarted.
  writeSidecar(file, fileSha(file));
}

/** The stored hash, or null when there's none (or it isn't owner-only on POSIX: then it doesn't count). */
function readStored(file: string): Stored | null {
  if (ownerFileRefusal(file)) return null; // fail closed: nobody is the owner
  try {
    if (!existsSync(file)) return null;
    if (process.platform !== 'win32') {
      const st = statSync(file);
      if (st.mode & 0o077) return null;
      if (typeof process.getuid === 'function' && st.uid !== process.getuid()) return null;
    }
    const s = JSON.parse(readFileSync(file, 'utf8')) as Stored;
    return s.v === 1 && s.kdf === 'scrypt' && s.salt && s.hash ? s : null;
  } catch {
    return null;
  }
}

export const ownerSetUp = (file = ownerFile()) => readStored(file) !== null;

// --- integrity: the hash file's sha256, pinned when the office starts (or this process sets it) ---
//
// A known gap: any process running as the same OS user can overwrite the owner file. This check makes
// a swap visible and fails closed (no unlocks, live owner sessions dropped) until the office restarts;
// the real fix is running bots under a separate Windows account. See docs/hq.md.
export const INTEGRITY_EVERY_MS = 60_000;
const integrity = { file: '', pinned: undefined as string | null | undefined, changed: false, dataDir: '', timer: null as NodeJS.Timeout | null };
const fileSha = (file: string): string | null => {
  if (ownerFileRefusal(file)) return null;
  try {
    return existsSync(file) ? createHash('sha256').update(readFileSync(file)).digest('hex') : null;
  } catch {
    return null;
  }
};
const sidecar = (file: string) => `${file}.sha256`;
function writeSidecar(file: string, sha: string | null) {
  if (ownerFileRefusal(file)) return;
  try {
    if (sha) writeFileSync(sidecar(file), `${sha}\n`, { mode: 0o600 });
  } catch {
    // The sidecar is a note for people; the pin in memory is what counts.
  }
}

/** Pins the owner file's sha256 (once per process; called when the office starts and on first use). */
export function pinOwnerIntegrity(dataDir: string, file = ownerFile(), opts: { timer?: boolean } = {}) {
  if (integrity.pinned !== undefined && integrity.file === file) return;
  integrity.file = file;
  integrity.dataDir = dataDir;
  integrity.pinned = fileSha(file);
  integrity.changed = false;
  writeSidecar(file, integrity.pinned);
  if (opts.timer !== false && !integrity.timer) {
    integrity.timer = setInterval(() => checkOwnerIntegrity(), INTEGRITY_EVERY_MS);
    integrity.timer.unref();
  }
}

/** True while the owner file still matches the pin. On a change: log, drop owner sessions, refuse until restart. */
export function checkOwnerIntegrity(): boolean {
  if (integrity.pinned === undefined) return true;
  if (integrity.changed) return false;
  const now = fileSha(integrity.file);
  if (now === integrity.pinned) return true;
  integrity.changed = true;
  sessions.clear();
  if (integrity.dataDir) logOkkinRefusal(integrity.dataDir, { route: 'owner-file-integrity', caller: now === null ? 'owner-file-missing' : 'owner-file-changed' });
  return false;
}

export async function checkOwnerPassphrase(file: string, pass: string): Promise<boolean> {
  const s = readStored(file);
  if (!s || typeof pass !== 'string' || !pass || pass.length > 1024) return false;
  const want = Buffer.from(s.hash, 'base64');
  const got = await derive(pass, Buffer.from(s.salt, 'base64'), s);
  return got.length === want.length && timingSafeEqual(got, want);
}

// --- rate limit, in memory: per address, and globally across all addresses ---
export const UNLOCK_TRIES_GLOBAL = 20;
export const UNLOCK_KEYS_MAX = 1000;
const fails = new Map<string, { at: number[]; lockedUntil: number }>();
const global = { at: [] as number[], lockedUntil: 0 };
/** Drops expired entries (every call), and caps the map at UNLOCK_KEYS_MAX keys (oldest first). */
function prune(now: number) {
  for (const [k, f] of fails) {
    f.at = f.at.filter((t) => now - t < UNLOCK_WINDOW_MS);
    if (!f.at.length && f.lockedUntil <= now) fails.delete(k);
  }
  global.at = global.at.filter((t) => now - t < UNLOCK_WINDOW_MS);
  while (fails.size > UNLOCK_KEYS_MAX) fails.delete(fails.keys().next().value!);
}
export function unlockLocked(addr: string, now = Date.now()): boolean {
  prune(now);
  return global.lockedUntil > now || (fails.get(addr)?.lockedUntil ?? 0) > now;
}
export function noteUnlockFailure(addr: string, now = Date.now()) {
  prune(now);
  const f = fails.get(addr) ?? { at: [], lockedUntil: 0 };
  f.at.push(now);
  if (f.at.length >= UNLOCK_TRIES) f.lockedUntil = now + UNLOCK_WINDOW_MS;
  fails.delete(addr);
  fails.set(addr, f); // most recent last, so the cap drops the oldest
  global.at.push(now);
  if (global.at.length >= UNLOCK_TRIES_GLOBAL) global.lockedUntil = now + UNLOCK_WINDOW_MS;
  while (fails.size > UNLOCK_KEYS_MAX) fails.delete(fails.keys().next().value!);
}
/** For tests: how many addresses the limiter holds. */
export const unlockKeys = () => fails.size;

// --- owner sessions, in memory only (a restart clears them) ---
type OwnerSession = { created: number; seen: number; unlocked: number };
const sessions = new Map<string, OwnerSession>();
const key = (token: string) => createHash('sha256').update(token).digest('hex');

export function startOwnerSession(now = Date.now()): string {
  const token = randomBytes(32).toString('base64url');
  sessions.set(key(token), { created: now, seen: now, unlocked: now });
  return token;
}
export function endOwnerSession(token: string | null) {
  if (token) sessions.delete(key(token));
}
export function resetOwnerForTests() {
  sessions.clear();
  fails.clear();
  global.at = [];
  global.lockedUntil = 0;
  if (integrity.timer) clearInterval(integrity.timer);
  Object.assign(integrity, { file: '', pinned: undefined, changed: false, dataDir: '', timer: null });
}

export function cookieOf(req: http.IncomingMessage, name = OWNER_COOKIE): string | null {
  const raw = req.headers.cookie;
  if (typeof raw !== 'string') return null;
  for (const part of raw.split(';')) {
    const at = part.indexOf('=');
    if (at > 0 && part.slice(0, at).trim() === name) return part.slice(at + 1).trim() || null;
  }
  return null;
}

export function ownerCookieHeader(token: string, secure: boolean): string {
  return `${OWNER_COOKIE}=${token}; Path=/api; HttpOnly; SameSite=Strict; Max-Age=${OWNER_MAX_MS / 1000}${secure ? '; Secure' : ''}`;
}
export const clearOwnerCookieHeader = (secure: boolean) => `${OWNER_COOKIE}=; Path=/api; HttpOnly; SameSite=Strict; Max-Age=0${secure ? '; Secure' : ''}`;

export type OwnerState = 'not-set-up' | 'locked' | 'unlocked' | 'changed';
export type OkkinCaller =
  | { kind: 'owner'; fresh: boolean }
  | { kind: 'bridge-token' | 'bearer' | 'pool-caller' | 'not-set-up' | 'owner-file-changed' | 'not-owner' | 'owner-expired' };

/** A bot credential on the request, whatever else it carries. */
export function botCredential(req: http.IncomingMessage): 'bridge-token' | 'bearer' | 'pool-caller' | null {
  const hdr = req.headers['x-bridge-token'];
  if (typeof hdr === 'string' && hdr.trim()) return 'bridge-token';
  const pool = req.headers['x-pool-caller'];
  if (typeof pool === 'string' && pool.trim()) return 'pool-caller';
  const auth = req.headers.authorization;
  if (typeof auth === 'string' && auth.trim()) return 'bearer';
  return null;
}

/** Who is asking, for Okkin's controls. Touches (extends) a live owner session. */
export function okkinCaller(req: http.IncomingMessage, opts: { file?: string; now?: number; touch?: boolean } = {}): OkkinCaller {
  const bot = botCredential(req);
  if (bot) return { kind: bot };
  if (!checkOwnerIntegrity()) return { kind: 'owner-file-changed' };
  if (!ownerSetUp(opts.file ?? ownerFile())) return { kind: 'not-set-up' };
  const token = cookieOf(req);
  if (!token) return { kind: 'not-owner' };
  const now = opts.now ?? Date.now();
  const s = sessions.get(key(token));
  if (!s) return { kind: 'not-owner' };
  if (now - s.seen > OWNER_IDLE_MS || now - s.created > OWNER_MAX_MS) {
    sessions.delete(key(token));
    return { kind: 'owner-expired' };
  }
  // Only a real use extends the session: the panel's status polling (touch: false) never does.
  if (opts.touch !== false) s.seen = now;
  return { kind: 'owner', fresh: now - s.unlocked <= OWNER_FRESH_MS };
}

export function ownerState(req: http.IncomingMessage, file = ownerFile()): OwnerState {
  if (!checkOwnerIntegrity()) return 'changed';
  if (!ownerSetUp(file)) return 'not-set-up';
  return okkinCaller(req, { file, touch: false }).kind === 'owner' ? 'unlocked' : 'locked';
}

/** At this size the log rotates to .1 (replacing the old .1): two files at most, under 512 KB together. */
export const REFUSALS_LOG_MAX = 256 * 1024;

export function logOkkinRefusal(dataDir: string, line: { route: string; caller: string }, now = Date.now()) {
  const file = path.join(dataDir, OKKIN_REFUSALS_LOG);
  try {
    if (existsSync(file) && statSync(file).size >= REFUSALS_LOG_MAX) renameSync(file, `${file}.1`);
    appendFileSync(file, `${JSON.stringify({ at: new Date(now).toISOString(), route: line.route, caller: line.caller })}\n`, { mode: 0o600 });
    chmodSync(file, 0o600);
  } catch {
    // Logging must never turn a refusal into a crash.
  }
}
