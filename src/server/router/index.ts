// Production wiring for the router: flags and keys from env, deny hashes from the ProArt store
// (PRESEND_DENY_HASHES_FILE), labels from config/, Okkin via the loopback Ollama client, and every
// cloud send through cloudSend. Fails closed: an unreadable deny-hash file disables all cloud sends.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createOllamaClient } from '../ollama.js';
import { Breaker } from './breaker.js';
import { Budget, FixupTax, capFromEnv } from './budget.js';
import { CapLedger } from './cap-ledger.js';
import { cloudSend, SendRefused } from './cloud-send.js';
import { loadDataClasses } from './data-classes.js';
import { readRouterFlags, type RouterEnv } from './flags.js';
import { OkkinHealth } from './okkin-health.js';
import { loadDenyHashes, parseAllowList, type DenyHashes, type ScanContext } from './presend-scan.js';
import { routingLogger } from './routing-log.js';
import type { Models, RouterAlert, RouterCtx } from './router.js';

export const DEFAULT_MODELS: Models = {
  // Placeholders until Jack's drift check (#34) confirms the live ids; the owner can change any of them.
  openrouter: ['poolside/laguna:free', 'meta-llama/llama-3.3-70b-instruct:free', 'qwen/qwen3-coder:free'],
  groq: 'llama-3.3-70b-versatile',
  nim: 'meta/llama-3.3-70b-instruct',
  glm: 'glm-4.7-flash',
  deepseek: 'deepseek-chat',
  okkin: '',
};

export function loadModels(file = path.resolve('config/router-models.json')): Models {
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as Partial<Models>;
    return { ...DEFAULT_MODELS, ...raw, openrouter: Array.isArray(raw.openrouter) ? raw.openrouter.filter((m) => typeof m === 'string') : DEFAULT_MODELS.openrouter };
  } catch {
    return DEFAULT_MODELS;
  }
}

/** `git cat-file -e` in the public repo, for the HIGH_ENTROPY git-id exemption. */
export function gitObjectExists(repoDir: string) {
  return (sha: string) => {
    if (!/^[0-9a-f]{7,40}$/.test(sha)) return false;
    try {
      execFileSync('git', ['-C', repoDir, 'cat-file', '-e', `${sha}^{object}`], { stdio: 'ignore', timeout: 1000 });
      return true;
    } catch {
      return false;
    }
  };
}

export function createRouterCtx(opts: {
  dataDir: string;
  env?: RouterEnv;
  repoDir?: string;
  alert?: (a: RouterAlert | { kind: string }) => void;
  poweredOn?: () => boolean;
}): { ctx: RouterCtx; health: OkkinHealth } {
  const env = opts.env ?? process.env;
  const flags = readRouterFlags(env);
  let deny: DenyHashes | null;
  try {
    deny = loadDenyHashes(env.PRESEND_DENY_HASHES_FILE);
  } catch {
    deny = null; // unreadable store: fail closed below
  }
  const allow = parseAllowList(readFileSync(path.resolve('config/presend-allow.json'), 'utf8'));
  const scanFor = (): ScanContext => ({ deny: deny!, allow, gitObjectExists: opts.repoDir ? gitObjectExists(opts.repoDir) : undefined });
  const ollama = createOllamaClient({ env: { OLLAMA_URL: env.OLLAMA_URL, OKKIN_MODEL: env.OKKIN_MODEL } });
  const health = new OkkinHealth({ probe: () => ollama.probe(), poweredOn: opts.poweredOn });
  const alert = opts.alert ?? (() => {});
  const models = loadModels();
  const ctx: RouterCtx = {
    classes: loadDataClasses(),
    flags,
    env,
    budget: new Budget({ capUsd: capFromEnv(env), env, dataDir: opts.dataDir, alert }),
    ledger: new CapLedger(Date.now, { openrouterCredit: flags.openrouter }),
    breaker: new Breaker(),
    fixup: new FixupTax(),
    okkinOk: () => health.ok(),
    studentStoreReady: () => !!deny && deny.student.size > 0,
    models: { ...models, okkin: ollama.settings.model ?? '' },
    cloud: async (provider, payload, label) => {
      if (!deny) throw new SendRefused('disabled');
      return cloudSend(provider, payload, { label, flags, scan: scanFor(), env });
    },
    okkin: async (prompt) => {
      const r = await ollama.chat(prompt);
      return r.ok ? { ok: true, text: r.text } : { ok: false, text: '' };
    },
    log: routingLogger(opts.dataDir),
    alert,
  };
  return { ctx, health };
}
