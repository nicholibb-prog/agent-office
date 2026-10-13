// Near-live desk frames from the Drive Bridge (Dan option c): each bot's sender overwrites one file,
// Bridge/live/<seat>.jpg, and Drive for desktop syncs it to this machine. The office reads that
// local copy only. No Drive token here, no network. The folder is AO_BRIDGE_LOCAL_DIR.
import { closeSync, fstatSync, lstatSync, openSync, readSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { LIVE_MAX_BYTES } from './live-frames.js';

export const DRIVE_STALE_MS = 60_000;
const SEAT = /^[a-z0-9][a-z0-9._-]{0,63}$/;

export type DriveFrame = { mime: 'image/jpeg'; bytes: Buffer; at: number };

/** The frame file for a seat, or undefined: no folder set, bad seat, symlink, outside, too big, not JPEG, or stale. */
export function readDriveFrame(
  seat: string,
  env: NodeJS.ProcessEnv = process.env,
  now = Date.now(),
  opts = { maxBytes: LIVE_MAX_BYTES, staleMs: DRIVE_STALE_MS },
): DriveFrame | undefined {
  const base = env.AO_BRIDGE_LOCAL_DIR;
  if (!base || !SEAT.test(seat)) return undefined;
  try {
    const root = realpathSync(path.join(realpathSync(base), 'live'));
    const file = path.join(root, seat + '.jpg');
    const ls = lstatSync(file);
    if (ls.isSymbolicLink() || !ls.isFile()) return undefined;
    const real = realpathSync(file);
    if (path.dirname(real) !== root) return undefined;
    if (ls.size === 0 || ls.size > opts.maxBytes) return undefined;
    if (now - ls.mtimeMs > opts.staleMs) return undefined;
    const fd = openSync(real, 'r');
    try {
      const st = fstatSync(fd);
      if (!st.isFile() || st.size > opts.maxBytes) return undefined;
      const bytes = Buffer.alloc(st.size);
      readSync(fd, bytes, 0, st.size, 0);
      if (!(bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)) return undefined;
      return { mime: 'image/jpeg', bytes, at: Math.round(st.mtimeMs) };
    } finally {
      closeSync(fd);
    }
  } catch {
    return undefined;
  }
}
