// Crew presence and the owner merit routes. Proof flags stay off on the wire.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request, type Server } from 'node:http';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { WORKING_LEASE_MS } from '../src/shared/hq.js';
import { candidatesFromCrew, meritCrewAttachment, presenceFromStatus } from '../src/server/router/merit-crew.js';
import { requestHandler } from '../src/server/http/router.js';
import { routerMeritRoutes } from '../src/server/http/routes/router-merit.js';
import { bridgeRoutes } from '../src/server/http/routes/bridge.js';
import { testOwner } from './support/okkin-owner.js';

const NOW = 1_700_000_000_000;

test('crew presence: fresh working is live, stale or out is not, names come from the seat map', () => {
  assert.equal(presenceFromStatus('working', NOW, NOW), 'on');
  assert.equal(presenceFromStatus('idle', NOW - 1000, NOW), 'on');
  assert.equal(presenceFromStatus('working', NOW - WORKING_LEASE_MS, NOW), 'out');
  assert.equal(presenceFromStatus('offline', NOW, NOW), 'out');
  assert.equal(presenceFromStatus('usage empty', NOW, NOW), 'out');
  assert.equal(presenceFromStatus('blocked', NOW, NOW), 'out');
  assert.equal(presenceFromStatus('working', undefined, NOW), 'absent');
  assert.equal(presenceFromStatus('mystery', NOW, NOW), 'absent');

  const live = candidatesFromCrew({
    crew: { 'seat-1': 'working', 'seat-2': 'idle' },
    seen: { 'seat-1': NOW, 'seat-2': NOW },
    names: { 'seat-1': 'george', 'seat-2': 'Kavi' },
    now: NOW,
  });
  assert.deepEqual(live.map((c) => [c.id, c.presence]), [
    ['george-router', 'on'],
    ['kavi-router-2', 'on'],
  ]);

  const covered = candidatesFromCrew({
    crew: { george: 'usage-empty', muse: 'working' },
    seen: { george: NOW, muse: NOW },
    now: NOW,
  });
  assert.equal(covered.find((c) => c.id === 'george-router')?.presence, 'out');
  assert.equal(covered.find((c) => c.id === 'kavi-router-2')?.presence, 'on');
});

