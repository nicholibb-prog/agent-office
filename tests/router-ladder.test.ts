// Router ladder, escalation and safety rules (funnel #1, #2, #6, #10, #16, #24, #38, flag c).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { dispatch, route } from '../src/server/router/router.js';
import { Budget, FixupTax, capFromEnv } from '../src/server/router/budget.js';
import type { Task } from '../src/server/router/types.js';
import { FAKE_DRIVE_ID, j } from './support/router-fixtures.js';
import { testCtx } from './support/router-ctx.js';

const PUB = 'nicholibb-prog/agent-office';
const task = (over: Partial<Task>): Task => ({ id: 't-1', level: 2, repo: PUB, prompt: 'Summarise the README.', ...over });

test('bulk/first-pass (levels 1-2) goes to Okkin first; level 3-4 public to free cloud (DeepSeek last)', async () => {
  const t = testCtx();
  for (const level of [1, 2] as const) {
    const r = await dispatch(task({ level, type: 'draft' }), t.ctx);
    assert.equal(r.decision.provider, 'okkin');
  }
  assert.equal(t.cloudCalls(), 0);
  // OpenRouter off by default (flag a), so Groq is first.
  const d = route(task({ level: 3, type: 'code-edit' }), t.ctx);
  assert.equal(d.provider, 'groq');
  const t2 = testCtx({ env: { GROQ_API_KEY: '', NVIDIA_API_KEY: '', GLM_API_KEY: '' } });
  assert.equal(route(task({ level: 3 }), t2.ctx).provider, 'deepseek', 'DeepSeek when nothing else is up');
  const t3 = testCtx({ env: { ROUTER_OPENROUTER_CREDIT: '1', OPENROUTER_API_KEY: 'x' } });
  assert.deepEqual([route(task({ level: 4 }), t3.ctx).provider, route(task({ level: 4 }), t3.ctx).model], ['openrouter', 'poolside/laguna:free']);
});

test('public bulk work moves up to free cloud only when Okkin is down', async () => {
  const t = testCtx({ okkinUp: false });
  const r = await dispatch(task({ level: 1 }), t.ctx);
  assert.equal(r.status, 'done');
  assert.equal(r.decision.tier, 'free-cloud');
});

test('nothing private goes to DeepSeek or any cloud: private/secret are Okkin-only, else queue', async () => {
  for (const source of ['email', 'env']) {
    for (const level of [1, 2, 3, 4, 5] as const) {
      for (const okkinUp of [true, false]) {
        const t = testCtx({ okkinUp, env: { GROQ_API_KEY: '', NVIDIA_API_KEY: '', GLM_API_KEY: '' } });
        const r = await dispatch(task({ level, source }), t.ctx);
        assert.equal(t.cloudCalls(), 0, `${source} L${level} okkin=${okkinUp}`);
        if (level <= 2 && okkinUp) assert.equal(r.decision.provider, 'okkin');
        else assert.equal(r.status, 'queued');
      }
    }
  }
});

test('the gated tier (merges, money, sends, security) never goes to Okkin', async () => {
  for (const over of [{ level: 6 as const }, { level: 7 as const }, { level: 1 as const, gated: true }, { level: 2 as const, gated: true, source: 'email' }]) {
    const t = testCtx({ okkinUp: true });
    const r = await dispatch(task(over), t.ctx);
    assert.equal(t.okkinCalls.length, 0, JSON.stringify(over));
    assert.notEqual(r.decision.provider, 'okkin');
  }
  const t = testCtx();
  const r = await dispatch(task({ level: 6 }), t.ctx);
  assert.equal(r.decision.provider, 'grok-crew');
  assert.equal(t.crew[0].to, 'grok-crew');
  assert.equal(route(task({ level: 7 }), t.ctx).queue, 'owner');
});

