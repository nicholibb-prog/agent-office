// A RouterCtx with every endpoint stubbed: no network, no Ollama on 11434.
import { Breaker } from '../../src/server/router/breaker.js';
import { Budget, FixupTax } from '../../src/server/router/budget.js';
import { CapLedger } from '../../src/server/router/cap-ledger.js';
import { cloudSend } from '../../src/server/router/cloud-send.js';
import { loadDataClasses } from '../../src/server/router/data-classes.js';
import { readRouterFlags, type RouterEnv } from '../../src/server/router/flags.js';
import type { ProviderFetch } from '../../src/server/router/provider-clients.js';
import type { RouterAlert, RouterCtx } from '../../src/server/router/router.js';
import type { RoutingLogEntry } from '../../src/server/router/routing-log.js';
import { j, scanCtx } from './router-fixtures.js';

export const FAKE_KEY = j('test-', 'not-', 'a-key');
/** A Tuesday 10 AM MT: DeepSeek off-peak. */
export const OFF_PEAK = Date.parse('2026-10-13T16:00:00Z');

export function testCtx(over: { env?: RouterEnv; okkinUp?: boolean; okkinOk?: boolean; status?: number[]; now?: () => number; dataDir?: string } = {}) {
  const env: RouterEnv = { GROQ_API_KEY: FAKE_KEY, NVIDIA_API_KEY: FAKE_KEY, GLM_API_KEY: FAKE_KEY, DEEPSEEK_API_KEY: FAKE_KEY, ...over.env };
  const flags = readRouterFlags(env);
  const now = over.now ?? (() => OFF_PEAK);
  const http: { url: string; body: string }[] = [];
  const crew: { to: string; wire: string }[] = [];
  const okkinCalls: string[] = [];
  const logs: Partial<RoutingLogEntry>[] = [];
  const alerts: (RouterAlert | { kind: string })[] = [];
  const statuses = [...(over.status ?? [])];
  const fetchImpl: ProviderFetch = async (url, init) => {
    http.push({ url, body: init.body });
    const status = statuses.length ? statuses.shift()! : 200;
    return { status, headers: { get: () => null }, text: async () => JSON.stringify({ choices: [{ message: { content: status === 200 ? 'cloud reply' : '' } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }) };
  };
  const ctx: RouterCtx = {
    classes: loadDataClasses(),
    flags,
    env,
    budget: new Budget({ capUsd: 3, env, dataDir: over.dataDir, now, alert: (a) => alerts.push(a) }),
    ledger: new CapLedger(now, { openrouterCredit: flags.openrouter }),
    breaker: new Breaker(now),
    fixup: new FixupTax(now),
    okkinOk: () => over.okkinUp ?? true,
    studentStoreReady: () => false,
    models: { openrouter: ['poolside/laguna:free', 'other:free'], groq: 'g', nim: 'n', glm: 'z', deepseek: 'd', okkin: 'okkin-model' },
    cloud: (provider, payload, label) => cloudSend(provider, payload, { label, flags, scan: scanCtx(), env, fetchImpl, crewSend: async (to, wire) => (crew.push({ to, wire }), { text: 'crew reply' }) }),
    okkin: async (prompt) => (okkinCalls.push(prompt), { ok: over.okkinOk ?? true, text: over.okkinOk === false ? '' : 'okkin reply' }),
    log: (e) => logs.push(e),
    alert: (a) => alerts.push(a),
    sleep: async () => {},
    now,
  };
  return { ctx, http, crew, okkinCalls, logs, alerts, cloudCalls: () => http.length + crew.length };
}
