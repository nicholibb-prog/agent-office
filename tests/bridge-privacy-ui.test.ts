// Non-owner notes for crew talk and the Kavi outbox, the talk lock, and the committed seat-map example.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import {
  ASK_PRIVATE_NOTE, CREW_PRIVATE_NOTE, OUTBOX_EMPTY_NOTE, OUTBOX_PRIVATE_NOTE, TALK_LOCKED_NOTE, UNMAPPED_SEAT_LABEL,
  isSeatId, outboxView, talkLocked, talkSendError, threadPrivateNote,
} from '../src/shared/hq.js';
import { loadSeatMap } from '../src/server/seat-map.js';

test('crew thread: a non-owner gets the neutral crew note, never a blank log', () => {
  assert.equal(threadPrivateNote('seat-1', { messages: [], private: true }), CREW_PRIVATE_NOTE);
  assert.equal(threadPrivateNote('okkin', { messages: [], private: true }), ASK_PRIVATE_NOTE);
  assert.equal(threadPrivateNote('seat-1', { messages: [], private: false }), null);
  assert.equal(threadPrivateNote('seat-1', { messages: [{}], private: false }), null);
  assert.equal(CREW_PRIVATE_NOTE, 'Crew threads are private — unlock owner to see them.');
});

test('talk lock: private means locked; a 403 shows "Unlock owner to talk", not a status code', () => {
  assert.equal(talkLocked({ private: true }), true);
  assert.equal(talkLocked({ private: false }), false);
  assert.equal(talkLocked(undefined), false);
  assert.equal(TALK_LOCKED_NOTE, 'Unlock owner to talk');
  assert.equal(talkSendError(403, 'owner only'), TALK_LOCKED_NOTE);
  assert.ok(!talkSendError(403).includes('403'));
  assert.equal(talkSendError(429, 'slow down'), 'Not sent: slow down');
});

test('outbox board: non-owner note; owner rows label unmapped items', () => {
  assert.deepEqual(outboxView({ items: [], private: true }), { note: OUTBOX_PRIVATE_NOTE, rows: [] });
  assert.equal(outboxView({ items: [], private: false }).note, OUTBOX_EMPTY_NOTE);
  const v = outboxView({ private: false, items: [
    { title: 'seat:floor-1:desk-1', text: 'placeholder A', at: 'x', seat: 'seat-1' },
    { title: 'seat:floor-1:desk-3', text: 'placeholder B', at: 'y', seat: null },
    { title: 'legacy', text: 'placeholder C', at: 'z' },
  ] });
  assert.equal(v.note, null);
  assert.deepEqual(v.rows.map((r) => [r.seat, r.mapped]), [['seat-1', true], [UNMAPPED_SEAT_LABEL, false], [UNMAPPED_SEAT_LABEL, false]]);
  assert.equal(UNMAPPED_SEAT_LABEL, 'not mapped to a crew seat');
});

test('seat-map.example.json is committed, placeholder-only, and loads as a valid map', () => {
  const file = path.join(import.meta.dirname, '..', '.agent-office', 'seat-map.example.json');
  const raw = JSON.parse(readFileSync(file, 'utf8')) as Record<string, string>;
  assert.ok(Object.keys(raw).length > 0);
  for (const [k, v] of Object.entries(raw)) {
    assert.match(k, /^floor-\d+:(desk-\d+|meeting-room)$/);
    assert.ok(isSeatId(v) && /^seat-\d$/.test(v), 'placeholder crew ids only');
  }
  // Same content under the real name is accepted in full by the loader.
  const dir = mkdtempSync(path.join(tmpdir(), 'ao-seatmap-ex-'));
  writeFileSync(path.join(dir, 'seat-map.json'), JSON.stringify(raw));
  assert.deepEqual(loadSeatMap(dir), raw);
  rmSync(dir, { recursive: true, force: true });
  // The example itself is never read as the live map.
  assert.deepEqual(loadSeatMap(path.dirname(file)), {});
});

test('client wiring: talk passes the lock, 403 locks, roster opens the outbox', () => {
  const root = path.join(import.meta.dirname, '..', 'src', 'client', 'features', 'hq');
  const idx = readFileSync(path.join(root, 'index.ts'), 'utf8');
  const ui = readFileSync(path.join(root, 'ui.ts'), 'utf8');
  const css = readFileSync(path.join(root, 'ui.css'), 'utf8');
  assert.match(idx, /threadPrivateNote\(row\.seat, data\)/);
  assert.match(idx, /res\.status === 403\) \{[\s\S]*?return panel\.lock/);
  assert.match(idx, /\/api\/bridge\/kavi-outbox/);
  assert.match(ui, /input\.disabled = true/);
  assert.match(css, /\.hq-private \{[^}]*color: #9aa0a6/);
});