test('15. a scan hit with Okkin down is queued, with zero cloud calls across all providers', async () => {
  const t = testCtx({ okkinUp: false, env: { ROUTER_OPENROUTER_CREDIT: '1', OPENROUTER_API_KEY: 'x' } });
  const r = await dispatch(task({ level: 2, prompt: `notes ${FAKE_DRIVE_ID}` }), t.ctx);
  assert.equal(r.status, 'queued');
  assert.equal(r.reason, 'scan-hit');
  assert.equal(t.cloudCalls(), 0);
  assert.equal(t.okkinCalls.length, 0);
  const blocked = t.logs.find((l) => l.result === 'blocked')!;
  assert.ok(blocked.scan_hits!.every((h) => Object.keys(h).join() === 'type,sha8,offset_bucket'));
  assert.ok(!JSON.stringify(t.logs).includes(FAKE_DRIVE_ID) && !JSON.stringify(t.alerts).includes(FAKE_DRIVE_ID));
  assert.deepEqual(t.alerts.filter((a) => a.kind === 'scan-block').length, 1, 'the owner alerted once');
});

test('a scan hit reroutes to Okkin with the same task ID when Okkin may take it; never a trimmed retry', async () => {
  const t = testCtx({ okkinUp: true });
  // Level 3 public with a hit: Okkin's limit is 2, so it queues (no cloud fallover).
  const r3 = await dispatch(task({ id: 'same-id', level: 3, prompt: j('mail ', 'jane', '@corp.io') }), t.ctx);
  assert.equal(r3.status, 'queued');
  assert.equal(t.cloudCalls(), 0);
  // Level 2 public: Okkin was down at routing time (so free cloud), the scan blocks, Okkin is back:
  // rerouted to Okkin with the same ID, and no other cloud provider is tried.
  const t2 = testCtx({ env: { ROUTER_OPENROUTER_CREDIT: '1', OPENROUTER_API_KEY: 'x' } });
  let calls = 0;
  t2.ctx.okkinOk = () => calls++ > 0;
  const r2 = await dispatch(task({ id: 'same-id', level: 2, prompt: j('mail ', 'jane', '@corp.io') }), t2.ctx);
  assert.equal(r2.status, 'done');
  assert.equal(r2.taskId, 'same-id');
  assert.equal(r2.decision.provider, 'okkin');
  assert.deepEqual(r2.history.map((h) => [h.provider, h.result]), [['openrouter', 'blocked'], ['okkin', 'ok']]);
  assert.equal(t2.cloudCalls(), 0, 'blocked before the wire; no fallover');
});

