// One writer for kavi-outbox.json. The bridge route and the seat board both use this,
// so two updates cannot each read a stale copy and drop the other's item.
import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import type { OutboxItem } from '../shared/seat-provider.js';

export const OUTBOX_CAP = 200;
const MODE = 0o600;
const NOTE = 'crew picks up via local connector';

export function readOutboxFile(file: string): OutboxItem[] {
  try {
    if (!existsSync(file)) return [];
    const raw = JSON.parse(readFileSync(file, 'utf8')) as { items?: OutboxItem[] };
    return Array.isArray(raw.items) ? raw.items : [];
  } catch {
    return [];
  }
}

/** Temp file, then rename. Mode 0600 is set again after rename so a rewrite cannot leave a looser file. */
export function writeOutboxFile(file: string, items: OutboxItem[]): void {
  const body = JSON.stringify({ items: items.slice(-OUTBOX_CAP), note: NOTE }, null, 2) + '\n';
  const tmp = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  try {
    writeFileSync(tmp, body, { mode: MODE });
    renameSync(tmp, file);
    chmodSync(file, MODE);
  } catch (err) {
    try {
      unlinkSync(tmp);
    } catch {
      /* the temp file was already moved or never created */
    }
    throw err;
  }
}

/** Read, append, cap, and replace. Synchronous, so it does not interleave with itself. */
export function appendOutboxItem(file: string, item: OutboxItem): OutboxItem[] {
  const next = [...readOutboxFile(file), item].slice(-OUTBOX_CAP);
  writeOutboxFile(file, next);
  return next;
}
