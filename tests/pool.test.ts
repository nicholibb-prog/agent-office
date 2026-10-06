// Community work pool: leases, levels, approval, and who is allowed to record it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { requestHandler } from '../src/server/http/router.js';
import { poolRoutes } from '../src/server/http/routes/pool.js';
import { WorkPool } from '../src/server/pool/pool.js';
import { createOkkinPuller } from '../src/server/pool/puller.js';
import { enforcedLevel, keywordFloor, nextPresence, showsWorking, unsafeText, type PoolJob } from '../src/shared/pool.js';

const BRIDGE = 'bridge-token-for-pool-tests-0123456789abcdef';

function dirOf(t: { after(fn: () => void): void }) {
  const dir = mkdtempSync(path.join(tmpdir(), 'ao-pool-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(path.join(dir, 'bridge-token'), BRIDGE);
  return dir;
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
  return must(pool.post({ title, body, ...extra }, 'ada'));
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

function office(dir: string, pool: WorkPool, session?: { name?: string; role?: 'admin' | 'member' }) {
  return {
    cfg: { dataDir: dir, port: 4600 },
    auth: {
      fromRequest: () => (session ? { account: session.name ? { name: session.name, role: session.role ?? 'member' } : undefined } : undefined),
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
  const held = must(pool.claim(job.id, 'piper', 1_000));
  assert.equal(held.status, 'claimed');
  assert.equal(held.history.length, 1);
  time.advance(1_000);
  const open = pool.get(job.id)!;
  assert.equal(open.status, 'open');
  assert.equal(open.claim, undefined);
  assert.equal(open.history[0].reason, 'expired');
  const again = must(pool.claim(job.id, 'ada', 1_000));
  assert.equal(again.claim?.by, 'ada');
  assert.equal(again.history.length, 2);
});

test('Okkin is refused on level 4 and above, and other crew stop at 5 unless they are the named target', (t) => {
  const pool = poolAt(dirOf(t));
  const sergeant = post(pool, 'Draft the docs', 'A small wording fix.', { level: 4 });
  assert.equal(pool.claim(sergeant.id, 'okkin').ok, false);
  assert.equal((pool.claim(sergeant.id, 'okkin') as { error: string }).error, 'Okkin can claim levels 1–3 only');
  assert.equal(must(pool.claim(sergeant.id, 'piper')).claim?.by, 'piper');
  must(pool.release(sergeant.id, 'piper'));

  const captain = post(pool, 'Check the gate', 'Review the session check.', { level: 6, targetBot: 'piper' });
  assert.match((pool.claim(captain.id, 'ada') as { error: string }).error, /named bot/);
  assert.match((pool.claim(captain.id, 'okkin') as { error: string }).error, /Okkin/);
  const named = post(pool, 'Check the gate again', 'Still a review.', { level: 6, targetBot: 'okkin' });
  assert.match((pool.claim(named.id, 'okkin') as { error: string }).error, /Okkin/);
  assert.equal(must(pool.claim(captain.id, 'piper')).level, 6);

  const prestige = post(pool, 'Hold the merge', 'Wait for a person.', { level: 7, targetBot: 'ada' });
  assert.equal(pool.claim(prestige.id, 'piper').ok, false);
  assert.equal(must(pool.claim(prestige.id, 'ada')).claim?.by, 'ada');
});

test('gated words raise the level and a poster cannot lower it', () => {
  assert.equal(keywordFloor('please merge the branch'), 7);
  assert.equal(keywordFloor('send the note'), 7);
  assert.equal(keywordFloor('spend the budget'), 7);
  assert.equal(keywordFloor('delete the draft'), 7);
  assert.equal(keywordFloor('pay the invoice'), 6);
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

test('completing 1–5 is done, 6 waits on a Dan pass, and 7 waits on a Nick yes', (t) => {
  const pool = poolAt(dirOf(t));
  const low = post(pool, 'Summarise', 'A short note.', { level: 3 });
  must(pool.claim(low.id, 'okkin'));
  const done = must(pool.complete(low.id, 'okkin'));
  assert.equal(done.status, 'done');
  assert.equal(done.doneBy, 'okkin');
  assert.equal(pool.board().credits.find((c) => c.bot === 'okkin')?.done, 1);

  const six = post(pool, 'Gate', 'Look at the check.', { level: 6, targetBot: 'piper' });
  must(pool.claim(six.id, 'piper'));
  const waiting = must(pool.complete(six.id, 'piper'));
  assert.equal(waiting.status, 'needs_approval');
  assert.equal(waiting.approval, 'dan-pass');
  assert.equal(waiting.doneBy, 'piper');
  assert.equal(pool.board().credits.find((c) => c.bot === 'piper'), undefined);

  const seven = post(pool, 'Hold', 'Wait for a person.', { level: 7, targetBot: 'ada' });
  must(pool.claim(seven.id, 'ada'));
  const nick = must(pool.complete(seven.id, 'ada'));
  assert.equal(nick.status, 'needs_approval');
  assert.equal(nick.approval, 'nick-yes');
  assert.notEqual(nick.status, 'done');
});

test('WORKING is only a live claim with a heartbeat, and needs_input stays put', (t) => {
  const time = clock();
  const seen: [string, string][] = [];
  const pool = poolAt(dirOf(t), time, (name, desired) => seen.push([name, desired]));
  const job = post(pool, 'Tidy', 'Notes only.', { level: 1 });
  must(pool.claim(job.id, 'piper', 5_000));
  assert.equal(showsWorking(pool.get(job.id)!, time.now()), false);
  assert.deepEqual(seen.at(-1), ['piper', 'idle']);
  must(pool.heartbeat(job.id, 'piper'));
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
  must(pool.claim(first.id, 'piper'));
  assert.equal((pool.claim(second.id, 'piper') as { error: string }).error, 'finish or release the job you already hold');
  assert.equal((pool.pull('piper') as { error: string }).error, 'already claimed');
  must(pool.heartbeat(first.id, 'piper'));
  assert.equal((pool.pull('piper') as { error: string }).error, 'already working');
  must(pool.release(first.id, 'piper'));
  const high = post(pool, 'Later', 'A draft fix.', { level: 4 });
  const taken = must(pool.pull('okkin'));
  assert.notEqual(taken.id, high.id);
  assert.ok(taken.level <= 3);
});

test('Dan pass is only Dan, and it does not mark the job done', (t) => {
  const pool = poolAt(dirOf(t));
  const job = post(pool, 'Gate', 'Session check.', { level: 6, targetBot: 'piper' });
  must(pool.claim(job.id, 'piper'));
  const waiting = must(pool.complete(job.id, 'piper'));
  const seen = { state: waiting.status, updatedAt: waiting.updatedAt };
  assert.equal((pool.danPass(job.id, 'piper', seen) as { status: number }).status, 403);
  const passed = must(pool.danPass(job.id, 'Dan', seen));
  assert.equal(passed.status, 'needs_approval');
  assert.equal(passed.approval, 'nick-yes');
  assert.equal(passed.danPass?.by, 'Dan');
  assert.equal(pool.board().columns.done.length, 0);
  assert.equal((pool.nickYes(job.id, 'Ada', seen) as { status: number }).status, 409);
  const fresh = { state: passed.status, updatedAt: passed.updatedAt };
  assert.equal((pool.nickYes(job.id, 'Ada', { state: 'open', updatedAt: passed.updatedAt }) as { error: string }).error, 'stale');
  const approved = must(pool.nickYes(job.id, 'Ada', fresh));
  assert.equal(approved.status, 'done');
  assert.equal(approved.approvedBy, 'Ada');
  assert.equal(approved.doneBy, 'piper');
});

test('level 6 cannot be approved before a Dan pass, and level 7 can', (t) => {
  const pool = poolAt(dirOf(t));
  const six = post(pool, 'Gate', 'Money check.', { level: 6, targetBot: 'piper' });
  must(pool.claim(six.id, 'piper'));
  const waiting = must(pool.complete(six.id, 'piper'));
  const seen = { state: waiting.status, updatedAt: waiting.updatedAt };
  assert.equal((pool.nickYes(six.id, 'Ada', seen) as { error: string }).error, 'Dan pass is required');
  assert.equal(pool.get(six.id)!.status, 'needs_approval');

  const seven = post(pool, 'Hold', 'Wait.', { level: 7, targetBot: 'ada' });
  must(pool.claim(seven.id, 'ada'));
  const nick = must(pool.complete(seven.id, 'ada'));
  const yes = must(pool.nickYes(seven.id, 'Ada', { state: nick.status, updatedAt: nick.updatedAt }));
  assert.equal(yes.status, 'done');
  assert.equal(yes.approvedBy, 'Ada');
  assert.equal(pool.danPass(seven.id, 'dan', { state: yes.status, updatedAt: yes.updatedAt }).ok, false);
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
  assert.equal(pool.post({ title: 'Nope', body: ['sk', 'not-a-real-key'].join('-') }, 'ada').ok, false);
});

test('the Okkin puller hands a claim to the injected runner and does not start a run', (t) => {
  const handed: string[] = [];
  const puller = createOkkinPuller({
    idle: () => true,
    take(job) { handed.push(job.id); },
  });
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

test('a bridge token cannot record a Nick yes, and a body approver is ignored', async (t) => {
  const dir = dirOf(t);
  const pool = poolAt(dir);
  const job = post(pool, 'Hold', 'Wait for a person.', { level: 7, targetBot: 'ada' });
  must(pool.claim(job.id, 'ada'));
  const waiting = must(pool.complete(job.id, 'ada'));
  const body = { id: job.id, state: waiting.status, updatedAt: waiting.updatedAt, approver: 'nick', by: 'nick' };
  const handler = requestHandler(office(dir, pool), [poolRoutes.nickYes]);

  const locked = capture();
  await handler(jsonReq('/api/pool/nick-yes', body, { 'x-bridge-token': BRIDGE }), locked.res);
  assert.equal(locked.got.status, 401);
  assert.equal(locked.got.json().error, 'Not logged in');

  const bearer = capture();
  await handler(jsonReq('/api/pool/nick-yes', body, { authorization: `Bearer ${BRIDGE}` }), bearer.res);
  assert.equal(bearer.got.status, 401);

  const signed = requestHandler(office(dir, pool, { name: 'Ada' }), [poolRoutes.nickYes]);
  const mixed = capture();
  await signed(jsonReq('/api/pool/nick-yes', body, { 'x-bridge-token': BRIDGE }), mixed.res);
  assert.equal(mixed.got.status, 403);
  assert.equal(mixed.got.json().error, 'human session only');

  const headed = capture();
  await signed(jsonReq('/api/pool/nick-yes', body, { authorization: 'Bearer office-session-not-a-person' }), headed.res);
  assert.equal(headed.got.status, 403);

  const evil = capture();
  await signed(jsonReq('/api/pool/nick-yes', body, { origin: 'http://evil.example' }), evil.res);
  assert.equal(evil.got.status, 403);

  const stale = capture();
  await signed(jsonReq('/api/pool/nick-yes', { ...body, updatedAt: waiting.updatedAt - 1 }), stale.res);
  assert.equal(stale.got.status, 409);
  assert.equal(stale.got.json().error, 'stale');
  assert.equal(pool.get(job.id)!.status, 'needs_approval');

  const wrongState = capture();
  await signed(jsonReq('/api/pool/nick-yes', { ...body, state: 'done' }), wrongState.res);
  assert.equal(wrongState.got.status, 409);

  const yes = capture();
  await signed(jsonReq('/api/pool/nick-yes', body), yes.res);
  assert.equal(yes.got.status, 200);
  assert.equal(yes.got.json().job?.approvedBy, 'Ada');
  assert.notEqual(yes.got.json().job?.approvedBy, 'nick');
  assert.equal(pool.get(job.id)!.status, 'done');

  const shared = requestHandler(office(dir, pool, {}), [poolRoutes.nickYes]);
  const other = post(pool, 'Hold two', 'Still waiting.', { level: 7, targetBot: 'ada' });
  must(pool.claim(other.id, 'ada'));
  const second = must(pool.complete(other.id, 'ada'));
  const officeYes = capture();
  await shared(jsonReq('/api/pool/nick-yes', { id: other.id, state: second.status, updatedAt: second.updatedAt, approver: 'nick' }), officeYes.res);
  assert.equal(officeYes.got.status, 200);
  assert.equal(officeYes.got.json().job?.approvedBy, 'office');
});

test('claimer and Dan come from the authenticated caller, never the body', async (t) => {
  const dir = dirOf(t);
  const pool = poolAt(dir);
  const piper = pool.registerCaller('piper');
  const dan = pool.registerCaller('dan');
  assert.ok('token' in piper && 'token' in dan);
  const job = post(pool, 'Gate', 'A review.', { level: 6, targetBot: 'piper' });
  const handler = requestHandler(office(dir, pool, { name: 'Ada' }), [poolRoutes.claim, poolRoutes.danPass, poolRoutes.complete]);
  const open = requestHandler(office(dir, pool), [poolRoutes.claim]);
  const headers = { 'x-bridge-token': BRIDGE, 'x-pool-caller': (piper as { token: string }).token };

  const claimed = capture();
  await handler(jsonReq('/api/bridge/pool/claim', { id: job.id, by: 'nick', claimer: 'ada' }, headers), claimed.res);
  assert.equal(claimed.got.status, 200);
  assert.equal(claimed.got.json().job?.claim?.by, 'piper');

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
  await handler(jsonReq('/api/bridge/pool/complete', { id: job.id, by: 'nick' }, headers), done.res);
  assert.equal(done.got.status, 200);
  assert.equal(done.got.json().job?.status, 'needs_approval');
  const seen = done.got.json().job!;

  const impostor = capture();
  await handler(jsonReq('/api/bridge/pool/dan-pass', { id: job.id, state: seen.status, updatedAt: seen.updatedAt, by: 'dan', approver: 'dan' }, headers), impostor.res);
  assert.equal(impostor.got.status, 403);

  const pass = capture();
  await handler(
    jsonReq('/api/bridge/pool/dan-pass', { id: job.id, state: seen.status, updatedAt: seen.updatedAt, by: 'piper' }, { 'x-bridge-token': BRIDGE, 'x-pool-caller': (dan as { token: string }).token }),
    pass.res,
  );
  assert.equal(pass.got.status, 200);
  assert.equal(pass.got.json().job?.danPass?.by, 'dan');
  assert.equal(pass.got.json().job?.status, 'needs_approval');
});

test('a pool error is a fixed message', async (t) => {
  const dir = dirOf(t);
  const pool = poolAt(dir);
  const marker = 'SECRET_LEAK_MARKER';
  pool.nickYes = () => { throw new Error(marker); };
  const handler = requestHandler(office(dir, pool, { name: 'Ada' }), [poolRoutes.nickYes]);
  const got = capture();
  await handler(jsonReq('/api/pool/nick-yes', { id: 'missing', state: 'needs_approval', updatedAt: 1 }), got.res);
  assert.equal(got.got.status, 500);
  assert.equal(got.got.json().error, 'Internal error');
  assert.equal(got.got.raw.includes(marker), false);

  pool.complete = () => { throw new Error(marker); };
  const bridge = requestHandler(office(dir, pool, { name: 'Ada' }), [poolRoutes.complete]);
  const blown = capture();
  await bridge(jsonReq('/api/bridge/pool/complete', { id: 'missing' }, { 'x-bridge-token': BRIDGE }), blown.res);
  assert.equal(blown.got.status, 500);
  assert.equal(blown.got.raw.includes(marker), false);
});