test('retries: ≤2 attempts per tier, the 2nd carries the 1st failure log, then up one tier with the same ID', async () => {
  const t = testCtx({ okkinOk: false, env: { GROQ_API_KEY: '', NVIDIA_API_KEY: '', GLM_API_KEY: '', DEEPSEEK_API_KEY: '' } });
  const r = await dispatch(task({ id: 'keep-me', level: 2 }), t.ctx);
  assert.equal(t.okkinCalls.length, 2);
  assert.match(t.okkinCalls[1], /Earlier attempts:\n#1 okkin: fail \(okkin failed\)/);
  // No free cloud configured: up to crew (ForgeL), with the history carried in the payload.
  assert.equal(r.decision.provider, 'forgel');
  assert.equal(r.taskId, 'keep-me');
  assert.equal(r.history.length, 3);
  assert.match(t.crew[0].wire, /okkin failed/);
  assert.ok(t.logs.some((l) => l.result === 'escalate' && l.escalated_to === 'free-cloud'));
  assert.ok(t.logs.every((l) => l.task_id === 'keep-me'));
});

test('nothing goes down the ladder', () => {
  const t = testCtx();
  assert.equal(route(task({ level: 2 }), t.ctx, 'crew').tier, 'crew');
  assert.notEqual(route(task({ level: 5 }), t.ctx).provider, 'okkin');
});

test('flag (c) C6 OFF: student-sourced tasks are held, never sent anywhere; ON needs the store too', async () => {
  const t = testCtx();
  const r = await dispatch(task({ source: 'preply', level: 1 }), t.ctx);
  assert.equal(r.status, 'queued');
  assert.equal(r.reason, 'c6-held');
  assert.equal(t.okkinCalls.length + t.cloudCalls(), 0);
  const on = testCtx({ env: { ROUTER_C6_STUDENT_DRIVE: '1' } });
  assert.equal(route(task({ source: 'preply', level: 1 }), on.ctx).queue, 'c6-held', 'flag on, store empty: still held');
  on.ctx.studentStoreReady = () => true;
  const ok = route(task({ source: 'preply', level: 1 }), on.ctx);
  assert.equal(ok.provider, 'okkin', 'flag on + store: private, so Okkin only');
  assert.equal(route(task({ source: 'preply', level: 3 }), on.ctx).queue, 'label-above-okkin');
});

test('flag (b) C1 OFF: a secret task above level 2 queues for the owner, never the Grok crew', async () => {
  const t = testCtx();
  const r = await dispatch(task({ source: 'env', level: 6 }), t.ctx);
  assert.equal(r.status, 'queued');
  assert.equal(t.crew.length, 0);
  const on = testCtx({ env: { ROUTER_C1_SECRET_TO_GROK_CREW: '1' } });
  assert.equal(route(task({ source: 'env', level: 6 }), on.ctx).provider, 'grok-crew');
  assert.equal(route(task({ source: 'email', level: 6 }), on.ctx).queue, 'label-above-okkin', 'C1 covers secret only, not private');
});

test('kill switch (env or file) halts all paid routing; free and Okkin keep going', () => {
  const k = testCtx({ env: { ROUTER_KILL: '1', GROQ_API_KEY: '', NVIDIA_API_KEY: '', GLM_API_KEY: '' } });
  assert.equal(route(task({ level: 5 }), k.ctx).queue, 'kill');
  assert.equal(route(task({ level: 3 }), k.ctx).queue, 'kill', 'DeepSeek skipped, then crew killed');
  assert.equal(route(task({ level: 2 }), k.ctx).provider, 'okkin');
  const dir = mkdtempSync(path.join(tmpdir(), 'ao-kill-'));
  try {
    const f = testCtx({ dataDir: dir });
    assert.equal(route(task({ level: 5 }), f.ctx).provider, 'forgel');
    writeFileSync(path.join(dir, 'router-kill'), '1\n');
    assert.equal(route(task({ level: 5 }), f.ctx).queue, 'kill');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('daily paid cap: $3 default, one 80% alert, at 100% only Dan security passes; resets at MT midnight', () => {
  assert.equal(capFromEnv({}), 3);
  assert.equal(capFromEnv({ PAID_DAILY_CAP_USD: '5' }), 5);
  assert.equal(capFromEnv({ PAID_DAILY_CAP_USD: 'lots' }), 3);
  let now = Date.parse('2026-10-13T16:00:00Z');
  const alerts: string[] = [];
  const b = new Budget({ capUsd: 3, env: {}, now: () => now, alert: (a) => alerts.push(a.kind) });
  b.spend(2.5);
  b.spend(0.01);
  assert.deepEqual(alerts, ['cap-80']);
  assert.equal(b.allowed(), true);
  b.spend(0.5);
  assert.deepEqual(alerts, ['cap-80', 'cap-100']);
  assert.equal(b.allowed(), false);
  assert.equal(b.allowed({ danSecurity: true }), true);
  now = Date.parse('2026-10-14T06:05:00Z'); // 00:05 MT the next day
  assert.equal(b.allowed(), true);
  assert.equal(b.spentToday(), 0);
});

test('fix-up tax: repair >50% of direct paid cost two days running stops free routing for that type', () => {
  let now = Date.parse('2026-10-12T16:00:00Z');
  const f = new FixupTax(() => now);
  f.record('summary', 0.6, 1);
  assert.equal(f.freeAllowed('summary'), true);
  now += 86_400_000;
  f.record('summary', 0.4, 1);
  assert.equal(f.freeAllowed('summary'), true, 'second day under 50%');
  now += 86_400_000;
  f.record('summary', 0.9, 1);
  now += 86_400_000;
  f.record('summary', 0.7, 1);
  assert.equal(f.freeAllowed('summary'), false);
  assert.equal(f.freeAllowed('draft'), true);
  const t = testCtx({ okkinUp: false });
  t.ctx.fixup = f;
  assert.equal(route(task({ level: 3, type: 'summary' }), t.ctx).tier, 'crew');
});
