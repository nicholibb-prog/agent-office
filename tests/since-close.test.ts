import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { OfficeState } from '../src/server/office-state.js';
import { readSinceClose } from '../src/server/since-close.js';
import {
  buildGlance,
  emptyGlance,
  glanceHasLines,
  linesFromCrewStatus,
  linesFromMeetings,
  linesFromPool,
  linesFromQueue,
  linesFromWorkers,
  safeTitle,
  timeLabel,
} from '../src/shared/since-close.js';

function dir(t: test.TestContext): string {
  const d = mkdtempSync(path.join(tmpdir(), 'ao-since-close-'));
  t.after(() => rmSync(d, { recursive: true, force: true }));
  return d;
}

test('queued and finished lines keep their own stamps in since-close', () => {
  const since = 1_000;
  const lines = linesFromQueue(
    [
      { id: '1', title: 'Ship glance', status: 'done', addedAt: 500, finishedAt: 1_500 },
      { id: '2', title: 'Still cooking', status: 'running', addedAt: 1_200, startedAt: 1_300 },
      { id: '3', title: 'Too old', status: 'done', addedAt: 100, finishedAt: 200 },
    ],
    since,
    2_000,
  );
  assert.equal(lines.length, 2);
  assert.equal(lines[0].kind, 'finished');
  assert.equal(lines[0].at, 1_500);
  assert.equal(lines[1].kind, 'inProgress');
  assert.equal(lines[1].at, 1_300);
  assert.equal(timeLabel(1_500).includes(':'), true);
});

test('close → wait → open: decay alone puts nothing on needs-owner and no seat goes red', (t) => {
  const d = dir(t);
  const office = new OfficeState(d);
  office.openOnBoot(1_000);
  // Idle/offline crew only — no needs_input stamps.
  writeFileSync(
    path.join(d, 'crew-status.json'),
    JSON.stringify({ updatedAt: new Date(1_500).toISOString(), crew: { 'seat-a': 'idle', 'seat-b': 'offline' } }),
    { mode: 0o600 },
  );
  writeFileSync(
    path.join(d, 'workers.json'),
    JSON.stringify([
      { id: 'w1', deskId: 'desk-1', name: 'bot-a', status: 'offline', createdAt: 900 },
      { id: 'w2', deskId: 'desk-2', name: 'bot-b', status: 'idle', createdAt: 900 },
    ]),
    { mode: 0o600 },
  );
  office.close('owner', 2_000);
  // Fake clock wait, then open.
  office.openOnBoot(3_600_000);
  const glance = readSinceClose(office, d);
  assert.equal(glance.closeReason, 'owner');
  assert.equal(glance.needsOwner.lines.length, 0);
  // Idle/offline crew entries produce no lines at all (not red, not needs-owner).
  assert.equal(glance.finished.lines.length, 0);
  assert.equal(glance.inProgress.lines.length, 0);
  assert.equal(glanceHasLines(glance), false);
});

test('empty since-close is calm (empty glance, not an alarm shape)', () => {
  const g = emptyGlance({ since: 1000, closeReason: 'owner', dismissed: false });
  assert.equal(glanceHasLines(g), false);
  assert.equal(g.needsOwner.lines.length, 0);
  assert.deepEqual(g.finished, { lines: [], capped: false });
});

test('unclean stop labelled unexpected when inferable', (t) => {
  const d = dir(t);
  const a = new OfficeState(d);
  a.openOnBoot(1_000);
  writeFileSync(path.join(d, 'crew-status.json'), JSON.stringify({ updatedAt: new Date(1_800).toISOString(), crew: {} }), {
    mode: 0o600,
  });
  // Crash without close.
  const b = new OfficeState(d);
  b.openOnBoot(5_000, 1_800);
  assert.equal(b.state().sinceCloseReason, 'unexpected');
  const glance = readSinceClose(b, d);
  assert.equal(glance.closeReason, 'unexpected');
});