test('merit routes: flag off is off; flag on picks from crew-status; private never lists a public cloud', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ao-merit-'));
  const has = (req: { headers: { cookie?: string } }) => /(^|;\s*)ao=session(;|$)/.test(req.headers.cookie || '');
  const ctx = {
    cfg: { port: 4600, dataDir: dir },
    services: { lookup: () => undefined },
    auth: {
      fromRequest: (r: { headers: { cookie?: string } }) => (has(r) ? {} : undefined),
      fromAnyCookie: (r: { headers: { cookie?: string } }) => has(r),
      sessionFromAnyCookie: (r: { headers: { cookie?: string } }) => (has(r) ? {} : undefined),
    },
  } as never;
  const srv: Server = createServer(requestHandler(ctx, [routerMeritRoutes.seat, routerMeritRoutes.assign, bridgeRoutes.crewStatusGet]));
  await new Promise<void>((ok) => srv.listen(0, '127.0.0.1', ok));
  const port = (srv.address() as { port: number }).port;
  const call = (method: string, pathName: string, headers: Record<string, string>, json?: unknown) => new Promise<{ status: number; body: string }>((ok, bad) => {
    const rq = request({ host: '127.0.0.1', port, method, path: pathName, headers: { host: '127.0.0.1:4600', ...headers } }, (res) => {
      let b = '';
      res.on('data', (c) => (b += c));
      res.on('end', () => ok({ status: res.statusCode || 0, body: b }));
    });
    rq.on('error', bad);
    if (json !== undefined) rq.end(JSON.stringify(json));
    else rq.end();
  });
  const prev = process.env.ROUTER_ON;
  const { cookie } = await testOwner();
  const owner = { cookie: `ao=session; ${cookie()}` };
  try {
    writeFileSync(path.join(dir, 'crew-status.json'), JSON.stringify({
      updatedAt: '2026-10-27T22:00:00.000Z',
      crew: { george: 'working', kavi: 'out' },
      seen: { george: Date.now(), kavi: Date.now() },
      source: 'test',
    }));
    delete process.env.ROUTER_ON;
    assert.deepEqual(JSON.parse((await call('GET', '/api/router/merit', owner)).body), { on: false, top: null, overseer: 'kavi-overseer' });
    const crewOff = JSON.parse((await call('GET', '/api/bridge/crew-status', owner)).body);
    assert.equal(crewOff.merit, undefined);
    assert.equal(meritCrewAttachment(ctx), null);

    process.env.ROUTER_ON = '1';
    const seat = JSON.parse((await call('GET', '/api/router/merit', owner)).body);
    assert.equal(seat.on, true);
    assert.equal(seat.top, 'george-router');
    assert.equal(seat.overseer, 'kavi-overseer');
    const crewOn = JSON.parse((await call('GET', '/api/bridge/crew-status', owner)).body);
    assert.equal(crewOn.merit.top, 'george-router');
    assert.equal(crewOn.crew.george, 'working');

    const link = 'https://example.com/job';
    const assigned = JSON.parse((await call('POST', '/api/router/merit', { ...owner, 'content-type': 'application/json' }, {
      id: 'task-9', privacy: 'private', kind: 'privacy', link,
    })).body);
    assert.equal(assigned.on, true);
    assert.equal(assigned.winner, 'george-router');
    assert.equal(assigned.lane, 'kavi-local');
    assert.equal(assigned.nickNote, `Owner: Kavi local. Link: ${link}.`);
    const logged = readFileSync(path.join(dir, 'logs', 'routing', 'merit.jsonl'), 'utf8');
    assert.ok(logged.includes('"lane":"kavi-local"'));
    assert.ok(!logged.includes(link));
    assert.ok(!logged.includes('deepseek'));

    const grey = JSON.parse((await call('POST', '/api/router/merit', { ...owner, 'content-type': 'application/json' }, {
      id: 'task-grey', privacy: 'grey', kind: 'research',
    })).body);
    assert.equal(grey.lane, 'kavi-local');
    assert.notEqual(grey.lane, 'deepseek');

    const refused = await call('POST', '/api/router/merit', { ...owner, 'content-type': 'application/json' }, {
      id: 'task-x', privacy: 'public', kind: 'research', deepseekProven: true,
    });
    assert.equal(refused.status, 400);

    writeFileSync(path.join(dir, 'crew-status.json'), JSON.stringify({
      crew: { george: 'out', kavi: 'working' },
      seen: { george: Date.now(), kavi: Date.now() },
    }));
    const next = JSON.parse((await call('GET', '/api/router/merit', owner)).body);
    assert.equal(next.top, 'kavi-router-2');

    writeFileSync(path.join(dir, 'crew-status.json'), JSON.stringify({
      crew: { george: 'out', kavi: 'absent' },
      seen: { george: Date.now(), kavi: Date.now() },
    }));
    const empty = JSON.parse((await call('POST', '/api/router/merit', { ...owner, 'content-type': 'application/json' }, {
      id: 'task-hold', privacy: 'grey', kind: 'privacy',
    })).body);
    assert.equal(empty.top, null);
    assert.equal(empty.lane, 'hold-private');

    assert.equal((await call('GET', '/api/router/merit', {})).status, 401);
    assert.deepEqual(JSON.parse((await call('GET', '/api/router/merit', { cookie: 'ao=session' })).body), { private: true });
    const bot = await call('GET', '/api/router/merit', { ...owner, 'x-bridge-token': 'b'.repeat(64) });
    assert.equal(bot.status, 403);
  } finally {
    if (prev === undefined) delete process.env.ROUTER_ON;
    else process.env.ROUTER_ON = prev;
    srv.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
