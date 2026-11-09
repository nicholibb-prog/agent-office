/**
 * Since-close morning glance: pure digest of local timestamped records.
 * Titles and generic seat labels only — no personal names, emails, paths, or credentials.
 */

export const LINE_CAP = 6;
export const TITLE_MAX = 80;

export type GlanceKind = 'finished' | 'blocked' | 'needsOwner' | 'inProgress' | 'offline';

export type GlanceLine = {
  source: string;
  title: string;
  /** Epoch ms when known; omit rather than inventing open-time. */
  at?: number;
  kind: GlanceKind;
  /** Generic seat token only (seat-N / desk-N / queue / bot-a). */
  seat?: string;
};

export type GlanceBucket = { lines: GlanceLine[]; capped: boolean };

export type SinceCloseGlance = {
  since: number | null;
  closeReason?: 'owner' | 'unexpected';
  openedAt?: string;
  closedAt?: string;
  dismissed: boolean;
  finished: GlanceBucket;
  blocked: GlanceBucket;
  needsOwner: GlanceBucket;
  inProgress: GlanceBucket;
  /** Neutral offline notes — never needs-owner, never red. */
  offline: GlanceBucket;
};

export type OfficePhase = 'open' | 'closed';

export type OfficeStateFile = {
  office: OfficePhase;
  openedAt?: string;
  closedAt?: string;
  closeReason?: 'owner' | 'unexpected';
  /** openedAt this glance was dismissed for; panel stays down until the next real open. */
  glanceDismissedFor?: string;
  /** Window start for the current open session (ISO). */
  sinceCloseAt?: string;
  sinceCloseReason?: 'owner' | 'unexpected';
};

const SEAT_OK = /^(seat|desk|bot)-[a-z0-9-]+$|^queue$/;

/** Generic seat only; personal names become seat / desk-N. */
export function genericSeat(raw: string | undefined, deskId?: string): string | undefined {
  const desk = (deskId || '').trim().toLowerCase();
  if (desk && SEAT_OK.test(desk)) return desk;
  const s = (raw || '').trim().toLowerCase();
  if (s && SEAT_OK.test(s)) return s;
  if (desk) return desk.replace(/[^a-z0-9-]/g, '').slice(0, 32) || undefined;
  return undefined;
}

