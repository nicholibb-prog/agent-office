// Read one file only after its real path is inside an allowed root.
import { closeSync, lstatSync, openSync, readFileSync, readSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';

export const MAX_BYTES = 2 * 1024 * 1024;
export const TAIL_BYTES = 512 * 1024;

export type SafeReason = 'missing' | 'path refused' | 'not a file' | 'unreadable' | 'too large';

export type SafeRead =
  | { ok: true; text: string; mtimeMs: number }
  | { ok: false; reason: SafeReason };

function badSegment(candidate: string): boolean {
  if (candidate === '') return true;
  if (candidate === '.') return false;
  const parts = candidate.split(/[\\/]/);
  const segs = parts[0] === '' ? parts.slice(1) : parts;
  if (!segs.length) return true;
  return segs.some((part) => part === '' || part === '.' || part === '..');
}

function inside(real: string, root: string): boolean {
  return real === root || real.startsWith(root + path.sep);
}

function tailText(file: string, size: number): string {
  const start = Math.max(0, size - TAIL_BYTES);
  const fd = openSync(file, 'r');
  try {
    const buf = Buffer.alloc(size - start);
    const n = readSync(fd, buf, 0, buf.length, start);
    let text = buf.subarray(0, n).toString('utf8');
    if (start > 0) {
      const nl = text.indexOf('\n');
      text = nl >= 0 ? text.slice(nl + 1) : '';
    }
    return text;
  } finally {
    closeSync(fd);
  }
}

function readOne(abs: string, roots: readonly string[], tail: boolean): SafeRead {
  let listed;
  try {
    listed = lstatSync(abs);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return { ok: false, reason: 'missing' };
    return { ok: false, reason: 'unreadable' };
  }
  if (listed.isDirectory()) return { ok: false, reason: 'not a file' };
  let real: string;
  try {
    real = realpathSync(abs);
  } catch {
    return { ok: false, reason: 'unreadable' };
  }
  if (!roots.some((root) => inside(real, root))) return { ok: false, reason: 'path refused' };
  let st;
  try {
    st = statSync(real);
  } catch {
    return { ok: false, reason: 'unreadable' };
  }
  if (!st.isFile()) return { ok: false, reason: 'not a file' };
  if (!tail && st.size > MAX_BYTES) return { ok: false, reason: 'too large' };
  try {
    const text = tail ? tailText(real, st.size) : readFileSync(real, 'utf8');
    return { ok: true, text, mtimeMs: st.mtimeMs };
  } catch {
    return { ok: false, reason: 'unreadable' };
  }
}

/**
 * Open `candidate` only when its real path stays inside one of `roots`.
 * Refuses `..`, `.` segments, empty names, and symlinks that leave the root.
 * A directory (including `.`) is `not a file`. JSONL callers pass `{ tail: true }` (last 512 KB).
 */
export function safeRead(candidate: string, roots: readonly string[], opts?: { tail?: boolean }): SafeRead {
  if (candidate === '' || badSegment(candidate)) return { ok: false, reason: 'path refused' };
  const rootReals: string[] = [];
  for (const root of roots) {
    try {
      rootReals.push(realpathSync(root));
    } catch {
      /* a missing root cannot authorize a read */
    }
  }
  if (!rootReals.length) return { ok: false, reason: 'path refused' };
  const absCandidates = path.isAbsolute(candidate)
    ? [candidate]
    : candidate === '.'
      ? [...roots]
      : roots.map((root) => path.join(root, candidate));
  let sawMissing = false;
  for (const abs of absCandidates) {
    const got = readOne(abs, rootReals, opts?.tail === true);
    if (got.ok) return got;
    if (got.reason === 'path refused') return got;
    if (got.reason === 'missing') {
      sawMissing = true;
      continue;
    }
    return got;
  }
  return { ok: false, reason: sawMissing ? 'missing' : 'path refused' };
}
