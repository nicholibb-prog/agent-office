// Default-deny pool policy: approvers, levels, identity, caps, and a quiet puller.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Accounts } from '../src/server/accounts.js';
import { WorkPool } from '../src/server/pool/pool.js';
import { createOkkinPuller } from '../src/server/pool/puller.js';
import { visiblePoolText } from '../src/client/features/work-pool/bidi.js';
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

test('split, suffixed, and mixed-script wording raises the pool level', () => {
  const seven = [
    'sending',
    'emailing',
    'paid',
    'paying',
    'deleting',
    'e-mail',
    'p a y',
    's-e-n-d',
    'send_email()',
    'paypal',
    'buy the paper',
    'purchase the paper',
    'post an update',
    's\u0435nd',
    '\u0455end',
    's\u034Fend',
  ];
  for (const text of seven) assert.equal(enforcedLevel(1, text), 7, text);
  for (const text of ['pushed', 'keys', 'secrets', 'passwords', 'credentials', 'authentication']) {
    assert.equal(enforcedLevel(1, text), 6, text);
  }
  assert.equal(enforcedLevel(1, 'curl'), 6);
  assert.equal(enforcedLevel(1, 'wget'), 6);
  assert.equal(enforcedLevel(1, 'https://example.com'), 6);
  assert.equal(enforcedLevel(1, 'the url'), 6);
  assert.equal(enforcedLevel(1, 'ssh'), 6);
  assert.equal(enforcedLevel(1, 'scp'), 6);
  assert.equal(enforcedLevel(1, 'rm -rf'), 4);
  assert.equal(enforcedLevel(1, 'DM'), 7);
  assert.equal(enforcedLevel(1, 'a text'), 7);
  assert.equal(enforcedLevel(1, 'an sms'), 7);
  assert.equal(enforcedLevel(1, 'a tweet'), 7);
  assert.equal(enforcedLevel(1, 'venmo'), 7);
  assert.equal(enforcedLevel(1, 'zelle'), 7);
  assert.equal(enforcedLevel(1, 'cashapp'), 7);
  assert.equal(enforcedLevel(1, 'order from amazon'), 7);
  assert.equal(enforcedLevel(1, 'signin'), 4);
  assert.equal(enforcedLevel(1, 'fix the bug in login.ts'), 4);
  assert.equal(enforcedLevel(1, 'he\u0435llo'), 4);
  assert.equal(enforcedLevel(1, 'go\u034Fod'), 1);
  assert.equal(normalizePoolText('p a y'), 'pay');
  assert.equal(normalizePoolText('e-mail'), 'email');
  assert.equal(normalizePoolText('s-e-n-d'), 'send');
  assert.equal(normalizePoolText('s\u0435nd'), 'send');
  assert.equal(normalizePoolText('s\u034Fend'), 'send');
  assert.equal(enforcedLevel(1, 'tidy the README wording'), 1);
  assert.equal(enforcedLevel(2, 'sort the queue by age'), 2);
});

