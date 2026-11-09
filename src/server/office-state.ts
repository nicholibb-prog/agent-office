/**
 * Office-level open/closed state, apart from seats.
 * Persisted in gitignored `.agent-office/office-state.json` (0600, temp+rename).
 * Closed ≠ Offline and ≠ alarm. Closes only on owner close (or unclean stop labelled unexpected).
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { OfficeStateFile } from '../shared/since-close.js';

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

function parseIso(s: string | undefined): number | undefined {
  if (!s) return undefined;
  const n = Date.parse(s);
  return Number.isFinite(n) ? n : undefined;
}

export class OfficeState {
  private file: string;
  private data: OfficeStateFile;
  private unreadable = false;

  constructor(dataDir: string) {
    mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    this.file = path.join(dataDir, 'office-state.json');
    this.data = { office: 'closed' };
    this.restore();
  }

  state(): OfficeStateFile {
    return { ...this.data };
  }

  /** Whether the since-close panel was dismissed for the current openedAt. */
  glanceDismissed(): boolean {
    return !!this.data.openedAt && this.data.glanceDismissedFor === this.data.openedAt;
  }

  dismissGlance(): boolean {
    if (this.data.office !== 'open' || !this.data.openedAt) return false;
    this.data.glanceDismissedFor = this.data.openedAt;
    this.persist();
    return true;
  }

  /**
   * Clean owner close: office=closed, closedAt=now, reason=owner.
   * Idempotent while already closed with owner reason.
   */
  close(reason: 'owner' | 'unexpected' = 'owner', now = Date.now()): OfficeStateFile {
    if (this.data.office === 'closed' && this.data.closedAt && this.data.closeReason === 'owner' && reason === 'owner') {
      return this.state();
    }
    this.data = {
      office: 'closed',
      closedAt: iso(now),
      closeReason: reason,
      openedAt: this.data.openedAt,
      glanceDismissedFor: this.data.glanceDismissedFor,
    };
    this.persist();
    return this.state();
  }

  /**
   * On clean server start / open.
   * If previous was closed (or unclean while open), compute since-close from closedAt
   * (or last real event → unexpected). Then set office=open, openedAt=now.
   */
  openOnBoot(now = Date.now(), lastEventMs?: number): OfficeStateFile {
    const prev = this.data;
    let sinceCloseAt: string | undefined;
    let sinceCloseReason: 'owner' | 'unexpected' | undefined;

    if (prev.office === 'closed' && prev.closedAt) {
      sinceCloseAt = prev.closedAt;
      sinceCloseReason = prev.closeReason === 'unexpected' ? 'unexpected' : 'owner';
    } else if (prev.office === 'open') {
      // Unclean stop: process died without close().
      const inferred = lastEventMs && lastEventMs > 0 ? lastEventMs : parseIso(prev.openedAt);
      sinceCloseAt = iso(inferred ?? now);
      sinceCloseReason = 'unexpected';
    } else if (prev.closedAt) {
      sinceCloseAt = prev.closedAt;
      sinceCloseReason = prev.closeReason === 'unexpected' ? 'unexpected' : 'owner';
    }
    // First boot ever: no since window.

    this.data = {
      office: 'open',
      openedAt: iso(now),
      sinceCloseAt,
      sinceCloseReason,
      closedAt: sinceCloseAt,
      closeReason: sinceCloseReason,
      glanceDismissedFor: undefined,
    };
    this.persist();
    return this.state();
  }

  private restore() {
    if (!existsSync(this.file)) return;
    try {
      const raw = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<OfficeStateFile>;
      const office = raw.office === 'open' || raw.office === 'closed' ? raw.office : 'closed';
      this.data = {
        office,
        openedAt: typeof raw.openedAt === 'string' ? raw.openedAt : undefined,
        closedAt: typeof raw.closedAt === 'string' ? raw.closedAt : undefined,
        closeReason: raw.closeReason === 'owner' || raw.closeReason === 'unexpected' ? raw.closeReason : undefined,
        glanceDismissedFor: typeof raw.glanceDismissedFor === 'string' ? raw.glanceDismissedFor : undefined,
        sinceCloseAt: typeof raw.sinceCloseAt === 'string' ? raw.sinceCloseAt : undefined,
        sinceCloseReason: raw.sinceCloseReason === 'owner' || raw.sinceCloseReason === 'unexpected' ? raw.sinceCloseReason : undefined,
      };
      this.unreadable = false;
    } catch (err) {
      this.unreadable = true;
      console.error(`agent-office: couldn't read ${this.file}: ${(err as Error).message}`);
    }
  }

  private persist() {
    if (this.unreadable) {
      console.error(`agent-office: not saving office state over ${this.file}, which couldn't be read — fix or move it`);
      return;
    }
    const tmp = `${this.file}.${process.pid}.tmp`;
    try {
      writeFileSync(tmp, JSON.stringify(this.data, null, 2) + '\n', { mode: 0o600 });
      renameSync(tmp, this.file);
      try {
        chmodSync(this.file, 0o600);
      } catch {
        /* best effort */
      }
    } catch (err) {
      console.error(`agent-office: couldn't save ${this.file}: ${(err as Error).message}`);
    }
  }
}

/** mtime ms of a file, when present. */
export function fileMtimeMs(file: string): number | undefined {
  try {
    if (!existsSync(file)) return undefined;
    return statSync(file).mtimeMs;
  } catch {
    return undefined;
  }
}