test('meeting and pool lines appear when stamped in-window; missing pool is skipped', (t) => {
  const d = dir(t);
  const office = new OfficeState(d);
  office.close('owner', 1_000);
  office.openOnBoot(5_000);
  writeFileSync(
    path.join(d, 'meetings.json'),
    JSON.stringify({
      current: null,
      past: [{ id: 'm1', pattern: 'debate', title: 'Pick a plan', status: 'done', summary: 'ok', calledBy: 'owner', finishedAt: 2_000, output: 'docs/x.md' }],
    }),
    { mode: 0o600 },
  );
  // No pool.json — must not throw.
  const glance = readSinceClose(office, d);
  assert.equal(glance.finished.lines.some((l) => l.source === 'meeting' && l.title === 'Pick a plan'), true);
  assert.equal(glance.finished.lines[0].at, 2_000);

  writeFileSync(
    path.join(d, 'pool.json'),
    JSON.stringify({ items: [{ title: 'Tiny chore', state: 'done', at: 3_000, seat: 'seat-a' }] }),
    { mode: 0o600 },
  );
  const withPool = readSinceClose(office, d);
  assert.equal(withPool.finished.lines.some((l) => l.source === 'pool'), true);
});

test('titles redact emails and paths; never invent open-time', () => {
  assert.equal(safeTitle('Ping owner@example.com about /home/me/secret'), 'Ping redacted about …');
  assert.equal(timeLabel(undefined), 'time unknown');
  assert.equal(timeLabel(0), 'time unknown');
  const lines = linesFromWorkers([{ id: 'w', deskId: 'desk-1', status: 'needs_input', activity: 'Approve?', waitingSince: 50 }], 100, 200);
  assert.equal(lines.length, 0); // waitingSince before since → excluded, no invented stamp
});

test('crew needs_input in-window can list needs owner; idle never does', () => {
  const need = linesFromCrewStatus(
    { updatedAt: new Date(150).toISOString(), crew: { 'seat-a': 'needs_input', 'seat-b': 'idle' } },
    100,
    200,
  );
  assert.equal(need.length, 1);
  assert.equal(need[0].kind, 'needsOwner');
  assert.equal(need[0].seat, 'seat-a');
});

test('buildGlance caps newest-first and keeps offline out of needsOwner', () => {
  const lines = [
    ...Array.from({ length: 8 }, (_, i) => ({
      source: 'queue',
      title: `T${i}`,
      at: 1000 + i,
      kind: 'finished' as const,
    })),
    { source: 'desk', title: 'Offline · since close', at: 900, kind: 'offline' as const, seat: 'desk-1' },
  ];
  const g = buildGlance(lines, { since: 500, dismissed: false });
  assert.equal(g.finished.lines.length, 6);
  assert.equal(g.finished.capped, true);
  assert.equal(g.finished.lines[0].title, 'T7');
  assert.equal(g.needsOwner.lines.length, 0);
  assert.equal(g.offline.lines.length, 1);
});

test('linesFromMeetings and linesFromPool are pure and skip bad rows', () => {
  assert.deepEqual(linesFromMeetings(null, 1), []);
  assert.deepEqual(linesFromPool(null, 1), []);
  // Long titles are truncated, not dropped; blank titles are skipped.
  const long = linesFromPool({ items: [{ title: 'x'.repeat(300), at: 50 }, { title: '  ', at: 50 }] }, 1);
  assert.equal(long.length, 1);
  assert.ok(long[0].title.length <= 80);
});

test('persistence + since-close survive a second OfficeState instance', (t) => {
  const d = dir(t);
  const a = new OfficeState(d);
  a.close('owner', 10_000);
  mkdirSync(d, { recursive: true });
  writeFileSync(
    path.join(d, 'queue.json'),
    JSON.stringify({
      maxWorkers: 2,
      tasks: [{ id: 't', title: 'Queued work', prompt: 'x', addedBy: 'owner', addedAt: 12_000, status: 'done', finishedAt: 13_000 }],
    }),
    { mode: 0o600 },
  );
  a.openOnBoot(20_000);
  const b = new OfficeState(d);
  const glance = readSinceClose(b, d);
  assert.equal(glance.finished.lines.some((l) => l.title === 'Queued work' && l.at === 13_000), true);
});
