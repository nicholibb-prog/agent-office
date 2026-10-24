// Kavi covers george's routing when george's usage is empty. Kavi never messages another lane.
// Cursor writes a digest into the bridge to-kavi folder. Kavi writes orders into to-george.
// Cursor applies the orders in Notion. This module only checks the text. It does not read files,
// does not call Notion, and does not hold a path or a secret.

export const COVER_LANES = ['Kavi', 'ForgeL', 'Dan', 'Jack', 'Cursor', 'george'] as const;
export const COVER_STATUSES = ['Inbox', 'Routed', 'In progress', 'Blocked', 'Done', 'Killed'] as const;
export type CoverLane = (typeof COVER_LANES)[number];
export type CoverStatus = (typeof COVER_STATUSES)[number];

export interface CoverRow {
  ref: string;
  status: CoverStatus;
  lane: CoverLane;
  /** ISO-8601 UTC, second precision, Z. */
  stuck: string;
  next: string;
}

export interface CoverOn {
  kind: 'on';
  at: string;
  reason: 'usage-empty';
  rows: CoverRow[];
}

export interface CoverOff {
  kind: 'off';
  at: string;
  reason: 'usage-back';
}

export interface CoverOrder {
  kind: 'order';
  at: string;
  actions: CoverRow[];
  quote: { item: string; text: string; at: string } | null;
}

export type CoverPacket = CoverOn | CoverOff | CoverOrder;
export type CoverParse = { ok: true; packet: CoverPacket } | { ok: false; error: string };

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const REF = /^WQ-\d{1,6}$/;
const LANES = new Set<string>(COVER_LANES);
const STATUSES = new Set<string>(COVER_STATUSES);

function dirty(text: string): string | null {
  if (/major files/i.test(text)) return 'major files';
  if (/\b(?:sk-|ghp_|xox[baprs]-)/.test(text)) return 'secret shape';
  if (/\b\d{13,19}\b/.test(text)) return 'long number';
  return null;
}

function row(line: string, label: string): CoverRow | string {
  const parts = line.split(' | ');
  if (parts.length !== 5) return `${label} needs 5 fields`;
  const [ref, status, lane, stuck, next] = parts as [string, string, string, string, string];
  if (!REF.test(ref)) return `${label} ref`;
  if (!STATUSES.has(status)) return `${label} status`;
  if (!LANES.has(lane)) return `${label} lane`;
  if (!ISO.test(stuck) || Number.isNaN(Date.parse(stuck))) return `${label} stuck`;
  if (!next.trim() || next.length > 160) return `${label} next`;
  const bad = dirty(next);
  if (bad) return bad;
  return { ref, status: status as CoverStatus, lane: lane as CoverLane, stuck, next: next.trim() };
}

/** Parse one bridge packet. The first line decides on, off, or order. */
export function parseCover(raw: string): CoverParse {
  const bad = dirty(raw);
  if (bad) return { ok: false, error: bad };
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const head = lines[0];
  if (head !== 'COVER GEORGE ON' && head !== 'COVER GEORGE OFF' && head !== 'COVER GEORGE') {
    return { ok: false, error: 'header' };
  }
  let at = '';
  let reason = '';
  const rows: CoverRow[] = [];
  let quote: CoverOrder['quote'] = null;
  for (const line of lines.slice(1)) {
    const cut = line.indexOf(': ');
    if (cut < 1) return { ok: false, error: 'field' };
    const key = line.slice(0, cut);
    const value = line.slice(cut + 2);
    if (key === 'at') {
      if (at || !ISO.test(value) || Number.isNaN(Date.parse(value))) return { ok: false, error: 'at' };
      at = value;
    } else if (key === 'reason') {
      if (reason) return { ok: false, error: 'reason' };
      reason = value;
    } else if (key === 'row' || key === 'set') {
      if (rows.length >= 20) return { ok: false, error: 'too many' };
      const parsed = row(value, key);
      if (typeof parsed === 'string') return { ok: false, error: parsed };
      rows.push(parsed);
    } else if (key === 'quote') {
      if (quote) return { ok: false, error: 'quote' };
      const parts = value.split(' | ');
      if (parts.length !== 3) return { ok: false, error: 'quote fields' };
      const [item, text, when] = parts as [string, string, string];
      if (!item.trim() || item.length > 80 || !text.trim() || text.length > 200) return { ok: false, error: 'quote text' };
      if (!ISO.test(when) || Number.isNaN(Date.parse(when))) return { ok: false, error: 'quote at' };
      quote = { item: item.trim(), text: text.trim(), at: when };
    } else {
      return { ok: false, error: 'field' };
    }
  }
  if (!at) return { ok: false, error: 'at' };
  if (head === 'COVER GEORGE ON') {
    if (reason !== 'usage-empty') return { ok: false, error: 'reason' };
    if (quote) return { ok: false, error: 'quote' };
    return { ok: true, packet: { kind: 'on', at, reason: 'usage-empty', rows } };
  }
  if (head === 'COVER GEORGE OFF') {
    if (reason !== 'usage-back') return { ok: false, error: 'reason' };
    if (rows.length || quote) return { ok: false, error: 'off has rows' };
    return { ok: true, packet: { kind: 'off', at, reason: 'usage-back' } };
  }
  if (reason || !rows.length) return { ok: false, error: 'order' };
  for (const line of lines.slice(1)) if (line.startsWith('row: ')) return { ok: false, error: 'order' };
  return { ok: true, packet: { kind: 'order', at, actions: rows, quote } };
}
