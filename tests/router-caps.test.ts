// Rotation and caps (funnel #13, #14, #15, #21, #24, #25, #29, #30, #32, #36, #37) and the
// production wiring against a stub Ollama on an ephemeral port (never 11434).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CapLedger, OPENROUTER_CREDIT_RPD, parseReset } from '../src/server/router/cap-ledger.js';
import { Breaker, BREAKER_OPEN_MS, backoffMs } from '../src/server/router/breaker.js';
import { estimateTokens, sizeAllows, GROQ_MAX_TOKENS } from '../src/server/router/estimate.js';
import { deepseekPeak } from '../src/server/router/peak.js';
import { JobBoard, LEASE_MS, SelfSource, loadTaskSources, mayClaim } from '../src/server/router/job-board.js';
import { OkkinHealth, OKKIN_PING_MS } from '../src/server/router/okkin-health.js';
import { dispatch, route } from '../src/server/router/router.js';
import { createRouterCtx } from '../src/server/router/index.js';
import type { Task } from '../src/server/router/types.js';
import { testCtx } from './support/router-ctx.js';

const PUB = 'nicholibb-prog/agent-office';
const task = (over: Partial<Task>): Task => ({ id: 't-2', level: 3, repo: PUB, prompt: 'Review this public diff.', ...over });

test('#13 OpenRouter :free models share one counter; the $10 credit (flag a) lifts it to 1,000/day', () => {
  let now = 0;
  const l = new CapLedger(() => now);
  for (let i = 0; i < 50; i++) { now += 60_001; l.record(i % 2 ? 'openrouter' : 'openrouter:other', 10); }
  assert.equal(l.available('openrouter', 10), false, '50/day shared across models');
  const c = new CapLedger(() => 0, { openrouterCredit: true });
  assert.equal(c.snapshot().openrouter.reqLeftToday, OPENROUTER_CREDIT_RPD);
});

test('#32/#36 headers update the ledger and store each provider its own reset; bulk runs right after', () => {
  let now = 1_000_000;
  const l = new CapLedger(() => now);
  assert.equal(l.available('groq', 100), true);
  l.update('groq', { 'x-ratelimit-remaining-requests': '0', 'x-ratelimit-reset-requests': '2m30s' });
  assert.equal(l.available('groq', 100), false);
  assert.equal(l.resetAt('groq'), now + 150_000);
  assert.equal(l.bulkSlot('groq'), now + 151_000);
  assert.equal(l.bulkSlot('nim'), now, 'no stored reset: now');
  now += 150_001;
  assert.equal(l.available('groq', 100), true, 'after its reset');
  l.update('groq', { 'x-ratelimit-limit-tokens': '5000' });
  assert.equal(l.available('groq', 5001), false);
  assert.equal(parseReset('12ms'), 12);
  assert.equal(parseReset('7'), 7000);
  assert.equal(parseReset('soon'), null);
});

test('#14 429/5xx: exponential backoff, ≤2 retries, then the next provider; 3 fails in 5 min trips 15 min', async () => {
  assert.deepEqual([0, 1, 2].map((r) => backoffMs(r)), [1000, 2000, 4000]);
  let now = 0;
  const b = new Breaker(() => now);
  b.fail('groq'); now += 60_000; b.fail('groq');
  assert.equal(b.ok('groq'), true);
  now += 60_000; b.fail('groq');
  assert.equal(b.ok('groq'), false);
  now += BREAKER_OPEN_MS;
  assert.equal(b.ok('groq'), true);

  const t = testCtx({ status: [429, 503, 429] });
  const slept: number[] = [];
  t.ctx.sleep = async (ms) => { slept.push(ms); };
  const r = await dispatch(task({}), t.ctx);
  assert.deepEqual(slept, [1000, 2000]);
  assert.deepEqual(t.http.map((h) => new URL(h.url).hostname.split('.').slice(-2).join('.')), ['groq.com', 'groq.com', 'groq.com', 'nvidia.com']);
  assert.equal(r.status, 'done');
  assert.equal(r.decision.provider, 'nim');
  assert.equal(t.ctx.breaker.ok('groq'), false, 'three failures tripped Groq');
});

test('#15/#37 token pre-estimate: Groq only under 6K; over 100K only Laguna or Okkin', () => {
  assert.equal(estimateTokens('x'.repeat(4000)), 1000);
  assert.equal(estimateTokens('x', 9000), 9000);
  assert.equal(sizeAllows('groq', 'g', GROQ_MAX_TOKENS - 1), true);
  assert.equal(sizeAllows('groq', 'g', GROQ_MAX_TOKENS), false);
  assert.equal(sizeAllows('nim', 'n', 100_001), false);
  assert.equal(sizeAllows('openrouter', 'poolside/laguna:free', 100_001), true);
  assert.equal(sizeAllows('openrouter', 'other:free', 100_001), false);
  const t = testCtx();
  assert.equal(route(task({ estTokens: 7000 }), t.ctx).provider, 'nim', 'too big for Groq');
  const big = testCtx({ env: { ROUTER_OPENROUTER_CREDIT: '1', OPENROUTER_API_KEY: 'x' } });
  assert.deepEqual([route(task({ estTokens: 150_000 }), big.ctx).model], ['poolside/laguna:free']);
  assert.equal(route(task({ estTokens: 150_000 }), t.ctx).tier, 'crew', 'no Laguna: up the ladder, never a small model');
});

