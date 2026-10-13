// Near-live desk frames from the Drive Bridge (Dan option c): each bot's sender overwrites one file,
// Bridge/live/<seat>.jpg, and Drive for desktop syncs it to this machine. The office reads that
// local copy only. No Drive token here, no network. The folder is AO_BRIDGE_LOCAL_DIR.
import { closeSync, fstatSync, lstatSync, openSync, readSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { LIVE_MAX_BYTES } from './live-frames.js';
import { isSeatId } from '../shared/hq.js';
import { isMajorFiles, underMajorFiles } from './major-files.js';

export const DRIVE_STALE_MS = 60_000;

/** The filesystem calls that resolve paths, kept on one object so a test can watch them. */
export const driveFs = { realpathSync: (p: string) => realpathSync(p) };

export type DriveFrame = { mime: 'image/jpeg'; bytes: Buffer; at: number };

/** The frame file for a seat, or undefined: no folder set, bad seat, symlink, outside, too big, not JPEG, or stale. */
export function readDriveFrame(
  seat: string,
  env: NodeJS.ProcessEnv = process.env,
  now = Date.now(),
  opts = { maxBytes: LIVE_MAX_BYTES, staleMs: DRIVE_STALE_MS },
): DriveFrame | undefined {
  const base = env.AO_BRIDGE_LOCAL_DIR;
  if (!base || !isSeatId(seat)) return undefined;
  // Before any filesystem call: a Major Files path is never touched, not even resolved.
  if (isMajorFiles(base)) return undefined;
  try {
    const realBase = driveFs.realpathSync(base);
    if (underMajorFiles(base, realBase)) return undefined; // a symlink that leads into Major Files
    const root = driveFs.realpathSync(path.join(realBase, 'live'));
    if (underMajorFiles(root, root)) return undefined;
    const file = path.join(root, seat + '.jpg');
    const ls = lstatSync(file);
    if (ls.isSymbolicLink() || !ls.isFile()) return undefined;
    const real = driveFs.realpathSync(file);
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