test('compounds and disguised words keep the higher tier', () => {
  assert.equal(enforcedLevel(1, 'my-password'), 6);
  assert.equal(enforcedLevel(1, 'api_key'), 6);
  assert.equal(enforcedLevel(1, 'api-key'), 6);
  assert.equal(enforcedLevel(1, 'user.password'), 6);
  assert.equal(enforcedLevel(1, 'client-secret'), 6);
  assert.equal(enforcedLevel(1, 'access_token'), 6);
  assert.equal(enforcedLevel(1, 'github_token'), 6);
  assert.equal(enforcedLevel(1, 'myPassword'), 6);
  assert.equal(enforcedLevel(1, 'apiKey'), 6);
  assert.equal(enforcedLevel(1, 'gitPush'), 6);
  assert.equal(enforcedLevel(1, 'git-push'), 6);
  assert.equal(enforcedLevel(1, 'force-push'), 6);
  assert.equal(enforcedLevel(1, 're-deploy'), 6);
  assert.equal(enforcedLevel(1, 'gitpush'), 6);
  assert.equal(enforcedLevel(1, 're-send'), 7);
  assert.equal(enforcedLevel(1, 'auto-pay'), 7);
  assert.equal(enforcedLevel(1, 'x.send'), 7);
  assert.equal(enforcedLevel(1, 'foo.delete()'), 7);
  assert.equal(enforcedLevel(1, 'resend'), 7);
  assert.equal(enforcedLevel(1, 'repay'), 7);
  assert.equal(enforcedLevel(1, 'autopay'), 7);
  assert.equal(enforcedLevel(1, 'prepaid'), 7);
  assert.equal(enforcedLevel(1, 's3nd'), 7);
  assert.equal(enforcedLevel(1, 'p4y'), 7);
  assert.equal(enforcedLevel(1, 'p@y'), 7);
  assert.equal(enforcedLevel(1, 'ema1l'), 7);
  assert.equal(enforcedLevel(1, 'emai1'), 7);
  assert.equal(enforcedLevel(1, 'p41d'), 7);
  assert.equal(enforcedLevel(1, 'pa55word'), 6);
  assert.equal(enforcedLevel(1, '7oken'), 6);
  assert.equal(enforcedLevel(1, 't0ken'), 6);
  assert.equal(enforcedLevel(1, 'pa$$word'), 6);
  assert.equal(enforcedLevel(1, 's/e/n/d'), 7);
  assert.equal(enforcedLevel(1, 's,e,n,d'), 7);
  assert.equal(enforcedLevel(1, 's|e|n|d'), 7);
  assert.equal(enforcedLevel(1, 's*e*n*d'), 7);
  assert.equal(enforcedLevel(1, 's+e+n+d'), 7);
  assert.equal(enforcedLevel(1, 's\u00B7e\u00B7n\u00B7d'), 7);
  assert.equal(enforcedLevel(1, 's\ne\nn\nd'), 7);
  assert.equal(enforcedLevel(1, 'a tidy shelf'), 1);
});

test('accented latin stays low while other scripts do not', () => {
  assert.equal(enforcedLevel(1, 'W\u0130RE'), 7);
  assert.equal(enforcedLevel(1, 'EMA\u0130L'), 7);
  assert.equal(enforcedLevel(1, '\u0130NVO\u0130CE'), 7);
  assert.equal(enforcedLevel(1, '\u03A4\u039F\u039A\u0395\u039D'), 6);
  assert.equal(enforcedLevel(1, '\u039A\u0395\u03A5'), 6);
  assert.equal(enforcedLevel(1, '\u041A\u0415\u0423'), 6);
  assert.equal(enforcedLevel(1, '\uA4E2\uA4F0\uA4E0\uA4D3'), 7);
  assert.equal(enforcedLevel(1, '\u13A0'), 4);
  assert.equal(enforcedLevel(1, 'caf\u00E9 menu translation'), 1);
  assert.equal(enforcedLevel(1, 'se\u00F1or notes'), 1);
  assert.equal(enforcedLevel(1, 'na\u00EFve draft'), 1);
  assert.equal(enforcedLevel(1, 'context switch'), 1);
  assert.equal(enforcedLevel(1, 'admin note'), 1);
  assert.equal(enforcedLevel(1, 'he\u0435llo'), 4);
  assert.equal(enforcedLevel(1, 'go\u034Fod'), 1);
  assert.equal(enforcedLevel(1, 's\u034Fend'), 7);
});

test('channel payment and network words keep their tier', () => {
  assert.equal(enforcedLevel(1, 'dm'), 7);
  assert.equal(enforcedLevel(1, 'sms'), 7);
  assert.equal(enforcedLevel(1, 'tweet'), 7);
  assert.equal(enforcedLevel(1, 'text'), 7);
  assert.equal(enforcedLevel(1, 'venmo'), 7);
  assert.equal(enforcedLevel(1, 'zelle'), 7);
  assert.equal(enforcedLevel(1, 'cashapp'), 7);
  assert.equal(enforcedLevel(1, 'order'), 7);
  assert.equal(enforcedLevel(1, 'mail'), 7);
  assert.equal(enforcedLevel(1, 'forward'), 7);
  assert.equal(enforcedLevel(1, 'money'), 7);
  assert.equal(enforcedLevel(1, 'charge'), 7);
  assert.equal(enforcedLevel(1, 'donate'), 7);
  assert.equal(enforcedLevel(1, 'bitcoin'), 7);
  assert.equal(enforcedLevel(1, 'seed phrase'), 7);
  assert.equal(enforcedLevel(1, 'iban'), 7);
  assert.equal(enforcedLevel(1, 'curl'), 6);
  assert.equal(enforcedLevel(1, 'wget'), 6);
  assert.equal(enforcedLevel(1, 'http'), 6);
  assert.equal(enforcedLevel(1, 'url'), 6);
  assert.equal(enforcedLevel(1, 'ssh'), 6);
  assert.equal(enforcedLevel(1, 'scp'), 6);
  assert.equal(enforcedLevel(1, 'upload'), 6);
  assert.equal(enforcedLevel(1, 'exec'), 6);
  assert.equal(enforcedLevel(1, 'bash'), 6);
  assert.equal(enforcedLevel(1, 'nc'), 6);
  assert.equal(enforcedLevel(1, 'ftp'), 6);
  assert.equal(enforcedLevel(1, 'drop table'), 6);
  assert.equal(enforcedLevel(1, 'notes.py'), 4);
  assert.equal(enforcedLevel(1, 'tidy the README wording'), 1);
  assert.equal(enforcedLevel(2, 'sort the queue by age'), 2);
});

