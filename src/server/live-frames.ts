// Live desk-screen frames: a bot pushes pictures of its OWN VM desktop with its seat token, and the
// desk screen of that seat shows them while it is WORKING. Security rules (Dan):
// - no new listener: served by the existing 127.0.0.1 office server (routes in http/routes/live.ts)
// - the seat comes from the token, never from the body; no VNC/RDP, nothing fetched from a URL
// - off by default per seat; frames live in memory only (never disk, never logged)
// - size and rate capped; only signed-in office sessions can view
// - the server cannot see inside a picture, so it cannot mask fields: the SOURCE bot must not send
//   frames showing passwords, tokens or secrets, the ProArt's own screen, or anything from Major Files.

import { isSeatId } from '../shared/hq.js';

export const LIVE_MAX_BYTES = 400 * 1024; // one decoded frame
export const LIVE_MIN_INTERVAL_MS = 250; // at most 4 frames a second per seat
export const LIVE_STALE_MS = 10_000; // an older frame is "no live feed"
export const LIVE_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export type LiveFrame = { mime: string; bytes: Buffer; at: number };
export type PushResult = { ok: true } | { ok: false; status: number; error: string };


function sniff(b: Buffer): string | undefined {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (b.length > 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  return undefined;
}

export class LiveFrames {
  private on = new Set<string>();
  private frames = new Map<string, LiveFrame>();
  private lastPush = new Map<string, number>();

  constructor(private readonly opts = { maxBytes: LIVE_MAX_BYTES, minIntervalMs: LIVE_MIN_INTERVAL_MS, staleMs: LIVE_STALE_MS }) {}

  enabled(seat: string): boolean {
    return this.on.has(seat);
  }

  /** Turned on by a person in the office session. Off drops whatever frame was held. */
  setEnabled(seat: string, on: boolean): boolean {
    const s = seat.trim().toLowerCase();
    if (!isSeatId(s)) return false; // a real crew seat only
    if (on) this.on.add(s);
    else {
      this.on.delete(s);
      this.frames.delete(s);
      this.lastPush.delete(s);
    }
    return true;
  }

  /** `seat` must come from the caller's seat token. */
  push(seat: string, mime: string, bytes: Buffer, now = Date.now()): PushResult {
    if (!this.on.has(seat)) return { ok: false, status: 409, error: 'live feed is off for this seat' };
    if (!bytes.length) return { ok: false, status: 400, error: 'empty frame' };
    if (bytes.length > this.opts.maxBytes) return { ok: false, status: 413, error: 'frame too large' };
    if (!LIVE_MIMES.has(mime) || sniff(bytes) !== mime) return { ok: false, status: 415, error: 'jpeg, png or webp only' };
    const last = this.lastPush.get(seat);
    if (last !== undefined && now - last < this.opts.minIntervalMs) return { ok: false, status: 429, error: 'too many frames' };
    this.lastPush.set(seat, now);
    this.frames.set(seat, { mime, bytes, at: now });
    return { ok: true };
  }

  /** The current frame for a seat, or undefined (off, nothing yet, or stale) = "no live feed". */
  frame(seat: string, now = Date.now()): LiveFrame | undefined {
    if (!this.on.has(seat)) return undefined;
    const f = this.frames.get(seat);
    if (!f) return undefined;
    if (now - f.at > this.opts.staleMs) {
      this.frames.delete(seat); // a stale frame is dropped from memory, not kept around
      return undefined;
    }
    return f;
  }

  /** Has a frame in memory (stale or not). For tests: frame() and list() drop stale ones. */
  held(seat: string): boolean {
    return this.frames.has(seat);
  }

  list(now = Date.now()): { seat: string; live: boolean; at?: number }[] {
    // frame() drops each seat's stale frame as it goes.
    return [...this.on].sort().map((seat) => {
      const f = this.frame(seat, now);
      return { seat, live: !!f, ...(f ? { at: f.at } : {}) };
    });
  }
}

/** One store per office process; memory only. */
export const liveFrames = new LiveFrames();
