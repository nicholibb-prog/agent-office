// cloudSend is the single gate (spec §1): label, provider enabled, full-payload scan, then send.
// Provider endpoints are stubbed: no network. Cases 14 and 19 of Dan's spec, plus flags (a) and (b).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cloudSend, ScanBlocked, SendRefused } from '../src/server/router/cloud-send.js';
import { readRouterFlags, providerEnabled } from '../src/server/router/flags.js';
import type { ProviderFetch } from '../src/server/router/provider-clients.js';
import type { WirePayload } from '../src/server/router/types.js';
import { FAKE_DRIVE_ID, flagsOff, j, scanCtx } from './support/router-fixtures.js';
import { emptyDeny, loadDenyHashes, sha256 } from '../src/server/router/presend-scan.js';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

function stub() {
  const calls: { url: string; body: string; auth: string }[] = [];
  const fetchImpl: ProviderFetch = async (url, init) => {
    calls.push({ url, body: init.body, auth: init.headers.authorization });
    return {
      status: 200,
      headers: { get: (h: string) => (h === 'x-ratelimit-remaining-requests' ? '41' : null) },
      text: async () => JSON.stringify({ choices: [{ message: { content: 'stub reply' } }], usage: { prompt_tokens: 12, completion_tokens: 3 } }),
    };
  };
  return { calls, fetchImpl };
}
const FAKE_KEY = j('test-', 'not-a-real-', 'key');
const env = { GROQ_API_KEY: FAKE_KEY, DEEPSEEK_API_KEY: FAKE_KEY, NVIDIA_API_KEY: FAKE_KEY };
const clean: WirePayload = { model: 'llama-3.3', prompt: 'Summarise the public README in three bullets.' };

test('18/send: a clean public payload is sent once, with the key only in the Authorization header', async () => {
  const s = stub();
  const hits: unknown[] = [];
  const r = await cloudSend('groq', clean, { label: 'public', flags: flagsOff, scan: scanCtx(), env, fetchImpl: s.fetchImpl, onScan: (h) => hits.push(...h) });
  assert.equal(r.text, 'stub reply');
  assert.equal(r.limits['x-ratelimit-remaining-requests'], '41');
  assert.equal(s.calls.length, 1);
  assert.equal(s.calls[0].auth, `Bearer ${FAKE_KEY}`);
  assert.ok(!s.calls[0].body.includes(FAKE_KEY));
  assert.deepEqual(hits, []);
});

test('14. a hit only in carried history or a tool result blocks (full-payload scan)', async () => {
  for (const p of [
    { ...clean, history: [{ attempt: 1, provider: 'okkin', result: 'fail', log: `read ${FAKE_DRIVE_ID}` }] },
    { ...clean, toolResults: [j('DB_HOST=x\n', 'API_TO', 'KEN=y')] },
    { ...clean, attachments: [{ name: 'notes.txt', text: j('pass', 'word=', 'x1') }] },
    { ...clean, metadata: { owner: j('jane', '@corp', '.io') } },
  ] as WirePayload[]) {
    const s = stub();
    await assert.rejects(cloudSend('groq', p, { label: 'public', flags: flagsOff, scan: scanCtx(), env, fetchImpl: s.fetchImpl }), (e: unknown) => {
      assert.ok(e instanceof ScanBlocked);
      assert.ok(!String((e as Error).message).includes(FAKE_DRIVE_ID));
      assert.match((e as Error).message, /^pre-send scan blocked: [A-Z_, ]+$/);
      return true;
    });
    assert.equal(s.calls.length, 0, 'no provider call');
  }
});

test('19. a public-labelled source with a hit is still blocked (the scan overrides the label)', async () => {
  const s = stub();
  await assert.rejects(cloudSend('deepseek', { ...clean, prompt: j('key ', 'sk-', 'abcdefghijklmnop1234') }, { label: 'public', flags: flagsOff, scan: scanCtx(), env, fetchImpl: s.fetchImpl }), ScanBlocked);
  assert.equal(s.calls.length, 0);
});

