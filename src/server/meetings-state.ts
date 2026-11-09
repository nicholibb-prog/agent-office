/** Local-only meetings.json: temp+rename, mode 0600, capped size. No network. */
import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import type { Meeting, MeetingRecord, MeetingState } from '../shared/protocol.js';
import { isMeetingPattern } from '../shared/meetings.js';

const PAST_MAX = 20;
/** Cap meetings.json so a huge preview can't blow the floor's state. */
export const MEETINGS_STATE_MAX_BYTES = 512 * 1024;

/** Writes current + past atomically (temp+rename, 0600). Returns the past list actually kept. */
export function writeMeetingsState(file: string, current: Meeting | null, past: MeetingRecord[]): MeetingRecord[] {
  let kept = past;
  let body = JSON.stringify({ current, past: kept }, null, 2);
  if (Buffer.byteLength(body, 'utf8') > MEETINGS_STATE_MAX_BYTES && kept.length) {
    kept = kept.map((r) => {
      const log = r.decisionLog;
      if (!log || log.decision.length <= 500) return r;
      return { ...r, decisionLog: { ...log, decision: `${log.decision.slice(0, 500)}…` } };
    });
    body = JSON.stringify({ current, past: kept }, null, 2);
  }
  while (Buffer.byteLength(body, 'utf8') > MEETINGS_STATE_MAX_BYTES && kept.length > 1) {
    kept = kept.slice(0, -1);
    body = JSON.stringify({ current, past: kept }, null, 2);
  }
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    writeFileSync(tmp, body, { mode: 0o600 });
    renameSync(tmp, file);
  } catch {
    try {
      unlinkSync(tmp);
    } catch {
      /* ignore */
    }
    throw new Error('meetings state write failed');
  }
  return kept;
}

/** Loads meetings.json; corrupt or missing → empty room. */
export function readMeetingsState(file: string): { current: Meeting | null; past: MeetingRecord[] } {
  if (!existsSync(file)) return { current: null, past: [] };
  try {
    const saved = JSON.parse(readFileSync(file, 'utf8')) as Partial<MeetingState>;
    const past = Array.isArray(saved.past)
      ? saved.past.filter((r) => r && typeof r.id === 'string' && typeof r.summary === 'string').slice(0, PAST_MAX)
      : [];
    const m = saved.current;
    const current =
      m && typeof m.id === 'string' && isMeetingPattern(m.pattern) && Array.isArray(m.seats) && Array.isArray(m.turns) ? m : null;
    return { current, past };
  } catch {
    return { current: null, past: [] };
  }
}
