// Okkin's controls are the owner's only, on the SERVER: power on, power off, the model switch and
// Ask to Okkin. The owner is an account session on the pool approvers list. The bridge token, a seat
// token, a Bearer, a shared-password session and a non-owner account each get 403, logged without secrets.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { hqRoutes } from '../src/server/http/routes/hq.js';
import { issueSeatToken } from '../src/server/seat-tokens.js';
import { resetPowerForTests } from '../src/server/hq/okkin-power.js';
import { resetOkkinForTests, setOkkinFetchForTests } from '../src/server/hq/okkin.js';
import { resetHqLimitsForTests } from '../src/server/hq/limits.js';
import { OKKIN_REFUSALS_LOG } from '../src/server/hq/okkin-owner.js';
import { switchView, stopsView, type LoftLike } from '../src/client/features/okkin-loft/model.js';

const BRIDGE = 'b'.repeat(64);
type Session = { account?: { id: string; role: 'admin' | 'member' } } | undefined;

function setup() {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'ao-okkin-owner-'));
  writeFileSync(path.join(dataDir, 'bridge-token'), BRIDGE);
  writeFileSync(path.join(dataDir, 'work-pool-policy.json'), JSON.stringify({ approvers: ['acct-owner'] }), { mode: 0o600 });
  const seat = issueSeatToken(dataDir, 'kavi');
  return { dataDir, seat };
}
const ctxOf = (dataDir: string, session: Session) => ({ cfg: { dataDir }, auth: { fromRequest: () => session, fromAnyCookie: () => !!session, sessionFromAnyCookie: () => session }, meOf: () => ({ admin: session?.account?.role === 'admin' }), workers: { list: () => [] } }) as never;
async function call(route: { handle: (...a: never[]) => unknown }, ctx: never, headers: Record<string, string>, body: unknown, url = '/api/bridge/okkin/loft') {
  let status = 0;
  let out = '';
  const res = { writeHead(s: number) { status = s; }, setHeader() {}, end(b?: unknown) { out = String(b ?? ''); } } as unknown as ServerResponse;
  const raw = body === undefined ? '' : JSON.stringify(body);
  const req = Readable.from([Buffer.from(raw)]) as unknown as IncomingMessage;
  req.method = body === undefined ? 'GET' : 'POST';
  req.headers = { host: '127.0.0.1:4600', 'content-type': 'application/json', ...headers };
  await (route.handle as (c: never, a: unknown) => unknown)(ctx, { req, res, url: new URL(`http://127.0.0.1:4600${url}`) });
  return { status, json: JSON.parse(out || '{}') as { error?: string; owner?: boolean } };
}

const CHANGES = [
  ['power on', hqRoutes.okkinPower, { action: 'start' }],
  ['power off', hqRoutes.okkinPower, { action: 'stop' }],
  ['model change', hqRoutes.okkinModel, { model: 'okkin:latest' }],
  ['Ask', hqRoutes.talk, { seat: 'okkin', text: 'hello' }],
] as const;

test('a bot/seat token, the bridge token and a Bearer each get 403 on power on, power off, model change and Ask', async () => {
  const { dataDir, seat } = setup();
  setOkkinFetchForTests(async () => new Response('{}', { status: 503 }));
  try {
    // Even with the owner's cookie alongside, a token never counts as the owner.
    const ctx = ctxOf(dataDir, { account: { id: 'acct-owner', role: 'admin' } });
    for (const [who, headers] of [['seat token', { 'x-bridge-token': seat }], ['bridge token', { 'x-bridge-token': BRIDGE }], ['Bearer', { authorization: `Bearer ${BRIDGE}` }]] as const) {
      for (const [what, route, body] of CHANGES) {
        resetPowerForTests();
        resetHqLimitsForTests();
        const r = await call(route, ctx, headers, body);
        assert.equal(r.status, 403, `${who}: ${what}`);
      }
    }
    const log = readFileSync(path.join(dataDir, OKKIN_REFUSALS_LOG), 'utf8');
    assert.equal(log.trim().split('\n').length, 12, 'every refusal logged');
    for (const l of log.trim().split('\n')) assert.deepEqual(Object.keys(JSON.parse(l)).sort(), ['at', 'caller', 'route']);
    assert.ok(!log.includes(BRIDGE) && !log.includes(seat), 'no secrets in the log');
    assert.match(log, /"caller":"bridge-token"/);
    assert.match(log, /"caller":"bearer"/);
    assert.equal(statSync(path.join(dataDir, OKKIN_REFUSALS_LOG)).mode & 0o777, 0o600);
  } finally {
    setOkkinFetchForTests(undefined);
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('a shared-password session and a non-owner account get 403 owner only; the owner gets through the gate', async () => {
  const { dataDir } = setup();
  setOkkinFetchForTests(async () => new Response('{}', { status: 503 }));
  try {
    for (const [who, session] of [['shared password', {}], ['non-owner account', { account: { id: 'acct-guest', role: 'admin' as const } }]] as const) {
      for (const [what, route, body] of CHANGES) {
        resetPowerForTests();
        resetHqLimitsForTests();
        const r = await call(route, ctxOf(dataDir, session), {}, body);
        assert.equal(r.status, 403, `${who}: ${what}`);
        assert.equal(r.json.error, 'owner only');
      }
    }
    const owner = ctxOf(dataDir, { account: { id: 'acct-owner', role: 'member' } });
    for (const [what, route, body] of CHANGES) {
      resetPowerForTests();
      resetHqLimitsForTests();
      resetOkkinForTests();
      setOkkinFetchForTests(async () => new Response('{}', { status: 503 }));
      const r = await call(route, owner, {}, body);
      assert.notEqual(r.status, 403, `owner: ${what} (${r.json.error})`);
      assert.notEqual(r.json.error, 'owner only');
    }
    // Status stays readable for anyone signed in, with owner false for non-owners.
    assert.equal((await call(hqRoutes.okkinLoft, ctxOf(dataDir, {}), {}, undefined)).json.owner, false);
    assert.equal((await call(hqRoutes.okkinLoft, owner, {}, undefined)).json.owner, true);
  } finally {
    setOkkinFetchForTests(undefined);
    resetOkkinForTests();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('the panel: a non-owner sees Owner only on the switch and the dial', () => {
  const d: LoftLike = { power: 'on', powerControl: 'ready', powerReason: null, owner: false, okkin: { chip: 'ready', configured: 'okkin:latest', model: 'okkin:latest' }, dial: [{ tag: 'okkin:latest', role: 'default', installed: true, ramOk: true, minFreeRamGB: null }] };
  const sw = switchView(d);
  assert.equal(sw.works, false);
  assert.equal(sw.label, 'Owner only');
  assert.equal(stopsView(d)[0]!.note, 'Owner only');
  assert.equal(stopsView(d)[0]!.usable, false);
  assert.equal(switchView({ ...d, owner: true }).works, true);
});