test('nothing private or secret ever reaches DeepSeek (or any cloud), even clean text', async () => {
  for (const label of ['private', 'secret'] as const) {
    for (const p of ['deepseek', 'groq', 'nim', 'glm', 'openrouter', 'forgel', 'polishl', 'grok-crew'] as const) {
      const s = stub();
      const crew: string[] = [];
      await assert.rejects(cloudSend(p, clean, { label, flags: flagsOff, scan: scanCtx(), env, fetchImpl: s.fetchImpl, crewSend: async (_to, w) => (crew.push(w), { text: '' }) }), SendRefused);
      assert.equal(s.calls.length + crew.length, 0, `${label} -> ${p}`);
    }
  }
  // Even with C1 on, DeepSeek never takes a secret task.
  const s = stub();
  await assert.rejects(cloudSend('deepseek', clean, { label: 'secret', flags: { ...flagsOff, c1SecretToGrokCrew: true }, scan: scanCtx(), env, fetchImpl: s.fetchImpl }), SendRefused);
  assert.equal(s.calls.length, 0);
});

test('Okkin is not a cloud destination: cloudSend refuses it', async () => {
  await assert.rejects(cloudSend('okkin' as never, clean, { label: 'public', flags: flagsOff, scan: scanCtx(), env }), SendRefused);
});

test('a provider with no key is disabled (no call)', async () => {
  const s = stub();
  await assert.rejects(cloudSend('glm', clean, { label: 'public', flags: flagsOff, scan: scanCtx(), env, fetchImpl: s.fetchImpl }), (e) => (e as SendRefused).reason === 'disabled');
  assert.equal(s.calls.length, 0);
});

test('flag (a) OpenRouter credit route: default OFF blocks it; ON needs the key env too', async () => {
  assert.equal(readRouterFlags({}).openrouter, false);
  assert.equal(readRouterFlags({ OPENROUTER_API_KEY: FAKE_KEY }).openrouter, false, 'a key alone does not turn it on');
  assert.equal(readRouterFlags({ ROUTER_OPENROUTER_CREDIT: '1' }).openrouter, false, 'flag on but no key: disabled');
  assert.equal(readRouterFlags({ ROUTER_OPENROUTER_CREDIT: 'true', OPENROUTER_API_KEY: FAKE_KEY }).openrouter, false, 'only "1" turns it on');
  assert.equal(readRouterFlags({ ROUTER_OPENROUTER_CREDIT: '1', OPENROUTER_API_KEY: FAKE_KEY }).openrouter, true);
  assert.equal(readRouterFlags({ ROUTER_OPENROUTER_CREDIT: '1', ROUTER_OPENROUTER_KEY_ENV: 'MY_OR_SECRET', MY_OR_SECRET: FAKE_KEY }).openrouter, true, 'configured secret name');
  assert.equal(readRouterFlags({ ROUTER_OPENROUTER_CREDIT: '1', ROUTER_OPENROUTER_KEY_ENV: 'bad name;rm', OPENROUTER_API_KEY: FAKE_KEY }).openrouter, false);

  const offEnv = { OPENROUTER_API_KEY: FAKE_KEY };
  const off = readRouterFlags(offEnv);
  assert.equal(providerEnabled('openrouter', off, offEnv), false);
  const s = stub();
  await assert.rejects(cloudSend('openrouter', clean, { label: 'public', flags: off, scan: scanCtx(), env: offEnv, fetchImpl: s.fetchImpl }), (e) => (e as SendRefused).reason === 'disabled');
  assert.equal(s.calls.length, 0);

  const onEnv = { ...offEnv, ROUTER_OPENROUTER_CREDIT: '1' };
  const ok = await cloudSend('openrouter', clean, { label: 'public', flags: readRouterFlags(onEnv), scan: scanCtx(), env: onEnv, fetchImpl: s.fetchImpl });
  assert.equal(ok.status, 200);
  assert.equal(s.calls.length, 1);
});

