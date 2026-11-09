// Sticky WORKING: a bridge "working" survives poll cycles, re-reads and terminal silence; it clears
// only on a real idle/done or on the working timeout. Fake seats only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyCrewPresence, settleQuietShell, tickWorkingLease, workingTimeoutMs, type CrewHost } from '../src/server/workers/crew.js';
import { commitStatus, tickWorkers } from '../src/server/workers/presence.js';
import type { Worker } from '../src/server/workers/types.js';
import type { WorkerStatus } from '../src/shared/protocol.js';

const SEAT = 'seat-1';

function crew(status: WorkerStatus = 'idle'): Worker {
  return { info: { id: 'crew-' + SEAT, name: SEAT, kind: 'crew', status, acked: true, viewers: [], viewerIds: [] }, viewers: new Map(), outputAt: 1 } as unknown as Worker;
}

function host(ws: Worker[]) {
  const log: string[] = [];
  const h: CrewHost = {
    workers: new Map(ws.map((w) => [w.info.id, w])),
    setStatus: (w, s) => commitStatus(w, s, { emit: () => log.push(w.info.name + ':' + s), persist() {}, syncBranch() {} }),
    emitUpdate: () => {},
  } as CrewHost;
  return { h, log };
}

const noEvents = { update() {}, screen() {}, data() {}, toast() {} } as never;

test('WORKING stays on across many poll and file re-read cycles (no flicker)', () => {
  const w = crew();
  const { h, log } = host([w]);
  const t0 = Date.now();
  const seen = { [SEAT]: t0 };
  applyCrewPresence(h, { [SEAT]: 'working' }, { now: t0, seen });
  assert.equal(w.info.status, 'working');
  for (let t = t0; t < t0 + 120_000; t += 250) {
    tickWorkers(h.workers, noEvents, h.setStatus, t);
    if ((t - t0) % 3000 === 0) tickWorkingLease(h, { shellIdleMs: 12_000, leaseMs: 900_000 }, t);
    if ((t - t0) % 4000 === 0) applyCrewPresence(h, { [SEAT]: 'working' }, { now: t, seen });
    settleQuietShell(w, t);
    assert.equal(w.info.status, 'working', `flipped at +${t - t0} ms`);
  }
  assert.deepEqual(log, [SEAT + ':working'], 'exactly one transition');
  assert.equal(w.sticky?.at, t0, 'timeout runs from the real push, not the re-read');
});

test('a stale working push (older than the timeout) never paints WORKING', () => {
  const w = crew();
  const { h } = host([w]);
  const now = Date.now();
  applyCrewPresence(h, { [SEAT]: 'working' }, { now, seen: { [SEAT]: now - 2 * 3600_000 }, leaseMs: 900_000 });
  assert.equal(w.info.status, 'idle');
  assert.equal(w.sticky, undefined);
});

test('clears on a real idle/done signal', () => {
  const w = crew();
  const { h } = host([w]);
  const now = Date.now();
  applyCrewPresence(h, { [SEAT]: 'working' }, { now, seen: { [SEAT]: now } });
  applyCrewPresence(h, { [SEAT]: 'done' }, { now: now + 1, seen: { [SEAT]: now + 1 } });
  assert.equal(w.info.status, 'idle');
  assert.equal(w.sticky, undefined);
  applyCrewPresence(h, { [SEAT]: 'working' }, { now: now + 2, seen: { [SEAT]: now + 2 } });
  h.setStatus(w, 'done');
  assert.equal(w.sticky, undefined, 'any real move off working drops the sticky flag');
});

test('clears on the working timeout', () => {
  const w = crew();
  const { h } = host([w]);
  const t0 = Date.now();
  applyCrewPresence(h, { [SEAT]: 'working' }, { now: t0, seen: { [SEAT]: t0 }, leaseMs: 60_000 });
  tickWorkingLease(h, { shellIdleMs: 12_000, leaseMs: 900_000, stickyMs: 60_000 }, t0 + 59_000);
  assert.equal(w.info.status, 'working');
  tickWorkingLease(h, { shellIdleMs: 12_000, leaseMs: 900_000, stickyMs: 60_000 }, t0 + 60_000);
  assert.equal(w.info.status, 'idle');
  assert.equal(w.sticky, undefined);
});

test('timeout is configurable and clamped', () => {
  assert.equal(workingTimeoutMs({}), 900_000);
  assert.equal(workingTimeoutMs({ AO_WORKING_TIMEOUT_MS: '120000' }), 120_000);
  assert.equal(workingTimeoutMs({ AO_WORKING_TIMEOUT_MS: '5' }), 10_000);
  assert.equal(workingTimeoutMs({ AO_WORKING_TIMEOUT_MS: 'nope' }), 900_000);
});
