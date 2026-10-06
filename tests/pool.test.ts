// Community work pool: leases, levels, approval, and who is allowed to record it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { requestHandler } from '../src/server/http/router.js';
import { poolRoutes } from '../src/server/http/routes/pool.js';
import { WorkPool } from '../src/server/pool/pool.js';
import { createOkkinPuller } from '../src/server/pool/puller.js';
import { enforcedLevel, keywordFloor, nextPresence, showsWorking, unsafeText, type PoolActor, type PoolJob, type PoolPolicy } from '../src/shared/pool.js';

const BRIDGE = 'bridge-token-for-pool-tests-0123456789abcdef';
const ADA: PoolActor = { id: 'acct-ada', label: 'Ada' };
const PIPER: PoolActor = { id: 'id-piper', label: 'piper' };
const OKKIN_ACTOR: PoolActor = { id: 'id-okkin', label: 'okkin' };
const RILEY: PoolActor = { id: 'id-riley', label: 'Riley' };
const CASEY: PoolActor = { id: 'acct-casey', label: 'Casey' };

function writePolicy(dir: string, extra: Partial<PoolPolicy> = {}) {
  const policy: PoolPolicy = {
    approvers: [CASEY.id],
    lowLevelPosters: [ADA.id],
    highLevelPosters: [ADA.id],
    crew: [PIPER.id, ADA.id, RILEY.id],
    dan: [RILEY.id],
    okkin: [OKKIN_ACTOR.id],
    reservedNames: [],
    ...extra,
  };
  writeFileSync(path.join(dir, 'work-pool-policy.json'), JSON.stringify(policy) + '\n', { mode: 0o600 });
}

