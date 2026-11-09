import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCover } from '../src/shared/kavi-cover.ts';

const on = `COVER GEORGE ON
at: 2026-10-25T01:00:00Z
reason: usage-empty
row: WQ-7 | Routed | Kavi | 2026-10-25T18:00:00Z | file open bridge issues`;

const order = `COVER GEORGE
at: 2026-10-25T01:10:00Z
set: WQ-7 | In progress | ForgeL | 2026-10-26T18:00:00Z | open the PR
quote: Notion path GO (G1) | Yes, ship it | 2026-10-25T01:09:00Z`;

test('digest on and order parse', () => {
  const digest = parseCover(on);
  assert.equal(digest.ok, true);
  if (!digest.ok) return;
  assert.equal(digest.packet.kind, 'on');
  if (digest.packet.kind !== 'on') return;
  assert.equal(digest.packet.rows[0]?.ref, 'WQ-7');
  const act = parseCover(order);
  assert.equal(act.ok, true);
  if (!act.ok || act.packet.kind !== 'order') return;
  assert.equal(act.packet.actions[0]?.lane, 'ForgeL');
  assert.equal(act.packet.quote?.text, 'Yes, ship it');
});

test('off is empty', () => {
  const off = parseCover('COVER GEORGE OFF\nat: 2026-10-25T02:00:00Z\nreason: usage-back');
  assert.equal(off.ok, true);
  if (!off.ok) return;
  assert.equal(off.packet.kind, 'off');
});

test('rejects a third Nick step, a parked lane, and a secret shape', () => {
  const wait = on.replace('Routed', 'Waiting on Nick');
  assert.equal(parseCover(wait).ok, false);
  const grok = on.replace('| Kavi |', '| Grok Bot |');
  assert.equal(parseCover(grok).ok, false);
  assert.equal(parseCover(on + '\nrow: WQ-8 | Done | Jack | 2026-10-25T18:00:00Z | see Major Files').ok, false);
  assert.equal(parseCover(order.replace('open the PR', 'key sk-live-abc')).ok, false);
});