/** Short title: strip emails/paths/secrets; never invent content. */
export function safeTitle(raw: string | undefined): string | null {
  if (!raw) return null;
  let t = raw.replace(/\s+/g, ' ').trim();
  if (!t) return null;
  t = t.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, 'redacted');
  t = t.replace(/(?:\/(?:home|Users|tmp|var|private)\/|\\\\)[^\s"']+/g, '…');
  t = t.replace(/\b(?:ghp_|gho_|github_pat_|sk-|xox[baprs]-)[A-Za-z0-9_-]{8,}\b/g, 'redacted');
  if (t.length > TITLE_MAX) t = t.slice(0, TITLE_MAX - 1) + '…';
  return t || null;
}

export function timeLabel(at: number | undefined): string {
  if (at === undefined || !Number.isFinite(at) || at <= 0) return 'time unknown';
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return 'time unknown';
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

/** Calm chip while the office is closed — local HH:MM from real closedAt. */
export function closedSinceLabel(closedAtIso: string | undefined): string | null {
  if (!closedAtIso) return null;
  const d = new Date(closedAtIso);
  if (Number.isNaN(d.getTime())) return null;
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `Closed since ${hh}:${mm}`;
}

function bucketOf(lines: GlanceLine[]): GlanceBucket {
  const sorted = [...lines].sort((a, b) => (b.at ?? 0) - (a.at ?? 0));
  const capped = sorted.length > LINE_CAP;
  return { lines: sorted.slice(0, LINE_CAP), capped };
}

export function emptyGlance(partial: Partial<SinceCloseGlance> = {}): SinceCloseGlance {
  const empty: GlanceBucket = { lines: [], capped: false };
  return {
    since: null,
    dismissed: false,
    finished: empty,
    blocked: empty,
    needsOwner: empty,
    inProgress: empty,
    offline: empty,
    ...partial,
  };
}

/** Build capped buckets from collected lines. Offline never mixes into needsOwner. */
export function buildGlance(lines: GlanceLine[], meta: Omit<SinceCloseGlance, 'finished' | 'blocked' | 'needsOwner' | 'inProgress' | 'offline'>): SinceCloseGlance {
  const finished: GlanceLine[] = [];
  const blocked: GlanceLine[] = [];
  const needsOwner: GlanceLine[] = [];
  const inProgress: GlanceLine[] = [];
  const offline: GlanceLine[] = [];
  for (const line of lines) {
    if (line.kind === 'finished') finished.push(line);
    else if (line.kind === 'blocked') blocked.push(line);
    else if (line.kind === 'needsOwner') needsOwner.push(line);
    else if (line.kind === 'inProgress') inProgress.push(line);
    else offline.push(line);
  }
  return {
    ...meta,
    finished: bucketOf(finished),
    blocked: bucketOf(blocked),
    needsOwner: bucketOf(needsOwner),
    inProgress: bucketOf(inProgress),
    offline: bucketOf(offline),
  };
}

export function glanceHasLines(g: SinceCloseGlance): boolean {
  return g.finished.lines.length + g.blocked.lines.length + g.needsOwner.lines.length + g.inProgress.lines.length + g.offline.lines.length > 0;
}

/** True when `at` falls in the since-close window (exclusive of open instant when both known). */
export function inWindow(at: number | undefined, since: number | null, openedAtMs?: number): boolean {
  if (at === undefined || !Number.isFinite(at) || at <= 0) return false;
  if (since === null) return false;
  if (at < since) return false;
  if (openedAtMs !== undefined && at > openedAtMs) return false;
  return true;
}

/** Queue task → glance lines (titles only, generic seats). */
export function linesFromQueue(tasks: unknown, since: number | null, openedAtMs?: number): GlanceLine[] {
  if (!Array.isArray(tasks)) return [];
  const out: GlanceLine[] = [];
  for (const raw of tasks) {
    if (!raw || typeof raw !== 'object') continue;
    const t = raw as Record<string, unknown>;
    const title = safeTitle(typeof t.title === 'string' ? t.title : undefined);
    if (!title) continue;
    const status = t.status;
    const finishedAt = typeof t.finishedAt === 'number' ? t.finishedAt : undefined;
    const startedAt = typeof t.startedAt === 'number' ? t.startedAt : undefined;
    const addedAt = typeof t.addedAt === 'number' ? t.addedAt : undefined;
    const outcome = t.outcome;
    if (status === 'done') {
      const at = finishedAt ?? addedAt;
      if (!inWindow(at, since, openedAtMs)) continue;
      out.push({ source: 'queue', title, at, kind: outcome === 'failed' || outcome === 'killed' ? 'blocked' : 'finished', seat: 'queue' });
    } else if (status === 'running') {
      const at = startedAt ?? addedAt;
      if (!inWindow(at, since, openedAtMs)) continue;
      out.push({ source: 'queue', title, at, kind: 'inProgress', seat: 'queue' });
    } else if (status === 'queued') {
      const at = addedAt;
      if (!inWindow(at, since, openedAtMs)) continue;
      out.push({ source: 'queue', title, at, kind: 'inProgress', seat: 'queue' });
    }
  }
  return out;
}

/** Meeting past records → glance lines. */
export function linesFromMeetings(past: unknown, since: number | null, openedAtMs?: number): GlanceLine[] {
  if (!Array.isArray(past)) return [];
  const out: GlanceLine[] = [];
  for (const raw of past) {
    if (!raw || typeof raw !== 'object') continue;
    const m = raw as Record<string, unknown>;
    const title = safeTitle(typeof m.title === 'string' ? m.title : undefined);
    if (!title) continue;
    const at = typeof m.finishedAt === 'number' ? m.finishedAt : undefined;
    if (!inWindow(at, since, openedAtMs)) continue;
    const status = m.status;
    const kind: GlanceKind = status === 'stopped' ? 'blocked' : 'finished';
    out.push({ source: 'meeting', title, at, kind, seat: 'desk-meeting' });
  }
  return out;
}

/**
 * Crew-status file: only an updatedAt stamp in-window yields a calm presence note.
 * Never invents needs-owner from missing heartbeats / decay.
 */
export function linesFromCrewStatus(raw: unknown, since: number | null, openedAtMs?: number): GlanceLine[] {
  if (!raw || typeof raw !== 'object') return [];
  const file = raw as { updatedAt?: unknown; crew?: Record<string, string> };
  const updated = typeof file.updatedAt === 'string' ? Date.parse(file.updatedAt) : typeof file.updatedAt === 'number' ? file.updatedAt : NaN;
  if (!inWindow(updated, since, openedAtMs)) return [];
  const crew = file.crew && typeof file.crew === 'object' ? file.crew : {};
  const out: GlanceLine[] = [];
  let n = 0;
  for (const [key, st] of Object.entries(crew)) {
    if (n >= LINE_CAP) break;
    const seat = genericSeat(key) ?? `seat-${++n}`;
    const status = String(st).toLowerCase();
    if (status === 'working' || status === 'busy' || status === 'active') {
      out.push({ source: 'crew', title: 'Working', at: updated, kind: 'inProgress', seat });
    } else if (status === 'needs_input' || status === 'blocked') {
      out.push({ source: 'crew', title: 'Needs owner', at: updated, kind: 'needsOwner', seat });
    } else if (status === 'done') {
      out.push({ source: 'crew', title: 'Finished', at: updated, kind: 'finished', seat });
    }
    // idle/offline/asleep: omit — decay alone must not list needs-owner or go red
    n++;
  }
  return out;
}

/**
 * Saved workers: only desks with a real waitingSince / activity stamp in-window.
 * Offline desks with no event → optional neutral offline line, never needs-owner.
 */
export function linesFromWorkers(saved: unknown, since: number | null, openedAtMs?: number): GlanceLine[] {
  if (!Array.isArray(saved)) return [];
  const out: GlanceLine[] = [];
  for (const raw of saved) {
    if (!raw || typeof raw !== 'object') continue;
    const w = raw as Record<string, unknown>;
    const desk = typeof w.deskId === 'string' ? w.deskId : undefined;
    const seat = genericSeat(undefined, desk) ?? 'seat';
    const status = w.status;
    const waitingSince = typeof w.waitingSince === 'number' ? w.waitingSince : undefined;
    const title =
      safeTitle(typeof w.activity === 'string' ? w.activity : undefined) ||
      safeTitle(typeof (w.task as { name?: string } | undefined)?.name === 'string' ? (w.task as { name: string }).name : undefined) ||
      safeTitle(typeof w.title === 'string' ? w.title : undefined);

    if (status === 'needs_input' && inWindow(waitingSince, since, openedAtMs)) {
      out.push({ source: 'desk', title: title || 'Needs owner', at: waitingSince, kind: 'needsOwner', seat });
      continue;
    }
    if (status === 'done' && inWindow(waitingSince, since, openedAtMs)) {
      out.push({ source: 'desk', title: title || 'Finished', at: waitingSince, kind: 'finished', seat });
      continue;
    }
    if (status === 'working' || status === 'starting') {
      const at = typeof w.lastInput === 'object' && w.lastInput && typeof (w.lastInput as { at?: number }).at === 'number'
        ? (w.lastInput as { at: number }).at
        : typeof w.createdAt === 'number'
          ? w.createdAt
          : undefined;
      if (inWindow(at, since, openedAtMs)) {
        out.push({ source: 'desk', title: title || 'In progress', at, kind: 'inProgress', seat });
      }
      continue;
    }
    // offline / exited / idle with no in-window stamp: not needs-owner
  }
  return out;
}

/** Optional pool file — skip gracefully when absent or malformed. */
export function linesFromPool(raw: unknown, since: number | null, openedAtMs?: number): GlanceLine[] {
  if (!raw || typeof raw !== 'object') return [];
  const items = (raw as { items?: unknown; jobs?: unknown }).items ?? (raw as { jobs?: unknown }).jobs;
  if (!Array.isArray(items)) return [];
  const out: GlanceLine[] = [];
  for (const rawItem of items) {
    if (!rawItem || typeof rawItem !== 'object') continue;
    const it = rawItem as Record<string, unknown>;
    const title = safeTitle(typeof it.title === 'string' ? it.title : typeof it.name === 'string' ? it.name : undefined);
    if (!title) continue;
    const at =
      typeof it.at === 'number'
        ? it.at
        : typeof it.finishedAt === 'number'
          ? it.finishedAt
          : typeof it.updatedAt === 'number'
            ? it.updatedAt
            : typeof it.updatedAt === 'string'
              ? Date.parse(it.updatedAt)
              : undefined;
    if (!inWindow(at, since, openedAtMs)) continue;
    const state = String(it.state || it.status || '').toLowerCase();
    let kind: GlanceKind = 'inProgress';
    if (state === 'done' || state === 'finished' || state === 'complete') kind = 'finished';
    else if (state === 'blocked' || state === 'failed') kind = 'blocked';
    else if (state === 'needs' || state === 'needs_owner' || state === 'needs-owner') kind = 'needsOwner';
    out.push({ source: 'pool', title, at, kind, seat: genericSeat(typeof it.seat === 'string' ? it.seat : undefined) });
  }
  return out;
}

/** Optional board-status.json (#9 shape) — skip when absent. */
export function linesFromBoardStatus(raw: unknown, since: number | null, openedAtMs?: number): GlanceLine[] {
  if (!raw || typeof raw !== 'object') return [];
  const items = (raw as { items?: unknown }).items;
  if (!Array.isArray(items)) return [];
  const out: GlanceLine[] = [];
  for (const rawItem of items) {
    if (!rawItem || typeof rawItem !== 'object') continue;
    const it = rawItem as Record<string, unknown>;
    const title = safeTitle(typeof it.title === 'string' ? it.title : undefined);
    if (!title) continue;
    const at = typeof it.at === 'number' ? it.at : undefined;
    if (!inWindow(at, since, openedAtMs)) continue;
    const state = String(it.state || '').toLowerCase();
    let kind: GlanceKind = 'inProgress';
    if (state === 'done') kind = 'finished';
    else if (state === 'blocked') kind = 'blocked';
    else if (state === 'progress') kind = 'inProgress';
    else continue;
    out.push({
      source: 'board',
      title,
      at,
      kind,
      seat: genericSeat(typeof it.seat === 'string' ? it.seat : undefined),
    });
  }
  return out;
}

/** Infer last real event ms from known local files (for unclean stop labelling). */
export function inferLastEventMs(stamps: Array<number | undefined>): number | undefined {
  let best = 0;
  for (const s of stamps) {
    if (typeof s === 'number' && Number.isFinite(s) && s > best) best = s;
  }
  return best > 0 ? best : undefined;
}
