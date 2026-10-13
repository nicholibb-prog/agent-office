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

function readSide(dir: string, match: RegExp, from: ThreadItem['from'], strip: boolean): ThreadItem[] {
  let names: string[];
  try {
    names = threadFs.readdirSync(dir);
  } catch {
    return [];
  }
  const out: ThreadItem[] = [];
  for (const n of names) {
    if (n.startsWith('.') || !match.test(n)) continue;
    const file = path.join(dir, n);
    try {
      const st = lstatSync(file);
      if (!st.isFile() || st.size > 256 * 1024) continue;
      const raw = readFileSync(file, 'utf8');
      const text = (strip ? noteBody(raw) : raw.trim()).slice(0, MAX_TEXT);
      if (text) out.push({ from, text, at: new Date(st.mtimeMs).toISOString() });
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
  const owner = readSide(path.join(root, TO_KAVI), OWNER_NOTE, 'owner', true);
  const kavi = readSide(path.join(root, TO_GEORGE), REPLY, 'kavi', false);
  return { ...base, state: 'ok', items: mergeThread(owner, kavi) };
}