function dirOf(t: { after(fn: () => void): void }) {
  const dir = mkdtempSync(path.join(tmpdir(), 'ao-pool-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(path.join(dir, 'bridge-token'), BRIDGE);
  writePolicy(dir);
  return dir;
}

function saw(job: PoolJob) {
  return { state: job.status, updatedAt: job.updatedAt, hash: job.contentHash ?? '' };
}

function clock() {
  let now = 1_700_000_000_000;
  return { now: () => now, advance(ms: number) { now += ms; } };
}

function poolAt(dir: string, time = clock(), presence?: (name: string, desired: 'working' | 'idle') => void) {
  return new WorkPool(dir, presence ? { presence } : {}, { now: time.now });
}

function must<T>(result: { ok: true; value: T } | { ok: false; status: number; error: string }): T {
  assert.equal(result.ok, true, result.ok ? '' : `${result.status} ${result.error}`);
  return (result as { ok: true; value: T }).value;
}

function post(pool: WorkPool, title: string, body: string, extra: { level?: number; targetBot?: string } = {}) {
  return must(pool.post({ title, body, ...extra }, ADA));
}

interface Captured {
  status: number;
  raw: string;
  json: () => { error?: string; ok?: boolean; job?: PoolJob; name?: string; token?: string };
}

function capture(): { res: ServerResponse; got: Captured } {
  const got: Captured = { status: 0, raw: '', json: () => JSON.parse(got.raw || '{}') };
  const res = {
    headersSent: false,
    writeHead(status: number) {
      got.status = status;
      this.headersSent = true;
    },
    end(body?: unknown) {
      got.raw = String(body ?? '');
    },
  };
  return { res: res as ServerResponse, got };
}

function getReq(url: string, headers: Record<string, string> = {}): IncomingMessage {
  const req = new EventEmitter() as IncomingMessage;
  req.method = 'GET';
  req.url = url;
  req.headers = { host: '127.0.0.1:4600', ...headers };
  return req;
}

function jsonReq(url: string, body: unknown, headers: Record<string, string> = {}): IncomingMessage {
  const req = new EventEmitter() as IncomingMessage;
  req.method = 'POST';
  req.url = url;
  req.headers = { host: '127.0.0.1:4600', 'content-type': 'application/json', ...headers };
  const payload = Buffer.from(JSON.stringify(body));
  const on = req.on.bind(req);
  req.on = ((event: string, fn: (...args: unknown[]) => void) => {
    const out = on(event, fn);
    if (event === 'end') queueMicrotask(() => { req.emit('data', payload); req.emit('end'); });
    return out;
  }) as IncomingMessage['on'];
  return req;
}

function office(dir: string, pool: WorkPool, session?: { id?: string; name?: string; role?: 'admin' | 'member' }) {
  return {
    cfg: { dataDir: dir, port: 4600 },
    auth: {
      fromRequest: () => (session ? { account: session.id ? { id: session.id, name: session.name ?? session.id, role: session.role ?? 'member' } : undefined } : undefined),
      fromAnyCookie: () => !!session,
    },
    floors: new Map([['floor', { pool }]]),
    services: { lookup: () => undefined },
  } as never;
}

test('a stalled claim returns to open and can be claimed again', (t) => {
  const time = clock();
  const pool = poolAt(dirOf(t), time);
  const job = post(pool, 'Tidy the notes', 'Summarise yesterday.');
  const held = must(pool.claim(job.id, PIPER, 1_000));
  assert.equal(held.status, 'claimed');
  assert.equal(held.history.length, 1);
  time.advance(1_000);
  const open = pool.get(job.id)!;
  assert.equal(open.status, 'open');
  assert.equal(open.claim, undefined);
  assert.equal(open.history[0].reason, 'expired');
  const again = must(pool.claim(job.id, ADA, 1_000));
  assert.equal(again.claim?.by, ADA.id);
  assert.equal(again.history.length, 2);
});

test('Okkin is refused on level 4 and above, and other crew stop at 5 unless they are the named target', (t) => {
  const pool = poolAt(dirOf(t));
  const sergeant = post(pool, 'Draft the docs', 'A small wording fix.', { level: 4 });
  assert.equal(pool.claim(sergeant.id, OKKIN_ACTOR).ok, false);
  assert.equal((pool.claim(sergeant.id, OKKIN_ACTOR) as { error: string }).error, 'Okkin can claim levels 1–3 only');
  assert.equal(must(pool.claim(sergeant.id, PIPER)).claim?.by, PIPER.id);
  must(pool.release(sergeant.id, PIPER));

  const captain = post(pool, 'Check the gate', 'Review the session check.', { level: 6, targetBot: PIPER.id });
  assert.match((pool.claim(captain.id, ADA) as { error: string }).error, /named bot/);
  assert.match((pool.claim(captain.id, OKKIN_ACTOR) as { error: string }).error, /Okkin/);
  const named = post(pool, 'Check the gate again', 'Still a review.', { level: 6, targetBot: OKKIN_ACTOR.id });
  assert.match((pool.claim(named.id, OKKIN_ACTOR) as { error: string }).error, /Okkin/);
  assert.equal(must(pool.claim(captain.id, PIPER)).level, 6);

  const prestige = post(pool, 'Hold the merge', 'Wait for a person.', { level: 7, targetBot: ADA.id });
  assert.equal(pool.claim(prestige.id, PIPER).ok, false);
  assert.equal(must(pool.claim(prestige.id, ADA)).claim?.by, ADA.id);
});

test('gated words raise the level and a poster cannot lower it', () => {
  assert.equal(keywordFloor('please merge the branch'), 7);
  assert.equal(keywordFloor('send the note'), 7);
  assert.equal(keywordFloor('spend the budget'), 7);
  assert.equal(keywordFloor('delete the draft'), 7);
  assert.equal(keywordFloor('pay the invoice'), 7);
  assert.equal(keywordFloor('a secret rotation'), 6);
  assert.equal(keywordFloor('security review'), 6);
  assert.equal(keywordFloor('the network map'), 6);
  assert.equal(keywordFloor('Major Files index'), 6);
  assert.equal(enforcedLevel(1, 'merge it'), 7);
  assert.equal(enforcedLevel(2, 'security notes'), 6);
  assert.equal(enforcedLevel(7, 'pay the bill'), 7);
  assert.equal(enforcedLevel(3, 'tidy the shelf'), 3);
});

test('posting stores the raised level', (t) => {
  const pool = poolAt(dirOf(t));
  assert.equal(post(pool, 'Ship', 'merge the branch', { level: 1 }).level, 7);
  assert.equal(post(pool, 'Review', 'security of the gate', { level: 2 }).level, 6);
  assert.equal(post(pool, 'Notes', 'a summary', { level: 4 }).level, 4);
});

test('completing 1–5 is done, 6 waits on a Dan pass, and 7 needs owner', (t) => {
  const pool = poolAt(dirOf(t));
  const low = post(pool, 'Summarise', 'A short note.', { level: 3 });
  must(pool.claim(low.id, OKKIN_ACTOR));
  const done = must(pool.complete(low.id, OKKIN_ACTOR));
  assert.equal(done.status, 'done');
  assert.equal(done.doneBy, OKKIN_ACTOR.id);
  assert.equal(pool.board().credits.find((c) => c.bot === 'okkin')?.done, 1);

  const six = post(pool, 'Gate', 'Look at the check.', { level: 6, targetBot: PIPER.id });
  must(pool.claim(six.id, PIPER));
  const waiting = must(pool.complete(six.id, PIPER));
  assert.equal(waiting.status, 'needs_approval');
  assert.equal(waiting.approval, 'dan-pass');
  assert.equal(waiting.doneBy, PIPER.id);
  assert.equal(pool.board().credits.find((c) => c.bot === 'piper'), undefined);

  const seven = post(pool, 'Hold', 'Wait for a person.', { level: 7, targetBot: ADA.id });
  must(pool.claim(seven.id, ADA));
  const held = must(pool.complete(seven.id, ADA));
  assert.equal(held.status, 'needs_approval');
  assert.equal(held.approval, 'owner-yes');
  assert.notEqual(held.status, 'done');
});

test('WORKING is only a live claim with a heartbeat, and needs_input stays put', (t) => {
  const time = clock();
  const seen: [string, string][] = [];
  const pool = poolAt(dirOf(t), time, (name, desired) => seen.push([name, desired]));
  const job = post(pool, 'Tidy', 'Notes only.', { level: 1 });
  must(pool.claim(job.id, PIPER, 5_000));
  assert.equal(showsWorking(pool.get(job.id)!, time.now()), false);
  assert.deepEqual(seen.at(-1), ['piper', 'idle']);
  must(pool.heartbeat(job.id, PIPER));
  assert.equal(showsWorking(pool.get(job.id)!, time.now()), true);
  assert.equal(pool.board().columns.claimed[0].status, 'working');
  assert.deepEqual(seen.at(-1), ['piper', 'working']);
  time.advance(LEASE);
  assert.equal(pool.get(job.id)!.status, 'open');
  assert.deepEqual(seen.at(-1), ['piper', 'idle']);
  assert.equal(nextPresence('needs_input', 'working'), 'needs_input');
  assert.equal(nextPresence('idle', 'working'), 'working');
});

const LEASE = 15 * 60 * 1000;

test('a second claim is refused, and pull skips work the bot must not take', (t) => {
  const pool = poolAt(dirOf(t));
  const first = post(pool, 'One', 'Notes.', { level: 1 });
  const second = post(pool, 'Two', 'More notes.', { level: 1 });
  must(pool.claim(first.id, PIPER));
  assert.equal((pool.claim(second.id, PIPER) as { error: string }).error, 'finish or release the job you already hold');
  assert.equal((pool.pull(PIPER) as { error: string }).error, 'already claimed');
  must(pool.heartbeat(first.id, PIPER));
  assert.equal((pool.pull(PIPER) as { error: string }).error, 'already working');
  must(pool.release(first.id, PIPER));
  const high = post(pool, 'Later', 'A draft fix.', { level: 4 });
  const taken = must(pool.pull(OKKIN_ACTOR));
  assert.notEqual(taken.id, high.id);
  assert.ok(taken.level <= 3);
});

test('Dan pass is only Dan, and it does not mark the job done', (t) => {
  const pool = poolAt(dirOf(t));
  const job = post(pool, 'Gate', 'Session check.', { level: 6, targetBot: PIPER.id });
  must(pool.claim(job.id, PIPER));
  const waiting = must(pool.complete(job.id, PIPER));
  const seen = saw(waiting);
  assert.equal((pool.danPass(job.id, PIPER, seen) as { status: number }).status, 403);
  const passed = must(pool.danPass(job.id, RILEY, seen));
  assert.equal(passed.status, 'needs_approval');
  assert.equal(passed.approval, 'owner-yes');
  assert.equal(passed.danPass?.by, RILEY.id);
  assert.equal(pool.board().columns.done.length, 0);
  assert.equal((pool.ownerApproval(job.id, CASEY, seen) as { status: number }).status, 409);
  const fresh = saw(passed);
  assert.equal((pool.ownerApproval(job.id, CASEY, { state: 'open', updatedAt: passed.updatedAt, hash: passed.contentHash ?? '' }) as { error: string }).error, 'stale');
  const approved = must(pool.ownerApproval(job.id, CASEY, fresh));
  assert.equal(approved.status, 'done');
  assert.equal(approved.approvedBy, CASEY.id);
  assert.equal(approved.doneBy, PIPER.id);
});

test('level 6 cannot be approved before a Dan pass, and level 7 can', (t) => {
  const pool = poolAt(dirOf(t));
  const six = post(pool, 'Gate', 'Money check.', { level: 6, targetBot: PIPER.id });
  must(pool.claim(six.id, PIPER));
  const waiting = must(pool.complete(six.id, PIPER));
  const seen = saw(waiting);
  assert.equal((pool.ownerApproval(six.id, CASEY, seen) as { error: string }).error, 'Dan pass is required');
  assert.equal(pool.get(six.id)!.status, 'needs_approval');

  const seven = post(pool, 'Hold', 'Wait.', { level: 7, targetBot: ADA.id });
  must(pool.claim(seven.id, ADA));
  const held = must(pool.complete(seven.id, ADA));
  const yes = must(pool.ownerApproval(seven.id, CASEY, saw(held)));
  assert.equal(yes.status, 'done');
  assert.equal(yes.approvedBy, CASEY.id);
  assert.equal(pool.danPass(seven.id, RILEY, saw(yes)).ok, false);
});

test('files are mode 0600 and a caller token is stored only as a hash', (t) => {
  const dir = dirOf(t);
  const pool = poolAt(dir, clock());
  post(pool, 'Notes', 'A summary.');
  const made = pool.registerCaller('piper');
  assert.ok('token' in made);
  const callers = readFileSync(path.join(dir, 'work-pool-callers.json'), 'utf8');
  assert.equal(callers.includes((made as { token: string }).token), false);
  assert.match(callers, /tokenHash/);
  for (const name of ['work-pool.json', 'work-pool-callers.json']) {
    assert.equal(statSync(path.join(dir, name)).mode & 0o777, 0o600);
  }
  const again = new WorkPool(dir, {}, { now: () => 1_700_000_000_000 });
  assert.equal(again.board().columns.open.length, 1);
});

test('private-looking text is refused', (t) => {
  const pool = poolAt(dirOf(t));
  assert.equal(unsafeText('a tidy summary'), false);
  assert.equal(unsafeText(['sk', 'not-a-real-key'].join('-')), true);
  assert.equal(pool.post({ title: 'Nope', body: ['sk', 'not-a-real-key'].join('-') }, ADA).ok, false);
});

test('the Okkin puller hands a claim to the injected runner and does not start a run', (t) => {
  const handed: string[] = [];
  const puller = createOkkinPuller({
    idle: () => true,
    take(job) { handed.push(job.id); },
  }, OKKIN_ACTOR);
  puller.take({ id: 'abc', title: 'Notes', level: 1 });
  assert.deepEqual(handed, ['abc']);
  const quiet = createOkkinPuller();
  assert.equal(quiet.idle(), true);
  assert.doesNotThrow(() => quiet.take({ id: 'abc', title: 'Notes', level: 1 }));
  const time = clock();
  let tick: (() => void) | undefined;
  const original = global.setInterval;
  global.setInterval = ((fn: () => void) => {
    tick = fn;
    return 0 as unknown as ReturnType<typeof setInterval>;
  }) as typeof setInterval;
  t.after(() => { global.setInterval = original; });
  const pool = new WorkPool(dirOf(t), {}, { now: time.now, autoPull: true, puller });
  t.after(() => pool.stop());
  post(pool, 'Notes', 'A summary.', { level: 1 });
  post(pool, 'Draft', 'A small fix.', { level: 4 });
  assert.equal(typeof tick, 'function');
  tick!();
  const held = pool.board().columns.claimed.find((c) => c.claimer === 'okkin');
  assert.ok(held);
  assert.ok(held.level <= 3);
  assert.equal(held.status, 'claimed');
  assert.notEqual(held.status, 'working');
  assert.deepEqual(handed, ['abc', held.id]);
});

test('a bridge token cannot record owner approval, and a body approver is ignored', async (t) => {
  const dir = dirOf(t);
  const pool = poolAt(dir);
  const job = post(pool, 'Hold', 'Wait for a person.', { level: 7, targetBot: ADA.id });
  must(pool.claim(job.id, ADA));
  const waiting = must(pool.complete(job.id, ADA));
  const body = { id: job.id, state: waiting.status, updatedAt: waiting.updatedAt, hash: waiting.contentHash, approver: 'pat', by: 'pat' };
  const handler = requestHandler(office(dir, pool), [poolRoutes.ownerApproval]);

  const locked = capture();
  await handler(jsonReq('/api/pool/owner-yes', body, { 'x-bridge-token': BRIDGE }), locked.res);
  assert.equal(locked.got.status, 401);
  assert.equal(locked.got.json().error, 'Not logged in');

  const bearer = capture();
  await handler(jsonReq('/api/pool/owner-yes', body, { authorization: `Bearer ${BRIDGE}` }), bearer.res);
  assert.equal(bearer.got.status, 401);

  const stranger = requestHandler(office(dir, pool, { id: 'acct-stranger', name: 'Pat' }), [poolRoutes.ownerApproval]);
  const denied = capture();
  await stranger(jsonReq('/api/pool/owner-yes', body), denied.res);
  assert.equal(denied.got.status, 403);
  assert.equal(denied.got.json().error, 'not an approver');

  const signed = requestHandler(office(dir, pool, { id: CASEY.id, name: 'Casey' }), [poolRoutes.ownerApproval]);
  const mixed = capture();
  await signed(jsonReq('/api/pool/owner-yes', body, { 'x-bridge-token': BRIDGE }), mixed.res);
  assert.equal(mixed.got.status, 403);
  assert.equal(mixed.got.json().error, 'human session only');

  const headed = capture();
  await signed(jsonReq('/api/pool/owner-yes', body, { authorization: 'Bearer office-session-not-a-person' }), headed.res);
  assert.equal(headed.got.status, 403);

  const evil = capture();
  await signed(jsonReq('/api/pool/owner-yes', body, { origin: 'http://evil.example' }), evil.res);
  assert.equal(evil.got.status, 403);

  const stale = capture();
  await signed(jsonReq('/api/pool/owner-yes', { ...body, updatedAt: waiting.updatedAt - 1 }), stale.res);
  assert.equal(stale.got.status, 409);
  assert.equal(stale.got.json().error, 'stale');
  assert.equal(pool.get(job.id)!.status, 'needs_approval');

  const wrongState = capture();
  await signed(jsonReq('/api/pool/owner-yes', { ...body, state: 'done' }), wrongState.res);
  assert.equal(wrongState.got.status, 409);

  const yes = capture();
  await signed(jsonReq('/api/pool/owner-yes', body), yes.res);
  assert.equal(yes.got.status, 200);
  assert.equal(yes.got.json().job?.approvedBy, CASEY.id);
  assert.notEqual(yes.got.json().job?.approvedBy, 'pat');
  assert.notEqual(yes.got.json().job?.approvedBy, 'office');
  assert.equal(pool.get(job.id)!.status, 'done');

  const shared = requestHandler(office(dir, pool, {}), [poolRoutes.ownerApproval]);
  const other = post(pool, 'Hold two', 'Still waiting.', { level: 7, targetBot: ADA.id });
  must(pool.claim(other.id, ADA));
  const second = must(pool.complete(other.id, ADA));
  const officeYes = capture();
  await shared(jsonReq('/api/pool/owner-yes', { id: other.id, state: second.status, updatedAt: second.updatedAt, hash: second.contentHash, approver: 'pat' }), officeYes.res);
  assert.equal(officeYes.got.status, 403);
  assert.equal(officeYes.got.json().error, 'account required');
});

test('claimer and Dan come from the authenticated caller, never the body', async (t) => {
  const dir = dirOf(t);
  const pool = poolAt(dir);
  const piper = pool.registerCaller('piper');
  const reserved = pool.registerCaller('dan');
  const riley = pool.registerCaller('riley');
  assert.equal('error' in reserved, true);
  assert.ok('token' in piper && 'token' in riley);
  writePolicy(dir, {
    approvers: [CASEY.id],
    lowLevelPosters: [ADA.id],
    highLevelPosters: [ADA.id],
    crew: [(piper as { id: string }).id, ADA.id],
    dan: [(riley as { id: string }).id],
    okkin: [OKKIN_ACTOR.id],
  });
  const job = post(pool, 'Gate', 'A review.', { level: 6, targetBot: (piper as { id: string }).id });
  const handler = requestHandler(office(dir, pool, { id: ADA.id, name: 'Ada' }), [poolRoutes.claim, poolRoutes.danPass, poolRoutes.complete]);
  const open = requestHandler(office(dir, pool), [poolRoutes.claim]);
  const headers = { 'x-bridge-token': BRIDGE, 'x-pool-caller': (piper as { token: string }).token };

  const claimed = capture();
  await handler(jsonReq('/api/bridge/pool/claim', { id: job.id, by: 'pat', claimer: 'ada' }, headers), claimed.res);
  assert.equal(claimed.got.status, 200);
  assert.equal(claimed.got.json().job?.claim?.by, (piper as { id: string }).id);

  const stranger = capture();
  await handler(jsonReq('/api/bridge/pool/claim', { id: job.id, by: 'Ada' }, { 'x-bridge-token': BRIDGE, 'x-pool-caller': 'not-a-token' }), stranger.res);
  assert.equal(stranger.got.status, 401);
  assert.equal(stranger.got.json().error, 'unknown caller');

  const anon = capture();
  await open(jsonReq('/api/bridge/pool/claim', { id: 'x', by: 'ada' }, {}), anon.res);
  assert.equal(anon.got.status, 401);

  const foreign = capture();
  await handler(jsonReq('/api/bridge/pool/claim', { id: job.id }, { 'x-bridge-token': BRIDGE, origin: 'https://evil.example' }), foreign.res);
  assert.equal(foreign.got.status, 403);

  const done = capture();
  await handler(jsonReq('/api/bridge/pool/complete', { id: job.id, by: 'pat' }, headers), done.res);
  assert.equal(done.got.status, 200);
  assert.equal(done.got.json().job?.status, 'needs_approval');
  const seen = done.got.json().job!;

  const impostor = capture();
  await handler(jsonReq('/api/bridge/pool/dan-pass', { id: job.id, state: seen.status, updatedAt: seen.updatedAt, hash: seen.contentHash, by: 'dan', approver: 'dan' }, headers), impostor.res);
  assert.equal(impostor.got.status, 403);

  const pass = capture();
  await handler(
    jsonReq('/api/bridge/pool/dan-pass', { id: job.id, state: seen.status, updatedAt: seen.updatedAt, hash: seen.contentHash, by: 'piper' }, { 'x-bridge-token': BRIDGE, 'x-pool-caller': (riley as { token: string }).token }),
    pass.res,
  );
  assert.equal(pass.got.status, 200);
  assert.equal(pass.got.json().job?.danPass?.by, (riley as { id: string }).id);
  assert.equal(pass.got.json().job?.status, 'needs_approval');
});

test('a session can read a job body and a token cannot', async (t) => {
  const dir = dirOf(t);
  const pool = poolAt(dir);
  const body = `Read this in full. ${'x'.repeat(120)}`;
  const job = post(pool, 'Long note', body, { level: 4 });
  assert.equal(pool.board().columns.open[0].body?.length, 80);
  const signed = requestHandler(office(dir, pool, { id: CASEY.id, name: 'Casey' }), [poolRoutes.job]);
  const open = requestHandler(office(dir, pool), [poolRoutes.job]);

  const full = capture();
  await signed(getReq(`/api/pool/jobs/${job.id}`), full.res);
  assert.equal(full.got.status, 200);
  const view = full.got.json() as { body?: string; hash?: string };
  assert.equal(view.body, body);
  assert.equal(view.hash, job.contentHash);

  const headed = capture();
  await signed(getReq(`/api/pool/jobs/${job.id}`, { authorization: `Bearer ${BRIDGE}` }), headed.res);
  assert.equal(headed.got.status, 403);
  assert.equal(headed.got.json().error, 'human session only');

  const bearer = capture();
  await open(getReq(`/api/pool/jobs/${job.id}`, { authorization: `Bearer ${BRIDGE}` }), bearer.res);
  assert.equal(bearer.got.status, 403);

  const token = capture();
  await open(getReq(`/api/pool/jobs/${job.id}`, { 'x-bridge-token': BRIDGE }), token.res);
  assert.equal(token.got.status, 403);
  assert.equal(token.got.json().error, 'human session only');

  const anon = capture();
  await open(getReq(`/api/pool/jobs/${job.id}`), anon.res);
  assert.equal(anon.got.status, 401);
});

test('owner approval and a Dan pass are refused when no policy file is present', async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ao-pool-nopolicy-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(path.join(dir, 'bridge-token'), BRIDGE);
  assert.equal(existsSync(path.join(dir, 'work-pool-policy.json')), false);
  const pool = poolAt(dir);
  const job = must(pool.post({ title: 'Shelf', body: 'Tidy the shelf.', level: 4 }, ADA));
  const seen = saw(job);
  assert.equal(existsSync(path.join(dir, 'work-pool-policy.json')), false);

  const owner = requestHandler(office(dir, pool, { id: CASEY.id, name: 'Casey' }), [poolRoutes.ownerApproval]);
  const yes = capture();
  await owner(jsonReq('/api/pool/owner-yes', { id: job.id, ...seen }), yes.res);
  assert.equal(yes.got.status, 403);
  assert.equal(yes.got.json().error, 'not an approver');

  const dan = requestHandler(office(dir, pool, { id: RILEY.id, name: 'Riley' }), [poolRoutes.danPass]);
  const pass = capture();
  await dan(jsonReq('/api/bridge/pool/dan-pass', { id: job.id, ...seen }), pass.res);
  assert.equal(pass.got.status, 403);
  assert.equal(pass.got.json().error, 'only Dan can record a Dan pass');
  assert.equal(existsSync(path.join(dir, 'work-pool-policy.json')), false);
});

test('a pool error is a fixed message', async (t) => {
  const dir = dirOf(t);
  const pool = poolAt(dir);
  const marker = 'SECRET_LEAK_MARKER';
  pool.ownerApproval = () => { throw new Error(marker); };
  const handler = requestHandler(office(dir, pool, { id: CASEY.id, name: 'Casey' }), [poolRoutes.ownerApproval]);
  const got = capture();
  await handler(jsonReq('/api/pool/owner-yes', { id: 'missing', state: 'needs_approval', updatedAt: 1, hash: 'ab'.repeat(32) }), got.res);
  assert.equal(got.got.status, 500);
  assert.equal(got.got.json().error, 'Internal error');
  assert.equal(got.got.raw.includes(marker), false);

  pool.complete = () => { throw new Error(marker); };
  const bridge = requestHandler(office(dir, pool, { id: ADA.id, name: 'Ada' }), [poolRoutes.complete]);
  const blown = capture();
  await bridge(jsonReq('/api/bridge/pool/complete', { id: 'missing' }, { 'x-bridge-token': BRIDGE }), blown.res);
  assert.equal(blown.got.status, 500);
  assert.equal(blown.got.raw.includes(marker), false);
});
