// Okkin's controls are the owner's only, on the SERVER: power on/off, the model switch and Ask. The
// owner proves it with a separate owner passphrase (scrypt hash in an owner-only file) through
// 'Unlock owner', which sets a short-lived HttpOnly SameSite=Strict owner cookie. Nothing else is the
// owner: not the office password session, not any account, never a bot credential (even alongside an
// owner cookie). Fail closed: no hash file, nobody. Refusals are logged (capped, no secrets).
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { hqRoutes } from '../src/server/http/routes/hq.js';
import { authRoutes } from '../src/server/http/routes/auth.js';
import { issueSeatToken } from '../src/server/seat-tokens.js';
import { resetPowerForTests } from '../src/server/hq/okkin-power.js';
import { resetOkkinForTests, setOkkinFetchForTests } from '../src/server/hq/okkin.js';
import { resetHqLimitsForTests } from '../src/server/hq/limits.js';
import { OKKIN_REFUSALS_LOG, OWNER_COOKIE, OWNER_FRESH_MS, OWNER_IDLE_MS, REFUSALS_LOG_MAX, UNLOCK_TRIES, checkOwnerIntegrity, logOkkinRefusal, pinOwnerIntegrity, resetOwnerForTests, setOwnerPassphrase, startOwnerSession } from '../src/server/hq/okkin-owner.js';
import { stopsView, switchView, type LoftLike } from '../src/client/features/okkin-loft/model.js';

const BRIDGE = 'b'.repeat(64);
const POOL = 'p'.repeat(48);
const PASS = 'a long owner passphrase 42';
type Session = { account?: { id: string; role: 'admin' | 'member' } } | undefined;

function setup(opts: { owner?: boolean; policy?: 'missing' | 'empty' } = {}) {
  resetOwnerForTests();
  resetOkkinForTests();
  const dataDir = mkdtempSync(path.join(tmpdir(), 'ao-okkin-owner-'));
  writeFileSync(path.join(dataDir, 'bridge-token'), BRIDGE);
  if (opts.policy === 'empty') writeFileSync(path.join(dataDir, 'work-pool-policy.json'), JSON.stringify({ approvers: [] }), { mode: 0o600 });
  const file = path.join(mkdtempSync(path.join(tmpdir(), 'ao-owner-file-')), 'conf', 'okkin-owner.json');
  process.env.AGENT_OFFICE_OWNER_FILE = file;
  const seat = issueSeatToken(dataDir, 'kavi');
  setOkkinFetchForTests(async () => ({ ok: false, status: 503, headers: { get: () => null }, body: null, text: async () => '{}', json: async () => ({}) }) as never);
  return { dataDir, seat, file, ready: opts.owner === false ? Promise.resolve() : setOwnerPassphrase(file, PASS) };
}
const ctxOf = (dataDir: string, session: Session) => ({ cfg: { dataDir }, auth: { fromRequest: () => session, fromAnyCookie: () => !!session, sessionFromAnyCookie: () => session, clearCookie: () => 'ao=; Max-Age=0' }, meOf: () => ({ admin: false }), workers: { list: () => [] } }) as never;
async function call(route: { handle: (...a: never[]) => unknown }, ctx: never, headers: Record<string, string>, body: unknown, url = '/api/bridge/okkin/loft') {
  let status = 0;
  let out = '';
  let hdrs: Record<string, string> = {};
  const res = { writeHead(s: number, h?: Record<string, string>) { status = s; hdrs = h ?? {}; }, setHeader() {}, end(b?: unknown) { out = String(b ?? ''); } } as unknown as ServerResponse;
  const raw = body === undefined ? '' : JSON.stringify(body);
  const req = Readable.from([Buffer.from(raw)]) as unknown as IncomingMessage;
  req.method = body === undefined ? 'GET' : 'POST';
  req.headers = { host: '127.0.0.1:4600', 'content-type': 'application/json', ...headers };
  (req as { socket?: unknown }).socket = { remoteAddress: '127.0.0.1' };
  await (route.handle as (c: never, a: unknown) => unknown)(ctx, { req, res, url: new URL(`http://127.0.0.1:4600${url}`) });
  return { status, headers: hdrs, json: JSON.parse(out || '{}') as { error?: string; owner?: boolean; ownerState?: string } };
}
const office = (dataDir: string) => ctxOf(dataDir, {});
const CHANGES = [
  ['power on', hqRoutes.okkinPower, { action: 'start' }],
  ['power off', hqRoutes.okkinPower, { action: 'stop' }],
  ['model change', hqRoutes.okkinModel, { model: 'okkin:latest' }],
  ['Ask', hqRoutes.talk, { seat: 'okkin', text: 'hello' }],
] as const;
const fresh = () => { resetPowerForTests(); resetHqLimitsForTests(); };
const unlock = (dataDir: string, passphrase: string) => call(hqRoutes.okkinOwnerUnlock, office(dataDir), {}, { passphrase });
const cookieFrom = (h: Record<string, string>) => h['set-cookie']!.split(';')[0]!;

