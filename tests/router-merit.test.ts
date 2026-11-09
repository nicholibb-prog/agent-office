// Merit pick: best live router wins. Bench runs these five scenarios.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  MERIT_LANE_FITNESS,
  OVERSEER_ID,
  PUBLIC_CLOUD_LANES,
  activeTop,
  isPublicCloudLane,
  pickMerit,
  twoSentenceNote,
  type MeritDecision,
  type MeritKind,
  type MeritTask,
  type Presence,
  type PrivacyClass,
  type RouterCandidate,
  type RouterId,
} from '../src/server/router/merit.js';

const both = (george: Presence = 'on', kavi: Presence = 'on', fitness?: Partial<Record<RouterId, number>>): RouterCandidate[] => [
  { id: 'george-router', presence: george, ...(fitness?.['george-router'] !== undefined ? { laneFitness: fitness['george-router'] } : {}) },
  { id: 'kavi-router-2', presence: kavi, ...(fitness?.['kavi-router-2'] !== undefined ? { laneFitness: fitness['kavi-router-2'] } : {}) },
];

const task = (over: Partial<MeritTask> & Pick<MeritTask, 'privacy' | 'kind'>): MeritTask => ({
  id: 'task-1',
  ...over,
});

function sentences(note: string): string[] {
  return note.split(/(?<=[.!?])\s+/).filter(Boolean);
}

function assertNotPublicCloud(decision: MeritDecision, privacy: PrivacyClass) {
  assert.equal(isPublicCloudLane(decision.lane), false, `${privacy} lane ${decision.lane}`);
  for (const lane of PUBLIC_CLOUD_LANES) assert.notEqual(decision.lane, lane);
  assert.notEqual(decision.lane, 'george-deliverer');
  if (decision.winner === 'kavi-router-2') assert.notEqual(decision.lane, 'kavi-local');
  assert.equal(decision.overseer, OVERSEER_ID);
  assert.ok(sentences(decision.nickNote).length <= 2);
}

