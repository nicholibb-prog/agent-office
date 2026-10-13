// Nick -> Kavi through the Kavi-George Bridge folder that Google Drive for desktop syncs on this
// machine. The office holds no Google credential: it only creates files in <bridge>/to-kavi and
// Drive sync uploads them. Create only: no overwrite, no delete, no listing. Kavi answers async.
import { closeSync, lstatSync, openSync, readFileSync, realpathSync, writeSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';

/** The Kavi-George Bridge folder in Drive. The local marker must read back exactly this. */
export const KAVI_BRIDGE_FOLDER_ID = '1PX8OuEqf8rYYUro7dR3aq0NN8RGg7I1Q';
/** One-line file in the bridge root holding the Drive folder id, placed once by the owner. */
export const BRIDGE_ID_MARKER = '.bridge-folder-id';
export const TO_KAVI = 'to-kavi';
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_MESSAGE_CHARS = 4000;
export const ALLOWED_EXT = new Set(['.pdf', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.txt', '.md', '.csv', '.json', '.docx', '.xlsx', '.pptx']);

export class KaviSendError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

/** True for anything under Documents\Major Files (either slash, any case). Checked on the string only. */
export function isMajorFiles(p: string): boolean {
  return /(^|[\\/])documents[\\/]+major files([\\/]|$)/i.test(String(p));
}

export interface BridgeReadBack {
  configured: boolean;
  /** Only the parent folder id, and only when it matches the pinned Bridge id. Nothing is listed. */
  folderId: string | null;
  verified: boolean;
  live: false;
}

function resolveBridge(dir: string | undefined): { root: string; toKavi: string } {
  if (!dir) throw new KaviSendError(503, 'Kavi bridge folder is not configured');
  if (!path.isAbsolute(dir)) throw new KaviSendError(503, 'Kavi bridge folder must be an absolute path');
  if (isMajorFiles(dir)) throw new KaviSendError(403, 'refused: Major Files is off limits');
  let root: string;
  try {
    root = realpathSync(dir);
  } catch {
    throw new KaviSendError(503, 'Kavi bridge folder is unreachable');
  }
  if (isMajorFiles(root)) throw new KaviSendError(403, 'refused: Major Files is off limits');
  const want = path.join(root, TO_KAVI);
  let st;
  try {
    st = lstatSync(want);
  } catch {
    throw new KaviSendError(503, 'to-kavi folder is missing');
  }
  if (st.isSymbolicLink() || !st.isDirectory()) throw new KaviSendError(403, 'to-kavi must be a real folder');
  const toKavi = realpathSync(want);
  if (path.dirname(toKavi) !== root) throw new KaviSendError(403, 'to-kavi is outside the bridge folder');
  return { root, toKavi };
}

function readMarker(root: string): string | null {
  const f = path.join(root, BRIDGE_ID_MARKER);
  try {
    if (lstatSync(f).isSymbolicLink()) return null;
    return readFileSync(f, 'utf8').trim().slice(0, 128);
  } catch {
    return null;
  }
}

/** Reads back the Bridge folder id from the local marker. Lists nothing. */
export function readBack(dir: string | undefined): BridgeReadBack {
  if (!dir) return { configured: false, folderId: null, verified: false, live: false };
  try {
    const { root } = resolveBridge(dir);
    const id = readMarker(root);
    const verified = id === KAVI_BRIDGE_FOLDER_ID;
    return { configured: true, folderId: verified ? id : null, verified, live: false };
  } catch {
    return { configured: true, folderId: null, verified: false, live: false };
  }
}

/** A safe base name, or an error. No separators, no dots-only, no leading dot, no control chars. */
export function safeName(raw: string): string {
  const name = String(raw || '').normalize('NFC');
  if (!name || name.length > 120) throw new KaviSendError(400, 'bad file name');
  if (/[\\/:\x00-\x1f\x7f]/.test(name) || name.startsWith('.') || name === '..' || path.isAbsolute(name)) {
    throw new KaviSendError(400, 'bad file name');
  }
  if (isMajorFiles(name)) throw new KaviSendError(403, 'refused: Major Files is off limits');
  return name;
}

/** Create-only write inside to-kavi. Picks "name (2).ext" etc. when the name exists. */
function createUnique(toKavi: string, name: string, data: Buffer): string {
  const ext = path.extname(name);
  const stem = name.slice(0, name.length - ext.length);
  for (let i = 1; i <= 50; i++) {
    const candidate = i === 1 ? name : `${stem} (${i})${ext}`;
    const full = path.join(toKavi, candidate);
    if (path.dirname(path.resolve(full)) !== toKavi) throw new KaviSendError(400, 'bad file name');
    let fd: number;
    try {
      fd = openSync(full, 'wx', 0o644);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EEXIST') continue;
      throw new KaviSendError(500, 'could not write to the bridge folder');
    }
    try {
      writeSync(fd, data);
    } finally {
      closeSync(fd);
    }
    return candidate;
  }
  throw new KaviSendError(409, 'too many files with that name');
}

export interface SendResult {
  ok: true;
  name: string;
  folderId: string;
  live: false;
}

function verifiedBridge(dir: string | undefined) {
  const b = resolveBridge(dir);
  const id = readMarker(b.root);
  if (id !== KAVI_BRIDGE_FOLDER_ID) throw new KaviSendError(409, 'bridge folder id did not read back as the Kavi-George Bridge');
  return { ...b, folderId: id };
}

export function sendFile(dir: string | undefined, rawName: string, data: Buffer): SendResult {
  const name = safeName(rawName);
  if (!ALLOWED_EXT.has(path.extname(name).toLowerCase())) throw new KaviSendError(415, 'file type not allowed');
  if (data.length > MAX_FILE_BYTES) throw new KaviSendError(413, 'file too large');
  if (data.length === 0) throw new KaviSendError(400, 'empty file');
  const b = verifiedBridge(dir);
  return { ok: true, name: createUnique(b.toKavi, name, data), folderId: b.folderId, live: false };
}

export function sendMessage(dir: string | undefined, text: string, now = new Date()): SendResult {
  const body = String(text || '').trim();
  if (!body) throw new KaviSendError(400, 'empty message');
  if (body.length > MAX_MESSAGE_CHARS) throw new KaviSendError(413, 'message too long');
  const b = verifiedBridge(dir);
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  const name = `nick-to-kavi-${stamp}-${randomBytes(3).toString('hex')}.md`;
  const doc = `# From Nick (agent office)\n\n${body}\n\n_Sent ${now.toISOString()}. Not a live call: Kavi answers through the Bridge folder._\n`;
  return { ok: true, name: createUnique(b.toKavi, name, Buffer.from(doc, 'utf8')), folderId: b.folderId, live: false };
}
