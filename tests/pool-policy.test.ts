// Default-deny pool policy: approvers, levels, identity, caps, and a quiet puller.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Accounts } from '../src/server/accounts.js';
import { WorkPool } from '../src/server/pool/pool.js';
import { createOkkinPuller } from '../src/server/pool/puller.js';
import { claimRefusal, enforcedLevel, normalizePoolText, type PoolActor, type PoolJob, type PoolPolicy } from '../src/shared/pool.js';

const ADA: PoolActor = { id: 'acct-ada', label: 'Ada' };
const PIPER: PoolActor = { id: 'id-piper', label: 'piper' };
const OKKIN_ACTOR: PoolActor = { id: 'id-okkin', label: 'okkin' };
const RILEY: PoolActor = { id: 'id-riley', label: 'Riley' };
const CASEY: PoolActor = { id: 'acct-casey', label: 'Casey' };

function policy(extra: Partial<PoolPolicy> = {}): PoolPolicy {
  return {
    approvers: [CASEY.id],
    lowLevelPosters: [ADA.id],
    highLevelPosters: [ADA.id],
    crew: [PIPER.id, ADA.id, RILEY.id],
    dan: [RILEY.id],
    okkin: [OKKIN_ACTOR.id],
    reservedNames: [],
    ...extra,
  };
}