test('fail closed: no owner hash file, nobody (office session, accounts, tokens), with the pool policy missing or approvers []', async () => {
  for (const policy of ['missing', 'empty'] as const) {
    const { dataDir, seat } = setup({ owner: false, policy });
    const callers: [string, never, Record<string, string>][] = [
      ['office password session', office(dataDir), {}],
      ['an account', ctxOf(dataDir, { account: { id: 'acct-1', role: 'admin' } }), {}],
      ['a forged owner cookie', office(dataDir), { cookie: `${OWNER_COOKIE}=${startOwnerSession()}` }],
      ['seat token', office(dataDir), { 'x-bridge-token': seat }],
    ];
    for (const [who, ctx, headers] of callers) for (const [what, route, body] of CHANGES) {
      fresh();
      const r = await call(route, ctx, headers, body);
      assert.equal(r.status, 403, `${policy}: ${who}: ${what}`);
    }
    assert.equal((await unlock(dataDir, PASS)).json.error, 'owner not set up');
    const loft = await call(hqRoutes.okkinLoft, office(dataDir), {}, undefined);
    assert.equal(loft.json.ownerState, 'not-set-up');
    assert.equal(loft.json.owner, false);
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('the hash file: owner-only (0600 in a 0700 folder), a salted scrypt hash, never the passphrase', async () => {
  const { file, ready } = setup();
  await ready;
  assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.equal(statSync(path.dirname(file)).mode & 0o777, 0o700);
  const raw = readFileSync(file, 'utf8');
  assert.ok(!raw.includes(PASS));
  assert.match(raw, /"kdf":"scrypt"/);
  assert.ok(existsSync(`${file}.sha256`), 'sha256 noted in a sidecar');
  await assert.rejects(setOwnerPassphrase(file, 'short'));
});

test('wrong passphrase: 403, logged without the input, and after 5 tries a 15-minute lockout (even for the right one)', async () => {
  const { dataDir, ready } = setup();
  await ready;
  for (let i = 0; i < UNLOCK_TRIES; i++) {
    const r = await unlock(dataDir, `wrong guess number ${i}`);
    assert.equal(r.status, 403);
    assert.equal(r.json.error, 'wrong passphrase');
    assert.equal(r.headers['set-cookie'], undefined);
  }
  const locked = await unlock(dataDir, PASS);
  assert.equal(locked.status, 429);
  const log = readFileSync(path.join(dataDir, OKKIN_REFUSALS_LOG), 'utf8');
  assert.match(log, /wrong-passphrase/);
  assert.ok(!log.includes('wrong guess') && !log.includes(PASS), 'no input in the log');
});

test('right passphrase: an HttpOnly SameSite=Strict owner cookie that works for power, the model and Ask', async () => {
  const { dataDir, ready } = setup();
  await ready;
  const r = await unlock(dataDir, PASS);
  assert.equal(r.status, 200);
  const sc = r.headers['set-cookie']!;
  assert.match(sc, new RegExp(`^${OWNER_COOKIE}=`));
  assert.match(sc, /HttpOnly/);
  assert.match(sc, /SameSite=Strict/);
  assert.match(sc, /Max-Age=3600/);
  const cookie = cookieFrom(r.headers);
  for (const [what, route, body] of CHANGES) {
    fresh();
    const c = await call(route, office(dataDir), { cookie }, body);
    assert.notEqual(c.status, 403, `${what}: ${c.json.error}`);
  }
  assert.equal((await call(hqRoutes.okkinLoft, office(dataDir), { cookie }, undefined)).json.ownerState, 'unlocked');
  // The office password session without it is not the owner.
  for (const [what, route, body] of CHANGES) {
    fresh();
    assert.equal((await call(route, office(dataDir), {}, body)).status, 403, `no owner cookie: ${what}`);
  }
  // Signing out of the office ends it.
  await call(authRoutes.logout as never, office(dataDir), { cookie }, {});
  fresh();
  assert.equal((await call(hqRoutes.okkinModel, office(dataDir), { cookie }, { model: 'okkin:latest' })).status, 403);
});

test('stale owner session: power needs an unlock in the last 5 minutes; an idle one has expired entirely', async () => {
  const { dataDir, ready } = setup();
  await ready;
  const stale = `${OWNER_COOKIE}=${startOwnerSession(Date.now() - OWNER_FRESH_MS - 1000)}`;
  fresh();
  const p = await call(hqRoutes.okkinPower, office(dataDir), { cookie: stale }, { action: 'start' });
  assert.equal(p.status, 403);
  assert.equal(p.json.error, 'unlock again');
  fresh();
  assert.notEqual((await call(hqRoutes.okkinModel, office(dataDir), { cookie: stale }, { model: 'okkin:latest' })).status, 403, 'the model switch is fine inside the idle window');
  const idle = `${OWNER_COOKIE}=${startOwnerSession(Date.now() - OWNER_IDLE_MS - 1000)}`;
  fresh();
  assert.equal((await call(hqRoutes.okkinModel, office(dataDir), { cookie: idle }, { model: 'okkin:latest' })).status, 403);
});

test('every bot credential gets 403, also with a live owner cookie alongside; logged without secrets', async () => {
  const { dataDir, seat, ready } = setup();
  await ready;
  const cookie = cookieFrom((await unlock(dataDir, PASS)).headers);
  for (const withCookie of [false, true]) {
    for (const [who, h] of [['seat token', { 'x-bridge-token': seat }], ['bridge token', { 'x-bridge-token': BRIDGE }], ['Bearer', { authorization: `Bearer ${BRIDGE}` }], ['x-pool-caller', { 'x-pool-caller': POOL }]] as const) {
      for (const [what, route, body] of CHANGES) {
        fresh();
        const r = await call(route, office(dataDir), withCookie ? { ...h, cookie } : { ...h }, body);
        assert.equal(r.status, 403, `${who}${withCookie ? ' + owner cookie' : ''}: ${what}`);
      }
      assert.equal((await call(hqRoutes.okkinOwnerUnlock, office(dataDir), { ...h }, { passphrase: PASS })).status, 403, `${who} can't unlock`);
    }
  }
  const log = readFileSync(path.join(dataDir, OKKIN_REFUSALS_LOG), 'utf8');
  for (const secret of [BRIDGE, seat, POOL, PASS, cookie.split('=')[1]!]) assert.ok(!log.includes(secret));
  for (const l of log.trim().split('\n')) assert.deepEqual(Object.keys(JSON.parse(l)).sort(), ['at', 'caller', 'route']);
});

test('integrity: if the owner file changes or disappears after it was pinned, unlocks are refused and owner sessions dropped until a restart', async () => {
  for (const how of ['changed', 'missing'] as const) {
    const { dataDir, file, ready } = setup();
    await ready;
    pinOwnerIntegrity(dataDir, file, { timer: false });
    const cookie = cookieFrom((await unlock(dataDir, PASS)).headers);
    assert.equal(checkOwnerIntegrity(), true);
    if (how === 'changed') await setOwnerPassphrase(file, 'someone else wrote this one');
    else rmSync(file);
    assert.equal(checkOwnerIntegrity(), false);
    fresh();
    assert.equal((await call(hqRoutes.okkinModel, office(dataDir), { cookie }, { model: 'okkin:latest' })).status, 403, 'live session dropped');
    const r = await unlock(dataDir, PASS);
    assert.equal(r.status, 403);
    assert.equal(r.json.error, 'owner file changed; restart the office');
    assert.equal((await call(hqRoutes.okkinLoft, office(dataDir), {}, undefined)).json.ownerState, 'changed');
    assert.match(readFileSync(path.join(dataDir, OKKIN_REFUSALS_LOG), 'utf8'), how === 'changed' ? /owner-file-changed/ : /owner-file-missing/);
  }
});

test('the refusals log is capped: rotates at 256 KB to .1, two files at most, under 512 KB, 0600, no secrets', () => {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'ao-okkin-log-'));
  for (let i = 0; i < 12_000; i++) logOkkinRefusal(dataDir, { route: 'POST /api/bridge/okkin/power', caller: i % 2 ? 'bearer' : 'bridge-token' });
  const a = path.join(dataDir, OKKIN_REFUSALS_LOG);
  const b = `${a}.1`;
  assert.ok(existsSync(b), 'rotated');
  assert.ok(!existsSync(`${a}.2`), 'two files at most');
  assert.ok(statSync(a).size + statSync(b).size < 2 * REFUSALS_LOG_MAX, 'under 512 KB together');
  for (const f of [a, b]) {
    assert.equal(statSync(f).mode & 0o777, 0o600, f);
    const txt = readFileSync(f, 'utf8');
    assert.ok(!txt.includes(BRIDGE) && !txt.includes(PASS));
  }
  rmSync(dataDir, { recursive: true, force: true });
});

test('the panel: not set up says how; a locked viewer sees Owner only, grey; amber never while on', () => {
  const d: LoftLike = { power: 'on', powerControl: 'not-set-up', powerReason: null, owner: false, ownerState: 'locked', okkin: { chip: 'ready', configured: 'okkin:latest', model: 'okkin:latest' }, dial: [{ tag: 'okkin:latest', role: 'default', installed: true, ramOk: true, minFreeRamGB: null }] };
  const sw = switchView(d);
  assert.equal(sw.label, 'Owner only');
  assert.equal(sw.locked, true);
  assert.equal(sw.light, 'on');
  assert.equal(stopsView(d)[0]!.note, 'Owner only');
  assert.equal(switchView({ ...d, ownerState: 'not-set-up' }).reason, 'Owner not set up — run npm run owner:set on the ProArt');
  assert.equal(switchView({ ...d, owner: true, ownerState: 'unlocked' }).light, 'on', 'power on, switch not set up: still green');
  assert.equal(switchView({ ...d, owner: true, ownerState: 'unlocked', power: 'off' }).light, 'setup');
});

test('Unlock owner and Lock are served (registered with the office routes)', async () => {
  const { routes } = await import('../src/server/http/routes/index.js');
  const list = routes as unknown as unknown[];
  assert.ok(list.includes(hqRoutes.okkinOwnerUnlock) && list.includes(hqRoutes.okkinOwnerLock));
});

test('Ask while off is greyed, and focus uses a palette-gold ring, not the system blue', () => {
  const css = readFileSync(path.join(import.meta.dirname, '../src/client/features/okkin-loft/ui.css'), 'utf8');
  assert.match(css, /\.okl-ask\[data-off="yes"\] \.okl-input \{[^}]*#8e8e93/);
  const focus = css.slice(css.lastIndexOf('.okl-input:focus-visible'));
  assert.match(focus, /outline: 2px solid #c9a227/);
});

test('unlock rate limit: also GLOBAL (20 failures per 15 minutes across addresses, then everyone waits); the map is pruned and capped', async () => {
  const { noteUnlockFailure, unlockLocked, unlockKeys, UNLOCK_TRIES_GLOBAL, UNLOCK_KEYS_MAX, UNLOCK_WINDOW_MS } = await import('../src/server/hq/okkin-owner.js');
  resetOwnerForTests();
  const t0 = 1_000_000;
  for (let i = 0; i < UNLOCK_TRIES_GLOBAL - 1; i++) noteUnlockFailure(`10.0.0.${i}`, t0 + i);
  assert.equal(unlockLocked('10.9.9.9', t0 + 100), false, 'under the global limit, a fresh address may try');
  noteUnlockFailure('10.0.1.1', t0 + 200);
  assert.equal(unlockLocked('10.9.9.9', t0 + 300), true, 'global lockout: every address');
  assert.equal(unlockLocked('10.9.9.9', t0 + 200 + UNLOCK_WINDOW_MS + 1), false, 'over after 15 minutes');
  assert.equal(unlockKeys(), 0, 'expired entries are pruned on the next call');
  resetOwnerForTests();
  for (let i = 0; i < UNLOCK_KEYS_MAX + 250; i++) noteUnlockFailure(`a${i}`, t0 + i * 10);
  assert.ok(unlockKeys() <= UNLOCK_KEYS_MAX, `capped at ${UNLOCK_KEYS_MAX}`);
  resetOwnerForTests();
});

test('Lock: session-only (Host, Origin, JSON), bot credentials 403, a fake Origin refused', async () => {
  const { dataDir, seat, ready } = setup();
  await ready;
  const cookie = cookieFrom((await unlock(dataDir, PASS)).headers);
  const lock = (h: Record<string, string>) => call(hqRoutes.okkinOwnerLock, office(dataDir), h, {});
  const fake = await lock({ cookie, origin: 'https://evil.example' });
  assert.equal(fake.status, 403);
  assert.equal(fake.json.error, 'origin not allowed');
  assert.equal((await lock({ cookie, 'x-bridge-token': seat })).status, 403);
  assert.equal((await lock({ cookie, authorization: `Bearer ${BRIDGE}` })).status, 403);
  assert.equal((await call(hqRoutes.okkinOwnerLock, ctxOf(dataDir, undefined), { cookie }, {})).status, 401, 'no office session');
  fresh();
  assert.notEqual((await call(hqRoutes.okkinModel, office(dataDir), { cookie }, { model: 'okkin:latest' })).status, 403, 'still unlocked after the refused locks');
  assert.equal((await lock({ cookie })).status, 200);
  fresh();
  assert.equal((await call(hqRoutes.okkinModel, office(dataDir), { cookie }, { model: 'okkin:latest' })).status, 403, 'locked');
});

test('AGENT_OFFICE_OWNER_FILE: refused inside Major Files (as given or via a symlink) or inside the repo; never read or written', async () => {
  const { ownerFileRefusal, CODE_ROOT } = await import('../src/server/hq/okkin-owner.js');
  const tmp = mkdtempSync(path.join(tmpdir(), 'ao-owner-path-'));
  // A stand-in only: a temp folder with that name, never the real Major Files.
  const fakeMajor = path.join(tmp, 'Major Files', 'okkin-owner.json');
  assert.equal(ownerFileRefusal(fakeMajor), 'inside Major Files');
  await assert.rejects(setOwnerPassphrase(fakeMajor, PASS), /Major Files/);
  assert.equal(existsSync(path.join(tmp, 'Major Files')), false, 'nothing was created');
  const target = path.join(tmp, 'major_files');
  (await import('node:fs')).mkdirSync(target);
  (await import('node:fs')).symlinkSync(target, path.join(tmp, 'link'));
  assert.equal(ownerFileRefusal(path.join(tmp, 'link', 'okkin-owner.json')), 'inside Major Files', 'realpath is checked');
  const inRepo = path.join(CODE_ROOT, 'okkin-owner.json');
  assert.equal(ownerFileRefusal(inRepo), 'inside the repo');
  await assert.rejects(setOwnerPassphrase(inRepo, PASS), /repo/);
  assert.equal(existsSync(inRepo), false);
  assert.equal(ownerFileRefusal(path.join(tmp, 'conf', 'okkin-owner.json')), null);
  // Fail closed: a refused path means nobody is the owner.
  const { dataDir } = setup({ owner: false });
  process.env.AGENT_OFFICE_OWNER_FILE = inRepo;
  assert.equal((await unlock(dataDir, PASS)).json.error, 'owner not set up');
  rmSync(tmp, { recursive: true, force: true });
});

test('an office-password session (no account) plus the right passphrase is the owner; a token or Authorization still 403', async () => {
  const { dataDir, seat, ready } = setup({ policy: 'empty' });
  await ready;
  const r = await unlock(dataDir, PASS);
  assert.equal(r.status, 200, 'no account and no approvers entry needed');
  const cookie = cookieFrom(r.headers);
  fresh();
  assert.notEqual((await call(hqRoutes.okkinModel, office(dataDir), { cookie }, { model: 'okkin:latest' })).status, 403);
  for (const h of [{ 'x-bridge-token': seat }, { authorization: 'Basic eDp5' }]) {
    fresh();
    assert.equal((await call(hqRoutes.okkinModel, office(dataDir), { ...h, cookie }, { model: 'okkin:latest' })).status, 403);
  }
});

test('loft GET polling does not extend the owner idle timer', async () => {
  const { okkinCaller } = await import('../src/server/hq/okkin-owner.js');
  const { dataDir, ready } = setup();
  await ready;
  const start = Date.now() - OWNER_IDLE_MS + 60_000; // a minute of idle left
  const cookie = `${OWNER_COOKIE}=${startOwnerSession(start)}`;
  for (let i = 0; i < 3; i++) assert.equal((await call(hqRoutes.okkinLoft, office(dataDir), { cookie }, undefined)).json.ownerState, 'unlocked');
  const req = { headers: { cookie } } as unknown as IncomingMessage;
  assert.equal(okkinCaller(req, { now: start + OWNER_IDLE_MS + 1 }).kind, 'owner-expired', 'polling never touched it');
});

test('privacy: the Okkin Ask thread (GET /api/bridge/talk?seat=okkin) is the owner\'s only; bot credentials get a logged 403, other sessions get []', async () => {
  const { dataDir, seat, ready } = setup();
  await ready;
  const SECRET_PROMPT = 'owner private prompt 7f3a';
  setOkkinFetchForTests(async (url: string) => {
    if (url.endsWith('/api/chat')) return { ok: true, status: 200, text: async () => JSON.stringify({ message: { content: 'private reply 9c1e' }, eval_count: 10, eval_duration: 1e9 }) } as never;
    if (url.endsWith('/api/tags') || url.endsWith('/api/ps')) return { ok: true, status: 200, text: async () => JSON.stringify({ models: [{ name: 'demo:1b' }] }) } as never;
    return { ok: false, status: 404, text: async () => '' } as never;
  });
  const saved = { m: process.env.OKKIN_MODEL, a: process.env.OKKIN_MODEL_ALLOW };
  process.env.OKKIN_MODEL = 'demo:1b';
  process.env.OKKIN_MODEL_ALLOW = 'demo:1b';
  try {
    const cookie = cookieFrom((await unlock(dataDir, PASS)).headers);
    fresh();
    const asked = await call(hqRoutes.talk, office(dataDir), { cookie }, { seat: 'okkin', text: SECRET_PROMPT });
    assert.equal(asked.status, 200, JSON.stringify(asked.json));
    const read = (ctx: never, h: Record<string, string>) => call(hqRoutes.talkGet, ctx, h, undefined, '/api/bridge/talk?seat=okkin');
    const leaks = (j: unknown) => JSON.stringify(j).includes(SECRET_PROMPT) || JSON.stringify(j).includes('private reply 9c1e');
    for (const [who, h] of [['bridge token', { 'x-bridge-token': BRIDGE }], ['seat token', { 'x-bridge-token': seat }], ['Bearer', { authorization: `Bearer ${BRIDGE}` }], ['pool caller', { 'x-pool-caller': POOL }], ['bridge token + owner cookie', { 'x-bridge-token': BRIDGE, cookie }]] as const) {
      const r = await read(office(dataDir), { ...h });
      assert.equal(r.status, 403, who);
      assert.ok(!leaks(r.json), `${who}: no text`);
    }
    for (const [who, ctx] of [['shared-password session', office(dataDir)], ['non-owner account', ctxOf(dataDir, { account: { id: 'acct-2', role: 'member' } })]] as const) {
      const r = await read(ctx as never, {});
      assert.equal(r.status, 200, who);
      assert.deepEqual((r.json as { messages?: unknown[] }).messages, [], who);
      assert.ok(!leaks(r.json), who);
    }
    const mine = await read(office(dataDir), { cookie });
    assert.equal(mine.status, 200);
    assert.ok(leaks(mine.json), 'the owner sees the thread');
    assert.match(readFileSync(path.join(dataDir, OKKIN_REFUSALS_LOG), 'utf8'), /GET \/api\/bridge\/talk \(okkin\)/);
    assert.ok(!readFileSync(path.join(dataDir, OKKIN_REFUSALS_LOG), 'utf8').includes(SECRET_PROMPT), 'the log never holds Ask text');
  } finally {
    process.env.OKKIN_MODEL = saved.m;
    process.env.OKKIN_MODEL_ALLOW = saved.a;
    if (saved.m === undefined) delete process.env.OKKIN_MODEL;
    if (saved.a === undefined) delete process.env.OKKIN_MODEL_ALLOW;
  }
});

test('privacy: the loft GET carries the CRT text only for the owner; crt is null for a shared-password session, a non-owner account and a bot token', async () => {
  const { latestOkkinOutput } = await import('../src/server/hq/okkin.js');
  const { dataDir, seat, ready } = setup();
  await ready;
  setOkkinFetchForTests(async (url: string) => {
    if (url.endsWith('/api/chat')) return { ok: true, status: 200, text: async () => JSON.stringify({ message: { content: 'crt private 51b2' }, eval_count: 10, eval_duration: 1e9 }) } as never;
    if (url.endsWith('/api/tags') || url.endsWith('/api/ps')) return { ok: true, status: 200, text: async () => JSON.stringify({ models: [{ name: 'demo:1b' }] }) } as never;
    return { ok: false, status: 404, text: async () => '' } as never;
  });
  const saved = { m: process.env.OKKIN_MODEL, a: process.env.OKKIN_MODEL_ALLOW };
  process.env.OKKIN_MODEL = 'demo:1b';
  process.env.OKKIN_MODEL_ALLOW = 'demo:1b';
  try {
    const cookie = cookieFrom((await unlock(dataDir, PASS)).headers);
    fresh();
    assert.equal((await call(hqRoutes.talk, office(dataDir), { cookie }, { seat: 'okkin', text: 'hello' })).status, 200);
    assert.equal(latestOkkinOutput()?.text, 'crt private 51b2');
    const loft = (ctx: never, h: Record<string, string>) => call(hqRoutes.okkinLoft, ctx, h, undefined);
    for (const [who, ctx, h] of [['shared-password session', office(dataDir), {}], ['non-owner account', ctxOf(dataDir, { account: { id: 'acct-3', role: 'member' } }), {}], ['seat token', office(dataDir), { 'x-bridge-token': seat }], ['bridge token + owner cookie', office(dataDir), { 'x-bridge-token': BRIDGE, cookie }]] as const) {
      const r = await loft(ctx as never, { ...h });
      assert.ok(!JSON.stringify(r.json).includes('crt private 51b2'), who);
      if (r.status === 200) assert.equal((r.json as { crt?: unknown }).crt, null, who);
    }
    const mine = await loft(office(dataDir), { cookie });
    assert.equal((mine.json as { crt?: { text: string } }).crt?.text, 'crt private 51b2', 'the owner sees it');
  } finally {
    if (saved.m === undefined) delete process.env.OKKIN_MODEL; else process.env.OKKIN_MODEL = saved.m;
    if (saved.a === undefined) delete process.env.OKKIN_MODEL_ALLOW; else process.env.OKKIN_MODEL_ALLOW = saved.a;
  }
});