test('format and ignorable characters do not split a word', () => {
  assert.equal(enforcedLevel(1, 's\u00ADend'), 7);
  assert.equal(enforcedLevel(1, 's\uFE0Fend'), 7);
  assert.equal(enforcedLevel(1, 's\uFE00end'), 7);
  assert.equal(enforcedLevel(1, 'to\u2063ken'), 6);
  assert.equal(enforcedLevel(1, 'to\u2062ken'), 6);
  assert.equal(enforcedLevel(1, 's\u200Bend'), 7);
  assert.equal(enforcedLevel(1, 's\u061Cend'), 7);
  assert.equal(enforcedLevel(1, 's\u180Eend'), 7);
  assert.equal(enforcedLevel(1, 's\u{1D173}end'), 7);
  assert.equal(enforcedLevel(1, 's\u{E0001}end'), 7);
  assert.equal(enforcedLevel(1, 's\u{E0100}end'), 7);
  assert.equal(normalizePoolText('s\u00ADend'), 'send');
});

test('latin letters that do not decompose keep their tier', () => {
  assert.equal(enforcedLevel(1, 'pa\u00DFword'), 6);
  assert.equal(enforcedLevel(1, 't\u00F8ken'), 6);
  assert.equal(enforcedLevel(1, '\u1D1B\u1D0F\u1D0B\u1D07\u0274'), 6);
  assert.equal(enforcedLevel(1, 'caf\u00E9 menu translation'), 1);
  assert.equal(enforcedLevel(1, 'se\u00F1or notes'), 1);
  assert.equal(enforcedLevel(1, 'na\u00EFve draft'), 1);
  assert.equal(enforcedLevel(1, 't\u00F0ken'), 4);
  assert.equal(enforcedLevel(1, '\u24C8end'), 7);
  assert.equal(enforcedLevel(1, '\u{1F142}end'), 7);
  assert.equal(enforcedLevel(1, '\u{1F182}\u{1F174}\u{1F17D}\u{1F173}'), 7);
  assert.equal(enforcedLevel(1, '\uFF53\uFF45\uFF4E\uFF44'), 7);
});

test('character references are scored once', () => {
  assert.equal(enforcedLevel(1, '&#115;end'), 7);
  assert.equal(enforcedLevel(1, '&#x73;end'), 7);
  assert.equal(enforcedLevel(1, '%73end'), 7);
  assert.equal(enforcedLevel(1, '&amp;#115;end'), 1);
  assert.equal(enforcedLevel(1, 'tidy the shelf'), 1);
});

test('erase, messengers, and bare domains raise the floor', () => {
  assert.equal(enforcedLevel(1, 'erase the draft'), 7);
  assert.equal(enforcedLevel(1, 'destroy the draft'), 7);
  assert.equal(enforcedLevel(1, 'whatsapp'), 7);
  assert.equal(enforcedLevel(1, 'telegram'), 7);
  assert.equal(enforcedLevel(1, 'signal-message'), 7);
  assert.equal(enforcedLevel(1, 'example.com'), 6);
  assert.equal(enforcedLevel(1, 'notes.py'), 4);
});

test('benign whole words stay low and disguised forms do not', () => {
  assert.equal(enforcedLevel(1, 'textbook'), 1);
  assert.equal(enforcedLevel(1, 'text-book'), 7);
  assert.equal(enforcedLevel(1, 'textbooks'), 7);
  assert.equal(enforcedLevel(1, 'mailbox'), 1);
  assert.equal(enforcedLevel(1, 'mail-box'), 7);
  assert.equal(enforcedLevel(1, 'forward planning'), 1);
  assert.equal(enforcedLevel(1, 'forward'), 7);
  assert.equal(enforcedLevel(1, 'forward-planning'), 7);
  assert.equal(enforcedLevel(1, 'author'), 1);
  assert.equal(enforcedLevel(1, 'authors'), 6);
  assert.equal(enforcedLevel(1, 'keyboard'), 1);
  assert.equal(enforcedLevel(1, 'key'), 6);
  assert.equal(enforcedLevel(1, 'dmv'), 1);
  assert.equal(enforcedLevel(1, 'dm'), 7);
  assert.equal(enforcedLevel(1, 't3xtbook'), 7);
});

