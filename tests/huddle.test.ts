import test from 'node:test';
import assert from 'node:assert/strict';
import { DESKS } from '../src/shared/layout.js';
import { allowedIdleActs } from '../src/shared/idle-acts.js';
import {
  DECISION_CAP,
  addDecision,
  applyBotStep,
  inviteWorker,
  openHuddle,
  rosterMark,
  setShared,
  workerQuorum,
  type GateWorker,
} from '../src/shared/huddle.js';
import { frontDeskIds, appendSeatTurn, latestCrewReply, defaultSeatProvider, readSeatChoice } from '../src/shared/seat-provider.js';

const idle = (id: string, name: string, over: Partial<GateWorker> = {}): GateWorker => ({ id, name, status: 'idle', acked: true, ...over });

test('the three front desks are the south row nearest the middle', () => {
  const ids = frontDeskIds(DESKS);
  assert.equal(ids.length, 3);
  const room = DESKS.filter((d) => !d.wing);
  const maxZ = Math.max(...room.map((d) => d.z));
  const front = room.filter((d) => d.z === maxZ).sort((a, b) => Math.abs(a.x) - Math.abs(b.x));
  assert.deepEqual(ids, front.slice(0, 3).map((d) => d.id));
});

test('WORKING and needs owner cannot join a huddle; idle can', () => {
  assert.deepEqual(allowedIdleActs(idle('a', 'A')), ['roam', 'meeting', 'ball']);
  assert.deepEqual(allowedIdleActs(idle('a', 'A', { status: 'working' })), []);
  assert.deepEqual(allowedIdleActs(idle('a', 'A', { status: 'needs_input' })), []);
  assert.deepEqual(allowedIdleActs(idle('a', 'A', { status: 'done', acked: false })), []);
  assert.deepEqual(allowedIdleActs(idle('a', 'A', { status: 'offline' })), []);
  assert.ok(allowedIdleActs(idle('a', 'A', { status: 'done', acked: true })).includes('meeting'));
});

test('invite, quorum, decision log, and roster use real occupants only', () => {
  let h = openHuddle({ kind: 'peer', id: 'p1', name: 'Host' }, 1, 'h1');
  const blocked = inviteWorker(h, 'p1', idle('w1', 'Worker A', { status: 'working' }));
  assert.equal(blocked.ok, false);
  const needs = inviteWorker(h, 'p1', idle('w2', 'Worker B', { status: 'needs_input' }));
  assert.equal(needs.ok, false);
  const first = inviteWorker(h, 'p1', idle('w1', 'Worker A'));
  assert.equal(first.ok, true);
  if (!first.ok) return;
  h = first.huddle;
  assert.equal(workerQuorum(h), false);
  const second = inviteWorker(h, 'p1', idle('w2', 'Worker B'));
  assert.equal(second.ok, true);
  if (!second.ok) return;
  h = second.huddle;
  assert.equal(workerQuorum(h), true);
  assert.equal(rosterMark(h, 'worker', 'w1'), 'in meeting');
  assert.equal(rosterMark(h, 'worker', 'nope'), undefined);
  const shared = setShared(h, 'p1', 'Agenda', 'Context');
  assert.equal(shared.ok, true);
  if (!shared.ok) return;
  h = shared.huddle;
  const logged = addDecision(h, 'p1', { id: 'd1', text: 'Ship the note', owner: 'Worker A', needsOwner: true, at: 2 });
  assert.equal(logged.ok, true);
  if (!logged.ok) return;
  assert.equal(logged.huddle.decisions[0].needsOwner, true);
  assert.equal(logged.huddle.decisions[0].owner, 'Worker A');
  const stranger = addDecision(h, 'p1', { id: 'd2', text: 'Nope', owner: 'Nobody', needsOwner: false, at: 3 });
  assert.equal(stranger.ok, false);
});

test('an idle worker may start or join, and leaves when work starts, without a canned line', () => {
  const workers = [idle('w1', 'Worker A'), idle('w2', 'Worker B', { status: 'working' })];
  const started = applyBotStep(null, workers, (ids) => ids[0], 5, () => 'hid');
  assert.equal(started.act, 'start');
  assert.equal(started.workerId, 'w1');
  assert.equal(started.huddle?.agenda, '');
  assert.equal(started.huddle?.occupants.length, 1);
  const joined = applyBotStep(started.huddle, [idle('w1', 'Worker A'), idle('w2', 'Worker B')], (ids) => ids[0], 6, () => 'x');
  assert.equal(joined.act, 'join');
  assert.equal(joined.huddle?.occupants.some((o) => o.id === 'w2'), true);
  const left = applyBotStep(joined.huddle, [idle('w1', 'Worker A', { status: 'needs_input' }), idle('w2', 'Worker B')], () => undefined, 7, () => 'x');
  assert.equal(left.act, 'leave');
  assert.equal(left.workerId, 'w1');
  assert.equal(JSON.stringify(left).includes('WORKING'), false);
});

test('bridge turns do not invent a reply, and a request url is not a provider', () => {
  const items = appendSeatTurn([], 'floor', 'meeting-room', 'ping', 't');
  assert.equal(items.length, 1);
  assert.equal(items[0].title, 'seat:floor:meeting-room');
  assert.equal(latestCrewReply(items, 'floor', 'meeting-room'), null);
  const withReply = [...items, { title: 'reply:floor:meeting-room', text: 'pong', at: 't2' }];
  assert.equal(latestCrewReply(withReply, 'floor', 'meeting-room')?.text, 'pong');
  assert.equal(latestCrewReply([...withReply, { title: 'reply:floor:meeting-room', text: '   ', at: 't3' }], 'floor', 'meeting-room')?.text, 'pong');
  assert.equal(defaultSeatProvider('offline', true), 'bridge');
  assert.equal(defaultSeatProvider('ready', false), 'bridge');
  assert.equal(defaultSeatProvider('ready', true), 'ollama');
  assert.equal(readSeatChoice({ provider: 'ollama' }), 'ollama');
  assert.equal(readSeatChoice({ provider: 'http://evil.invalid' }), null);
});

test('a huddle keeps the latest 100 decisions', () => {
  let h = openHuddle({ kind: 'peer', id: 'p1', name: 'Host' }, 1, 'h1');
  for (let i = 0; i < DECISION_CAP; i++) {
    const added = addDecision(h, 'p1', { id: String(i), text: `note ${i}`, owner: 'Host', needsOwner: false, at: i });
    assert.equal(added.ok, true);
    if (added.ok) h = added.huddle;
  }
  assert.equal(h.decisions.length, DECISION_CAP);
  assert.equal(h.decisions[0].id, '0');
  const extra = addDecision(h, 'p1', { id: 'last', text: 'the newest', owner: 'Host', needsOwner: true, at: DECISION_CAP });
  assert.equal(extra.ok, true);
  if (!extra.ok) return;
  assert.equal(extra.huddle.decisions.length, DECISION_CAP);
  assert.equal(extra.huddle.decisions[0].id, '1');
  assert.equal(extra.huddle.decisions.at(-1)?.id, 'last');
  assert.equal(extra.huddle.decisions.at(-1)?.needsOwner, true);
});