test('merit module stays pure', () => {
  const src = readFileSync(new URL('../src/server/router/merit.ts', import.meta.url), 'utf8');
  assert.equal(/process\.env|fetch\(|OLLAMA|API_KEY|127\.0\.0\.1|tailscale/i.test(src), false);
});

test('research: best live router wins, and unproven cheap lanes stay off', () => {
  const live = pickMerit(task({ privacy: 'public', kind: 'research', link: 'https://example.com/research' }), both());
  assert.equal(live.winner, 'george-router');
  assert.equal(live.top, 'george-router');
  assert.equal(live.lane, 'cursor');
  assert.equal(live.hold, false);
  assert.equal(live.laneTag, 'lane=cursor');
  assert.equal(live.scores[0].score, MERIT_LANE_FITNESS.research['george-router']);
  assert.ok(live.scores[0].score > live.scores[1].score);
  assert.deepEqual(sentences(live.nickNote), ['Owner: Cursor.', 'Link: https://example.com/research.']);

  const provedCheap = pickMerit(task({ privacy: 'public', kind: 'research' }), both(), { deepseekProven: true, jevProven: false });
  assert.equal(provedCheap.lane, 'deepseek');
  const jevFirst = pickMerit(task({ privacy: 'public', kind: 'research' }), both(), { jevProven: true, deepseekProven: true });
  assert.equal(jevFirst.lane, 'jev');

  const kaviBetter = pickMerit(task({ privacy: 'public', kind: 'research' }), both('on', 'on', { 'george-router': 4, 'kavi-router-2': 9 }));
  assert.equal(kaviBetter.winner, 'kavi-router-2');
  assert.equal(kaviBetter.tieBreak, null);
  assert.equal(kaviBetter.lane, 'cursor');
  assert.notEqual(kaviBetter.lane, 'kavi-local');
});

test('grok-proart: named desk only when quota is live, never DeepSeek', () => {
  const quota = pickMerit(task({ privacy: 'grey', kind: 'grok-proart' }), both(), { grokQuotaLive: true, deepseekProven: true });
  assert.equal(quota.winner, 'george-router');
  assert.equal(quota.lane, 'forgel');
  assert.equal(quota.hold, false);
  assertNotPublicCloud(quota, 'grey');

  const down = pickMerit(task({ privacy: 'grey', kind: 'grok-proart' }), both(), { grokQuotaLive: false, deepseekProven: true });
  assert.equal(down.winner, 'george-router');
  assert.equal(down.lane, 'wait');
  assert.equal(down.hold, true);
  assert.equal(down.holdReason, 'quota-not-live');
  assertNotPublicCloud(down, 'grey');

  const secret = pickMerit(task({ privacy: 'private', kind: 'grok-proart' }), both(), { grokQuotaLive: true, deepseekProven: true });
  assert.equal(secret.lane, 'kavi-local');
  assert.notEqual(secret.lane, 'forgel');
  assertNotPublicCloud(secret, 'private');
});

test('high-logic: power lane, not the cheap cloud', () => {
  const decision = pickMerit(task({ privacy: 'public', kind: 'high-logic', link: 'https://example.com/logic' }), both(), {
    deepseekProven: true,
    jevProven: true,
  });
  assert.equal(decision.winner, 'george-router');
  assert.equal(decision.lane, 'cursor');
  assert.equal(decision.hold, false);
  assert.match(decision.whyCheapest, /cheapest-only is forbidden/);
  assert.equal(sentences(decision.nickNote).length, 2);
  assert.ok(decision.nickNote.startsWith('Owner: Cursor.'));

  const grey = pickMerit(task({ privacy: 'grey', kind: 'high-logic' }), both(), { deepseekProven: true });
  assert.equal(grey.lane, 'kavi-local');
  assertNotPublicCloud(grey, 'grey');
});

test('privacy: private and grey never go to public cloud or DeepSeek', () => {
  const classes: PrivacyClass[] = ['grey', 'private', 'secret'];
  const kinds: MeritKind[] = ['privacy', 'research', 'public-bulk', 'high-logic', 'general'];
  for (const privacy of classes) {
    for (const kind of kinds) {
      const decision = pickMerit(task({ id: `${privacy}-${kind}`, privacy, kind }), both(), {
        deepseekProven: true,
        jevProven: true,
        okkinProven: false,
      });
      assert.equal(decision.winner, 'george-router', `${privacy} ${kind}`);
      assert.equal(decision.lane, 'kavi-local', `${privacy} ${kind}`);
      assertNotPublicCloud(decision, privacy);
    }
  }

  const proved = pickMerit(task({ privacy: 'private', kind: 'privacy' }), both(), { okkinProven: true, deepseekProven: true });
  assert.equal(proved.lane, 'okkin');
  assertNotPublicCloud(proved, 'private');

  const greyProved = pickMerit(task({ privacy: 'grey', kind: 'privacy' }), both(), { okkinProven: true });
  assert.equal(greyProved.lane, 'okkin');

  const self = pickMerit(task({ privacy: 'private', kind: 'privacy' }), both('out', 'on'), { deepseekProven: true });
  assert.equal(self.winner, 'kavi-router-2');
  assert.equal(self.top, 'kavi-router-2');
  assert.equal(self.lane, 'hold-private');
  assert.equal(self.hold, true);
  assert.equal(self.holdReason, 'self-route-blocked');
  assertNotPublicCloud(self, 'private');
  assert.equal(sentences(self.nickNote).length, 1);
});

test('failover: george out goes to the next live router; both out is an empty top and HOLD', () => {
  const next = pickMerit(task({ privacy: 'public', kind: 'research' }), both('out', 'on'));
  assert.equal(next.winner, 'kavi-router-2');
  assert.equal(next.top, 'kavi-router-2');
  assert.equal(next.lane, 'cursor');
  assert.equal(next.scores.find((score) => score.id === 'george-router')?.eligible, false);

  const absent = pickMerit(task({ privacy: 'public', kind: 'general' }), both('absent', 'on'));
  assert.equal(absent.winner, 'kavi-router-2');
  assert.equal(activeTop(both('out', 'on')), 'kavi-router-2');

  const nonePublic = pickMerit(task({ privacy: 'public', kind: 'research' }), both('out', 'out'));
  assert.equal(nonePublic.top, null);
  assert.equal(nonePublic.winner, null);
  assert.equal(nonePublic.lane, 'wait');
  assert.equal(nonePublic.hold, true);
  assert.equal(nonePublic.holdReason, 'no-live-router');
  assert.equal(nonePublic.nickNote, '');

  const nonePrivate = pickMerit(task({ privacy: 'private', kind: 'privacy' }), both('absent', 'out'));
  assert.equal(nonePrivate.top, null);
  assert.equal(nonePrivate.lane, 'hold-private');
  assert.equal(nonePrivate.holdReason, 'no-live-router');
  assertNotPublicCloud(nonePrivate, 'private');

  const noneGrey = pickMerit(task({ privacy: 'grey', kind: 'general' }), both('out', 'absent'), { deepseekProven: true, okkinProven: true });
  assert.equal(noneGrey.top, null);
  assert.equal(noneGrey.lane, 'hold-private');
  assertNotPublicCloud(noneGrey, 'grey');

  assert.equal(activeTop(both('out', 'out')), null);
  assert.equal(activeTop([]), null);

  const tied = pickMerit(task({ privacy: 'public', kind: 'general' }), both());
  assert.equal(tied.winner, 'george-router');
  assert.equal(tied.tieBreak, 'role-split');
  assert.equal(tied.scores[0].score, tied.scores[1].score);
});

test('a note to Nick is owner plus link and nothing more', () => {
  assert.equal(twoSentenceNote('Cursor', 'https://example.com/a'), 'Owner: Cursor. Link: https://example.com/a.');
  assert.equal(sentences(twoSentenceNote('Cursor. Extra chart. More.', 'https://example.com/a. And a rewrite.')).length, 2);
  assert.equal(twoSentenceNote('HOLD'), 'Owner: HOLD.');
});