test('#21 DeepSeek is hard-blocked weekdays 7-10 PM and 12-4 AM MT', () => {
  const mt = (iso: string) => Date.parse(iso); // MDT = UTC-6
  assert.equal(deepseekPeak(mt('2026-10-13T01:30:00Z')), true, 'Mon 7:30 PM MT');
  assert.equal(deepseekPeak(mt('2026-10-13T08:00:00Z')), true, 'Tue 2 AM MT');
  assert.equal(deepseekPeak(mt('2026-10-13T16:00:00Z')), false, 'Tue 10 AM MT');
  assert.equal(deepseekPeak(mt('2026-10-13T04:30:00Z')), false, 'Mon 10:30 PM MT');
  assert.equal(deepseekPeak(mt('2026-10-18T02:00:00Z')), false, 'Sat 8 PM MT');
  const t = testCtx({ env: { GROQ_API_KEY: '', NVIDIA_API_KEY: '', GLM_API_KEY: '' }, now: () => mt('2026-10-13T01:30:00Z') });
  assert.equal(route(task({}), t.ctx).provider, 'forgel', 'peak: DeepSeek skipped');
});

test('#24/#25 job board: 20-min leases, Okkin ≤2, free cloud ≤4 public only; self-sourcing capped', () => {
  let now = 0;
  const b = new JobBoard(() => now);
  const pub = { id: 'a', level: 2 as const, label: 'public' as const };
  assert.equal(mayClaim('okkin', { ...pub, level: 3 }), false);
  assert.equal(mayClaim('okkin', { ...pub, gated: true }), false);
  assert.equal(mayClaim('free-cloud', { ...pub, level: 4 }), true);
  assert.equal(mayClaim('free-cloud', { ...pub, level: 5 }), false);
  assert.equal(mayClaim('free-cloud', { ...pub, label: 'private' }), false);
  assert.equal(b.claim(pub, 'okkin', 'okkin-1'), true);
  assert.equal(b.claim(pub, 'free-cloud', 'groq-1'), false, 'leased');
  now += LEASE_MS - 1;
  assert.equal(b.heartbeat('a', 'okkin-1'), true);
  now += LEASE_MS + 1;
  assert.equal(b.holder('a'), undefined, 'expired with no heartbeat');
  assert.equal(b.claim(pub, 'free-cloud', 'groq-1'), true);

  assert.deepEqual(loadTaskSources(), { dailyCap: 60, sources: [] });
  const none = new SelfSource(loadTaskSources());
  assert.equal(none.admit('github-issues'), false, 'no approved sources yet');
  const s = new SelfSource({ dailyCap: 60, sources: ['github-issues'] }, () => now);
  let admitted = 0;
  for (let i = 0; i < 70; i++) if (s.admit('github-issues')) admitted++;
  assert.equal(admitted, 60);
  assert.equal(s.admit('random-site'), false);
});

test('#29/#30 Okkin health: 60 s ping, switch OFF means down; private work queues while down', async () => {
  let now = 0;
  let power = true;
  let ready: 'ready' | 'offline' = 'ready';
  const h = new OkkinHealth({ probe: async () => ready, poweredOn: () => power, now: () => now });
  assert.equal(h.ok(), false, 'never pinged');
  await h.ping();
  assert.equal(h.ok(), true);
  power = false;
  assert.equal(h.ok(), false, 'loft switch off');
  power = true;
  now += 3 * OKKIN_PING_MS;
  assert.equal(h.ok(), false, 'stale ping');
  ready = 'offline';
  await h.ping();
  assert.equal(h.ok(), false);
  const t = testCtx({ okkinUp: false });
  const r = await dispatch(task({ level: 1, source: 'email' }), t.ctx);
  assert.equal(r.reason, 'okkin-down');
  assert.equal(t.cloudCalls(), 0);
});

test('wiring: stub Ollama on an ephemeral loopback port; an unreadable deny-hash store disables all cloud', async () => {
  const srv = createServer((req, res) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      if (req.url === '/api/tags') return res.end(JSON.stringify({ models: [{ name: 'stub' }] }));
      if (req.url === '/api/chat') return res.end(JSON.stringify({ message: { content: 'stub okkin' } }));
      res.statusCode = 404;
      res.end('{}');
    });
  });
  await new Promise<void>((ok) => srv.listen(0, '127.0.0.1', ok));
  const port = (srv.address() as { port: number }).port;
  assert.notEqual(port, 11434);
  const dir = mkdtempSync(path.join(tmpdir(), 'ao-wire-'));
  try {
    const bad = path.join(dir, 'deny.json');
    writeFileSync(bad, '{"owner_name": ["not-a-hash"]}');
    const { ctx, health } = createRouterCtx({ dataDir: dir, env: { OLLAMA_URL: `http://127.0.0.1:${port}`, OKKIN_MODEL: 'stub', PRESEND_DENY_HASHES_FILE: bad, GROQ_API_KEY: 'x' } });
    await health.ping();
    assert.equal(ctx.okkinOk(), true);
    const r = await dispatch({ id: 'w1', level: 1, repo: PUB, prompt: 'hi' }, ctx);
    assert.equal(r.text, 'stub okkin');
    // Cloud is refused (deny store unreadable) before any network call: escalates past every cloud provider.
    const up = await dispatch({ id: 'w2', level: 3, repo: PUB, prompt: 'hi' }, ctx);
    assert.equal(up.status, 'queued');
    assert.ok(up.history.every((h) => h.result === 'refused'));
  } finally {
    srv.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