test('approval text shows bidi controls as markers', () => {
  const shown = visiblePoolText('\u202Ednes');
  assert.equal(shown, '\u27E8RLO\u27E9dnes');
  assert.equal(shown.includes('\u202E'), false);
  assert.equal(visiblePoolText('a\u200Fb'), 'a\u27E8RLM\u27E9b');
  assert.equal(visiblePoolText('\u202A\u202B\u202C\u202D\u2066\u2067\u2068\u2069\u200E\u061C'), '\u27E8LRE\u27E9\u27E8RLE\u27E9\u27E8PDF\u27E9\u27E8LRO\u27E9\u27E8LRI\u27E9\u27E8RLI\u27E9\u27E8FSI\u27E9\u27E8PDI\u27E9\u27E8LRM\u27E9\u27E8ALM\u27E9');
  assert.equal(visiblePoolText('send'), 'send');
});

test('keyword checks stay linear on long text', () => {
  const chunk = 'tidy the shelf and sort the notes. ';
  const small = chunk.repeat(Math.ceil(100_000 / chunk.length)).slice(0, 100_000);
  const big = chunk.repeat(Math.ceil(1_000_000 / chunk.length)).slice(0, 1_000_000);
  const started = Date.now();
  assert.equal(enforcedLevel(1, small), 1);
  const mid = Date.now();
  assert.equal(enforcedLevel(1, big), 1);
  const done = Date.now();
  const smallMs = mid - started;
  const bigMs = done - mid;
  assert.ok(smallMs < 2_000, `100k took ${smallMs}ms`);
  assert.ok(bigMs < 8_000, `1M took ${bigMs}ms`);
  assert.ok(bigMs < smallMs * 30 + 1_000, `1M ${bigMs}ms vs 100k ${smallMs}ms`);
  const hyphens = 'a-'.repeat(500_000);
  const hyped = Date.now();
  assert.equal(enforcedLevel(1, hyphens), 1);
  assert.ok(Date.now() - hyped < 8_000, 'spaced singles stayed linear');
});

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

test('owner approval refuses the Dan pass recorder and a past claimer', (t) => {
  const morgan: PoolActor = { id: 'acct-morgan', label: 'Morgan' };
  const dir = dirOf(t, { approvers: [CASEY.id, RILEY.id, morgan.id], dan: [RILEY.id] });
  const pool = new WorkPool(dir);
  const job = must(pool.post({ title: 'Gate', body: 'Review the session check.', level: 6, targetBot: PIPER.id }, ADA));
  must(pool.claim(job.id, PIPER));
  const waiting = must(pool.complete(job.id, PIPER));
  const passed = must(pool.danPass(job.id, RILEY, saw(waiting)));
  const fresh = saw(passed);
  const samePerson = pool.ownerApproval(job.id, RILEY, fresh);
  assert.equal(samePerson.ok, false);
  assert.equal((samePerson as { status: number }).status, 403);
  assert.equal((samePerson as { error: string }).error, 'cannot approve a pass you recorded');

  const raw = JSON.parse(readFileSync(path.join(dir, 'work-pool.json'), 'utf8')) as { jobs: PoolJob[] };
  const stored = raw.jobs.find((j) => j.id === job.id)!;
  stored.history.push({ by: morgan.id, at: 1, leaseUntil: 2, endedAt: 3, reason: 'released' });
  writeFileSync(path.join(dir, 'work-pool.json'), JSON.stringify(raw) + '\n', { mode: 0o600 });
  const again = new WorkPool(dir);
  const reloaded = again.get(job.id)!;
  const past = again.ownerApproval(job.id, morgan, saw(reloaded));
  assert.equal(past.ok, false);
  assert.equal((past as { status: number }).status, 403);
  assert.equal((past as { error: string }).error, 'cannot approve your own job');
  assert.equal(must(again.ownerApproval(job.id, CASEY, saw(reloaded))).status, 'done');
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
