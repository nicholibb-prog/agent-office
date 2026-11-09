/**
 * Reads local timestamped records already on main and builds a since-close glance.
 * Self-contained: does not depend on unmerged hq-brief (#9). Binds later when #9 lands.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  buildGlance,
  emptyGlance,
  inferLastEventMs,
  linesFromBoardStatus,
  linesFromCrewStatus,
  linesFromMeetings,
  linesFromPool,
  linesFromQueue,
  linesFromWorkers,
  type GlanceLine,
  type SinceCloseGlance,
} from '../shared/since-close.js';
import type { Building } from './building.js';
import { fileMtimeMs, type OfficeState } from './office-state.js';

function readJson(file: string): unknown {
  try {
    if (!existsSync(file)) return null;
    return JSON.parse(readFileSync(file, 'utf8')) as unknown;
  } catch {
    return null;
  }
}

function floorDataDirs(building: Building | undefined, dataDir: string): string[] {
  const dirs = new Set<string>([dataDir]);
  if (building) {
    for (const def of building.list()) {
      dirs.add(path.join(def.dir, '.agent-office'));
    }
  }
  return [...dirs];
}

/** Last real event across known local files — for unclean-stop labelling. */
export function lastLocalEventMs(dataDir: string, building?: Building): number | undefined {
  const stamps: Array<number | undefined> = [];
  for (const dir of floorDataDirs(building, dataDir)) {
    for (const name of ['crew-status.json', 'queue.json', 'meetings.json', 'workers.json', 'pool.json', 'board-status.json', 'office-state.json']) {
      stamps.push(fileMtimeMs(path.join(dir, name)));
    }
    const crew = readJson(path.join(dir, 'crew-status.json')) as { updatedAt?: string } | null;
    if (crew?.updatedAt) {
      const t = Date.parse(crew.updatedAt);
      if (Number.isFinite(t)) stamps.push(t);
    }
    const meetings = readJson(path.join(dir, 'meetings.json')) as { past?: { finishedAt?: number }[] } | null;
    for (const p of meetings?.past ?? []) if (typeof p.finishedAt === 'number') stamps.push(p.finishedAt);
    const queue = readJson(path.join(dir, 'queue.json')) as { tasks?: { finishedAt?: number; addedAt?: number; startedAt?: number }[] } | null;
    for (const t of queue?.tasks ?? []) {
      stamps.push(t.finishedAt, t.startedAt, t.addedAt);
    }
  }
  return inferLastEventMs(stamps);
}

export function collectSinceCloseLines(dataDir: string, since: number | null, openedAtMs: number | undefined, building?: Building): GlanceLine[] {
  const lines: GlanceLine[] = [];
  for (const dir of floorDataDirs(building, dataDir)) {
    const crew = readJson(path.join(dir, 'crew-status.json'));
    lines.push(...linesFromCrewStatus(crew, since, openedAtMs));

    const queue = readJson(path.join(dir, 'queue.json')) as { tasks?: unknown } | null;
    lines.push(...linesFromQueue(queue?.tasks, since, openedAtMs));

    const meetings = readJson(path.join(dir, 'meetings.json')) as { past?: unknown } | null;
    lines.push(...linesFromMeetings(meetings?.past, since, openedAtMs));

    const workers = readJson(path.join(dir, 'workers.json'));
    lines.push(...linesFromWorkers(workers, since, openedAtMs));

    // Pool / board-status: optional; skip gracefully when absent.
    lines.push(...linesFromPool(readJson(path.join(dir, 'pool.json')), since, openedAtMs));
    lines.push(...linesFromBoardStatus(readJson(path.join(dir, 'board-status.json')), since, openedAtMs));
  }
  return lines;
}

export function readSinceClose(office: OfficeState, dataDir: string, building?: Building): SinceCloseGlance {
  const st = office.state();
  const sinceCloseAt = st.sinceCloseAt ?? (st.office === 'closed' ? st.closedAt : undefined);
  const since = sinceCloseAt ? Date.parse(sinceCloseAt) : null;
  const sinceMs = since !== null && Number.isFinite(since) ? since : null;
  const openedAtMs = st.openedAt ? Date.parse(st.openedAt) : undefined;
  const openedOk = openedAtMs !== undefined && Number.isFinite(openedAtMs) ? openedAtMs : undefined;

  if (sinceMs === null) {
    return emptyGlance({
      since: null,
      openedAt: st.openedAt,
      closedAt: st.closedAt,
      closeReason: st.sinceCloseReason ?? st.closeReason,
      dismissed: office.glanceDismissed(),
    });
  }

  const lines = collectSinceCloseLines(dataDir, sinceMs, openedOk, building);
  return buildGlance(lines, {
    since: sinceMs,
    openedAt: st.openedAt,
    closedAt: sinceCloseAt,
    closeReason: st.sinceCloseReason ?? st.closeReason,
    dismissed: office.glanceDismissed(),
  });
}
