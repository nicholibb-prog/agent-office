// The Kavi desk-PC thread: the owner's notes (to-kavi/owner-to-kavi-*.md) and Kavi's replies
// (to-george/*.md|*.txt), read locally from the synced Bridge folder and merged by time.
// Read only. Major Files is refused before any fs call. There is no typing state: replies are
// files that already exist, so the thread can only show what has arrived.
import { lstatSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { isMajorFiles } from './major-files.js';
import { KAVI_BRIDGE_FOLDER_ID, TO_KAVI } from './kavi-send.js';

export const TO_GEORGE = 'to-george';
export const MAX_THREAD = 60;
export const MAX_TEXT = 4000;
export const DRIVE_LINK = `https://drive.google.com/drive/folders/${KAVI_BRIDGE_FOLDER_ID}`;
const OWNER_NOTE = /^owner-to-kavi-.+\.md$/;
const REPLY = /\.(md|txt)$/i;

/** fs calls the thread makes; tests spy on them. */
export const threadFs = {
  realpathSync: (p: string) => realpathSync(p),
  readdirSync: (p: string) => readdirSync(p),
};

export interface ThreadItem {
  from: 'owner' | 'kavi';
  text: string;
  /** ISO time the packet was written (file mtime). */
  at: string;
}

export interface KaviThread {
  state: 'unconfigured' | 'unreachable' | 'ok';
  items: ThreadItem[];
  live: false;
  driveLink: string;
}

/** Strips the header and footer this office writes around an owner note. */
export function noteBody(doc: string): string {
  return doc
    .replace(/^# From the owner[^\n]*\n+/, '')
    .replace(/\n+_Sent [^\n]*_\s*$/, '')
    .trim();
}

/** Merges both sides oldest-first (ties keep owner before kavi), newest MAX_THREAD kept. */
export function mergeThread(owner: ThreadItem[], kavi: ThreadItem[], max = MAX_THREAD): ThreadItem[] {
  const all = [...owner.map((x) => ({ x, o: 0 })), ...kavi.map((x) => ({ x, o: 1 }))];
  all.sort((a, b) => Date.parse(a.x.at) - Date.parse(b.x.at) || a.o - b.o);
  return all.slice(-max).map((a) => a.x);
}

export const MAX_SCAN = 200;
export const MAX_BYTES = 2 * 1024 * 1024;

/** One side's folder, only if it is a real directory directly inside the bridge root and not Major Files. */
function sideDir(root: string, name: string): string | null {
  const want = path.join(root, name);
  try {
    const st = lstatSync(want);
    if (st.isSymbolicLink() || !st.isDirectory()) return null;
    const real = threadFs.realpathSync(want);
    if (path.dirname(real) !== root || isMajorFiles(real)) return null;
    return real;
  } catch {
    return null;
  }
}

function readSide(root: string, name: string, match: RegExp, from: ThreadItem['from'], strip: boolean, budget: { bytes: number }): ThreadItem[] {
  const dir = sideDir(root, name);
  if (!dir) return [];
  let names: string[];
  try {
    names = threadFs.readdirSync(dir);
  } catch {
    return [];
  }
  const found: { file: string; mtimeMs: number; size: number }[] = [];
  let scanned = 0;
  for (const n of names) {
    if (scanned >= MAX_SCAN) break;
    if (n.startsWith('.') || !match.test(n)) continue;
    scanned++;
    const file = path.join(dir, n);
    try {
      const st = lstatSync(file);
      if (st.isSymbolicLink() || !st.isFile() || st.size > 256 * 1024) continue;
      found.push({ file, mtimeMs: st.mtimeMs, size: st.size });
    } catch {
      /* vanished */
    }
  }
  found.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const out: ThreadItem[] = [];
  for (const f of found.slice(0, MAX_THREAD)) {
    if (budget.bytes + f.size > MAX_BYTES) break;
    try {
      const raw = readFileSync(f.file, 'utf8');
      budget.bytes += Buffer.byteLength(raw);
      const text = (strip ? noteBody(raw) : raw.trim()).slice(0, MAX_TEXT);
      if (text) out.push({ from, text, at: new Date(f.mtimeMs).toISOString() });
    } catch {
      /* vanished or unreadable */
    }
  }
  return out;
}

export function readThread(dir: string | undefined): KaviThread {
  const base = { items: [] as ThreadItem[], live: false as const, driveLink: DRIVE_LINK };
  if (!dir) return { ...base, state: 'unconfigured' };
  if (isMajorFiles(dir)) return { ...base, state: 'unreachable' };
  let root: string;
  try {
    root = threadFs.realpathSync(dir);
  } catch {
    return { ...base, state: 'unreachable' };
  }
  if (isMajorFiles(root)) return { ...base, state: 'unreachable' };
  const budget = { bytes: 0 };
  const kavi = readSide(root, TO_GEORGE, REPLY, 'kavi', false, budget);
  const owner = readSide(root, TO_KAVI, OWNER_NOTE, 'owner', true, budget);
  return { ...base, state: 'ok', items: mergeThread(owner, kavi) };
}