test('flag (b) C1: OFF refuses secret tasks to the Grok crew; ON relaxes the label only, the scan still blocks', async () => {
  assert.equal(readRouterFlags({}).c1SecretToGrokCrew, false);
  const sent: string[] = [];
  const crewSend = async (_to: string, w: string) => (sent.push(w), { text: 'ok' });
  const clean2 = { ...clean, prompt: 'Rotate the staging certificate per the runbook.' };
  await assert.rejects(cloudSend('grok-crew', clean2, { label: 'secret', flags: flagsOff, scan: scanCtx(), env, crewSend }), SendRefused);
  assert.equal(sent.length, 0);
  const flags = readRouterFlags({ ROUTER_C1_SECRET_TO_GROK_CREW: '1' });
  // A key, a password and a private key are each blocked for the Grok crew under C1=1.
  for (const prompt of [j('rotate ', 'gh', 'p_', 'A1b2C3d4E5f6G7h8J9k0Z'), j('pass', 'word: ', 'hunter2x'), j('-----BEGIN ', 'OPENSSH PRIVATE', ' KEY-----')]) {
    const hits: string[] = [];
    await assert.rejects(cloudSend('grok-crew', { ...clean, prompt }, { label: 'secret', flags, scan: scanCtx(), env, crewSend, onScan: (h) => hits.push(...h.map((x) => x.type)) }), ScanBlocked);
    assert.ok(hits.length > 0);
  }
  assert.equal(sent.length, 0);
  // A secret-labelled task with a clean payload does pass the label gate under C1.
  await cloudSend('grok-crew', clean2, { label: 'secret', flags, scan: scanCtx(), env, crewSend });
  assert.equal(sent.length, 1);
  // C1 never covers ForgeL/PolishL or DeepSeek.
  await assert.rejects(cloudSend('forgel', clean2, { label: 'secret', flags, scan: scanCtx(), env, crewSend }), SendRefused);
  assert.equal(sent.length, 1);
});

test('deny store unset, unreadable, malformed, or without owner_name hashes: every cloud send is refused', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ao-deny-'));
  try {
    const empty = path.join(dir, 'empty.json');
    writeFileSync(empty, JSON.stringify({ owner_name: [], drive_id: [sha256('x')] }));
    const good = path.join(dir, 'good.json');
    writeFileSync(good, JSON.stringify({ owner_name: [sha256('fake-name')] }));
    const bad = path.join(dir, 'bad.json');
    writeFileSync(bad, '{"owner_name": ["nope"]}');
    assert.equal(loadDenyHashes(undefined), null, 'unset');
    assert.equal(loadDenyHashes(path.join(dir, 'missing.json')), null, 'unreadable');
    assert.equal(loadDenyHashes(bad), null, 'malformed');
    assert.equal(loadDenyHashes(empty), null, 'owner_name empty');
    assert.ok(loadDenyHashes(good));
    for (const deny of [null, emptyDeny(), loadDenyHashes(empty)]) {
      const s = stub();
      const scan = deny ? { ...scanCtx(), deny } : null;
      for (const p of ['groq', 'deepseek', 'nim'] as const) {
        await assert.rejects(cloudSend(p, clean, { label: 'public', flags: flagsOff, scan, env, fetchImpl: s.fetchImpl }), (e) => (e as SendRefused).reason === 'disabled');
      }
      const crew: string[] = [];
      await assert.rejects(cloudSend('forgel', clean, { label: 'public', flags: flagsOff, scan, env, crewSend: async (_t, w) => (crew.push(w), { text: '' }) }), SendRefused);
      assert.equal(s.calls.length + crew.length, 0);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('crew escalations are cloud: scanned the same way, refused when no crew transport exists', async () => {
  await assert.rejects(cloudSend('polishl', clean, { label: 'public', flags: flagsOff, scan: scanCtx(), env }), SendRefused);
  const sent: string[] = [];
  await assert.rejects(cloudSend('forgel', { ...clean, prompt: 'see /home/someone/x' }, { label: 'public', flags: flagsOff, scan: scanCtx(), env, crewSend: async (_t, w) => (sent.push(w), { text: '' }) }), ScanBlocked);
  assert.equal(sent.length, 0);
});