function dirOf(t: { after(fn: () => void): void }, extra?: Partial<PoolPolicy>) {
  const dir = mkdtempSync(path.join(tmpdir(), 'ao-pool-policy-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(path.join(dir, 'work-pool-policy.json'), JSON.stringify(policy(extra)) + '\n', { mode: 0o600 });
  return dir;
}

function clock() {
  let now = 1_700_000_000_000;
  return { now: () => now, advance(ms: number) { now += ms; } };
}

function must<T>(result: { ok: true; value: T } | { ok: false; status: number; error: string }): T {
  assert.equal(result.ok, true, result.ok ? '' : `${result.status} ${result.error}`);
  return (result as { ok: true; value: T }).value;
}

function saw(job: PoolJob) {
  return { state: job.status, updatedAt: job.updatedAt, hash: job.contentHash ?? '' };
}

test('keyword backstops and a missing level are not Okkin-eligible', () => {
  assert.equal(normalizePoolText('se\u200bnd'), 'send');
  for (const text of ['sends', 'payment', 'se\u200bnd']) {
    const level = enforcedLevel(undefined, text);
    assert.ok(level >= 4, text);
    assert.ok(claimRefusal(level, OKKIN_ACTOR.id, OKKIN_ACTOR.id, { okkin: [OKKIN_ACTOR.id], crew: [OKKIN_ACTOR.id] }));
  }
  assert.equal(enforcedLevel(undefined, 'tidy the shelf'), 4);
  assert.equal(enforcedLevel(undefined, 'please deploy the notes'), 6);
  assert.equal(enforcedLevel(undefined, 'remove the draft'), 7);
});

test('levels 1–3 and 6–7 are allowlisted, and 4 is the default', (t) => {
  const dir = dirOf(t, { lowLevelPosters: [], highLevelPosters: [] });
  const pool = new WorkPool(dir);
  const low = pool.post({ title: 'Notes', body: 'A tidy summary.', level: 2 }, ADA);
  assert.equal(low.ok, false);
  assert.equal((low as { status: number }).status, 403);
  const admin = must(pool.post({ title: 'Notes', body: 'A tidy summary.', level: 2 }, ADA, { admin: true }));
  assert.equal(admin.level, 2);
  const plain = must(pool.post({ title: 'Shelf', body: 'Tidy the shelf.' }, ADA));
  assert.equal(plain.level, 4);
  assert.equal(pool.claim(plain.id, OKKIN_ACTOR).ok, false);
  const raised = pool.post({ title: 'Ship', body: 'sends the note' }, ADA);
  assert.equal(raised.ok, false);
  assert.equal((raised as { error: string }).error, 'levels 6 and 7 are only for an allowlisted poster');
});

test('a caller above level 3 must be on the crew allowlist', (t) => {
  const pool = new WorkPool(dirOf(t, { crew: [] }));
  const job = must(pool.post({ title: 'Draft', body: 'A small wording fix.', level: 4 }, ADA));
  const guest = pool.claim(job.id, { id: 'id-guest', label: 'guest' });
  assert.equal(guest.ok, false);
  assert.match((guest as { error: string }).error, /crew allowlist/);
  assert.match((pool.claim(job.id, OKKIN_ACTOR) as { error: string }).error, /Okkin/);
});

test('Dan and an owner approver cannot approve work they already touched, and the hash must match', (t) => {
  const pool = new WorkPool(dirOf(t, { dan: [RILEY.id, ADA.id], approvers: [CASEY.id, ADA.id, PIPER.id] }));
  const job = must(pool.post({ title: 'Gate', body: 'Review the session check.', level: 6, targetBot: PIPER.id }, ADA));
  assert.equal(job.contentHash?.length, 64);
  const card = pool.board().columns.open[0];
  assert.equal(card.hash, job.contentHash);
  assert.match(card.body ?? '', /Review/);
  must(pool.claim(job.id, PIPER));
  const waiting = must(pool.complete(job.id, PIPER));
  const seen = saw(waiting);
  assert.equal((pool.danPass(job.id, ADA, seen) as { error: string }).error, 'cannot pass your own job');
  const passed = must(pool.danPass(job.id, RILEY, seen));
  const fresh = saw(passed);
  assert.equal((pool.ownerApproval(job.id, ADA, fresh) as { error: string }).error, 'cannot approve your own job');
  assert.equal((pool.ownerApproval(job.id, PIPER, fresh) as { error: string }).error, 'cannot approve your own job');
  const mismatch = { ...fresh, hash: 'ab'.repeat(32) };
  assert.equal((pool.ownerApproval(job.id, CASEY, mismatch) as { status: number }).status, 409);
  assert.equal((pool.ownerApproval(job.id, CASEY, mismatch) as { error: string }).error, 'content changed');
  const done = must(pool.ownerApproval(job.id, CASEY, fresh));
  assert.equal(done.approvedBy, CASEY.id);
});

test('caller names dan and okkin are reserved, and a policy name cannot be reused', (t) => {
  const dir = dirOf(t, { reservedNames: ['quinn'] });
  const pool = new WorkPool(dir);
  for (const name of ['dan', 'okkin', 'quinn']) {
    const made = pool.registerCaller(name);
    assert.equal('error' in made, true);
    assert.equal((made as { error: string }).error, 'that name is reserved');
  }
  const clash = pool.registerCaller('Ada', ['Ada']);
  assert.equal((clash as { error: string }).error, 'that name is an account');
  const quill = pool.registerCaller('quill');
  assert.equal('token' in quill, true);

  const home = mkdtempSync(path.join(tmpdir(), 'ao-accounts-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const accounts = new Accounts(home);
  assert.equal(accounts.invite('the test', 'member', 'quinn'), 'That name is reserved');
  assert.equal(accounts.invite('the test', 'member', 'quill'), 'That name is a pool caller');
});

test('posts are rate limited, history stays at 20, and done jobs stay at 200', (t) => {
  const time = clock();
  const pool = new WorkPool(dirOf(t), {}, { now: time.now });
  for (let i = 0; i < 8; i++) must(pool.post({ title: `n${i}`, body: 'A tidy note.' }, ADA));
  const blocked = pool.post({ title: 'n8', body: 'A tidy note.' }, ADA);
  assert.equal((blocked as { status: number }).status, 429);
  time.advance(60_001);
  const job = must(pool.post({ title: 'Again', body: 'A tidy note.', level: 4 }, ADA));
  for (let i = 0; i < 25; i++) {
    must(pool.claim(job.id, PIPER, 1_000));
    must(pool.release(job.id, PIPER));
  }
  assert.equal(pool.get(job.id)!.history.length, 20);

  for (let i = 0; i < 201; i++) {
    if (i % 8 === 0) time.advance(60_001);
    const done = must(pool.post({ title: `d${i}`, body: 'A tidy note.', level: 4 }, ADA));
    must(pool.claim(done.id, PIPER));
    must(pool.complete(done.id, PIPER));
  }
  assert.equal(pool.board().columns.done.length, 200);
});

test('load keeps open jobs ahead of a long done list', (t) => {
  const dir = dirOf(t);
  const done = Array.from({ length: 205 }, (_, i) => ({
    id: `d${i}`, title: 'Old', body: 'A tidy note.', level: 4, postedBy: ADA.id, createdAt: i, updatedAt: i,
    tags: [], status: 'done', history: Array.from({ length: 25 }, () => ({ by: PIPER.id, at: i, leaseUntil: i })),
  }));
  const open = { id: 'keep-me', title: 'Live', body: 'A tidy note.', level: 4, postedBy: ADA.id, createdAt: 1, updatedAt: 1, tags: [], status: 'open', history: [] };
  writeFileSync(path.join(dir, 'work-pool.json'), JSON.stringify({ jobs: [...done, open] }) + '\n', { mode: 0o600 });
  const pool = new WorkPool(dir);
  assert.equal(pool.get('keep-me')?.status, 'open');
  assert.equal(pool.board().columns.done.length, 200);
  assert.equal(pool.get('d0'), undefined);
  assert.ok((pool.get('d204')?.history.length ?? 0) <= 20);
});

test('auto-pull does not start without an armed runner', (t) => {
  let ticks = 0;
  const original = global.setInterval;
  global.setInterval = (() => {
    ticks += 1;
    return 0 as unknown as ReturnType<typeof setInterval>;
  }) as typeof setInterval;
  t.after(() => { global.setInterval = original; });
  const dir = dirOf(t);
  const quiet = new WorkPool(dir, {}, { autoPull: true, puller: createOkkinPuller() });
  const bare = new WorkPool(dir, {}, { autoPull: true });
  t.after(() => { quiet.stop(); bare.stop(); });
  assert.equal(createOkkinPuller().armed, false);
  assert.equal(createOkkinPuller({ idle: () => true, take() {} }).armed, true);
  assert.equal(ticks, 0);
  const floor = readFileSync(path.join('src', 'server', 'floor.ts'), 'utf8');
  const puller = readFileSync(path.join('src', 'server', 'pool', 'puller.ts'), 'utf8');
  assert.equal(floor.includes('autoPull'), false);
  assert.equal(/ollama|fetch\(|127\.0\.0\.1/.test(puller), false);
});
