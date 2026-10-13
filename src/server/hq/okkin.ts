// The one Okkin seat. Status is a probe of local Ollama, not a bridge paint.
// WORKING only while /api/chat is in flight. Switching unloads the previous model first and is not WORKING.
import { randomBytes } from 'node:crypto';
import { modelChoices, modelTagOk, offlineQueuedNotice, OKKIN_SEAT, seatDisplayName, type HqLocal, type SeatId, type TalkMessage } from '../../shared/hq.js';
import { chatText, createOllama, psModels, loadOllamaFile, psView, resolveOllamaSettings, tagNames, type OllamaRoutes, type OllamaFetch, type PsState } from '../ollama.js';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { writePrivate } from '../private-file.js';
import { loadLoftConfig, ramAllows } from './okkin-loft.js';

/**
 * Okkin's Ask thread lives in memory only (Dan, loft condition 4): it is never written to the
 * threads file or the outbox, and a restart clears it.
 */
const memThread: TalkMessage[] = [];
const MEM_THREAD_CAP = 80;
function appendThread(_dataDir: string, _seat: string, message: TalkMessage): TalkMessage[] {
  memThread.push(message);
  if (memThread.length > MEM_THREAD_CAP) memThread.splice(0, memThread.length - MEM_THREAD_CAP);
  return [...memThread];
}
function readThread(_dataDir: string, _seat: string): TalkMessage[] {
  return [...memThread];
}
function appendOutbox(..._args: unknown[]): void {
  /* Okkin's talk is not relayed off the box. */
}
export function okkinThread(): TalkMessage[] {
  return [...memThread];
}

/** The only Ollama origins Okkin may call. OLLAMA_HOST is never read; OLLAMA_URL may only name one of these. */
export const OKKIN_OLLAMA_ORIGINS = ['http://127.0.0.1:11434', 'http://[::1]:11434'] as const;

/** Real token speed, from Ollama's own eval_count and eval_duration (ns) on a real reply. Null otherwise. */
export function tokenSpeed(body: unknown): { tokens: number; tokensPerSec: number } | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as { eval_count?: unknown; eval_duration?: unknown };
  const n = typeof b.eval_count === 'number' && Number.isFinite(b.eval_count) ? b.eval_count : NaN;
  const d = typeof b.eval_duration === 'number' && Number.isFinite(b.eval_duration) ? b.eval_duration : NaN;
  if (!(n > 0) || !(d > 0)) return null;
  return { tokens: Math.round(n), tokensPerSec: Math.round((n / (d / 1e9)) * 10) / 10 };
}

export type OkkinJob = { at: number; kind: 'ask'; model: string; ok: boolean; tokens: number | null; tokensPerSec: number | null };
const jobs: OkkinJob[] = [];
let lastSpeed: { tokensPerSec: number; model: string; at: number } | null = null;
export function okkinJobs(): OkkinJob[] {
  return [...jobs];
}
export function okkinLastSpeed() {
  return lastSpeed;
}
function noteJob(job: OkkinJob) {
  jobs.unshift(job);
  if (jobs.length > 12) jobs.length = 12;
  if (job.ok && job.tokensPerSec !== null) lastSpeed = { tokensPerSec: job.tokensPerSec, model: job.model, at: job.at };
}

/** In-flight requests. Okkin takes one at a time (a second is 409), so this is the whole queue. */
export function okkinQueueDepth(): number {
  return depth;
}

const CHOICE_FILE = 'okkin-model.json';
/** The model the loft switch last picked, kept server-side (0600, under the gitignored data dir). */
export function readOkkinChoice(dataDir?: string): string {
  if (!dataDir) return '';
  try {
    const file = path.join(dataDir, CHOICE_FILE);
    if (!existsSync(file)) return '';
    const raw = JSON.parse(readFileSync(file, 'utf8')) as { model?: unknown };
    return typeof raw.model === 'string' && modelTagOk(raw.model) ? raw.model : '';
  } catch {
    return '';
  }
}
export function saveOkkinChoice(dataDir: string, name: string) {
  writePrivate(path.join(dataDir, CHOICE_FILE), JSON.stringify({ model: name }) + '\n');
}


export type OkkinChip = 'offline' | 'idle' | 'working' | 'switching';

export type OkkinSnapshot = {
  seat: typeof OKKIN_SEAT;
  chip: OkkinChip;
  configured: string;
  options: string[];
  /** Model name from /api/ps, or null. Never a raw Ollama document. */
  model: string | null;
  /** State word derived from /api/ps. */
  state: PsState;
};

/** The only Okkin fields a browser receives. */
export function okkinClient(snap: OkkinSnapshot) {
  return {
    seat: snap.seat,
    chip: snap.chip,
    configured: snap.configured,
    options: snap.options,
    model: snap.model,
    state: snap.state,
  };
}

type Phase = (chip: OkkinChip) => void;

let held = false;
let depth = 0;
let switching = false;
let reachable = false;
let configured = '';
let options: string[] = [];
let model: string | null = null;
let state: PsState = 'unknown';
let refused: string | null = null;
let testFetch: OllamaFetch | undefined;
let loadedModels: { name: string; vramMB: number | null }[] = [];
export function okkinLoaded() {
  return reachable ? loadedModels.map((m) => ({ ...m })) : [];
}

function fetchOf(given?: OllamaFetch) {
  return given ?? testFetch;
}

function chip(): OkkinChip {
  if (refused || !reachable) return 'offline';
  if (switching) return 'switching';
  if (depth > 0) return 'working';
  return 'idle';
}

export function okkinSnapshot(): OkkinSnapshot {
  return { seat: OKKIN_SEAT, chip: chip(), configured, options: [...options], model, state };
}

function busy() {
  return held || depth > 0 || switching;
}

export function okkinSettings(env: { OLLAMA_URL?: string; OKKIN_MODEL?: string; OKKIN_MODEL_ALLOW?: string }, hq: HqLocal, dataDir?: string) {
  const resolved = resolveOllamaSettings({ env, file: dataDir ? loadOllamaFile(dataDir) : null });
  const pinned = !resolved.refused && (OKKIN_OLLAMA_ORIGINS as readonly string[]).includes(resolved.url);
  const url = !pinned ? { refused: 'Okkin only talks to Ollama on 127.0.0.1:11434' } : { url: resolved.url };
  const fromEnv = env.OKKIN_MODEL !== undefined && env.OKKIN_MODEL.trim() !== '' ? env.OKKIN_MODEL : '';
  const model = (readOkkinChoice(dataDir) || fromEnv || resolved.model || hq.okkinModel || '').trim();
  const allowRaw = env.OKKIN_MODEL_ALLOW !== undefined && env.OKKIN_MODEL_ALLOW.trim() !== '' ? env.OKKIN_MODEL_ALLOW : (hq.okkinAllow ?? []).join(',');
  const base = allowRaw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => modelTagOk(s));
  // The loft config's model list, when present, is the dial list; an existing allowlist still applies.
  const loft = dataDir ? loadLoftConfig(dataDir) : { models: [], idleSleepMin: null };
  const loftTags = loft.models.map((m) => m.tag);
  const allow = loftTags.length ? (base.length ? loftTags.filter((t) => base.includes(t)) : loftTags) : base;
  return { url, model, allow };
}

/** Probe /api/tags and /api/ps. Does not mark WORKING. Skips the network while a talk or switch holds the seat. */
export async function probeOkkin(
  env: { OLLAMA_URL?: string; OKKIN_MODEL?: string; OKKIN_MODEL_ALLOW?: string },
  hq: HqLocal,
  fetchImpl?: OllamaFetch,
  opts?: { force?: boolean; dataDir?: string },
): Promise<OkkinSnapshot> {
  if (busy() && !opts?.force) return okkinSnapshot();
  const settings = okkinSettings(env, hq, opts?.dataDir);
  configured = settings.model;
  if ('refused' in settings.url) {
    refused = settings.url.refused || 'Ollama URL must be http on 127.0.0.1 or ::1';
    reachable = false;
    options = [];
    model = null;
    state = 'unknown';
    return okkinSnapshot();
  }
  refused = null;
  const made = createOllama(settings.url.url, fetchOf(fetchImpl));
  if ('refused' in made) {
    refused = made.refused;
    reachable = false;
    return okkinSnapshot();
  }
  const tags = await made.client.tags();
  if (!tags.ok) {
    reachable = false;
    options = [];
    model = null;
    state = 'unknown';
    return okkinSnapshot();
  }
  reachable = true;
  options = modelChoices(settings.allow, tagNames(tags.body));
  const psRes = await made.client.ps();
  loadedModels = psModels(psRes);
  const view = psView(psRes);
  model = view.model;
  state = view.state;
  return okkinSnapshot();
}

export async function talkToOkkin(
  dataDir: string,
  env: { OLLAMA_URL?: string; OKKIN_MODEL?: string; OKKIN_MODEL_ALLOW?: string },
  hq: HqLocal,
  text: string,
  fetchImpl?: OllamaFetch,
  phase?: Phase,
  who?: { role: 'player' | 'guest'; by?: string },
): Promise<{ status: number; snapshot: OkkinSnapshot; messages: TalkMessage[] }> {
  const at = Date.now();
  const role = who?.role === 'guest' ? 'guest' : 'player';
  const player: TalkMessage = { id: randomBytes(4).toString('hex'), role, text: text.slice(0, 500).trim(), at, ...(who?.by ? { by: who.by } : {}) };
  if (!player.text) return { status: 400, snapshot: okkinSnapshot(), messages: readThread(dataDir, OKKIN_SEAT) };
  if (busy()) return { status: 409, snapshot: okkinSnapshot(), messages: readThread(dataDir, OKKIN_SEAT) };
  held = true;
  try {
    appendOutbox(dataDir, { kind: 'talk', role, text: player.text, at, seat: OKKIN_SEAT, by: who?.by });
    appendThread(dataDir, OKKIN_SEAT, player);
    const snap = await probeOkkin(env, hq, fetchImpl, { force: true, dataDir });
    phase?.(chip());
    const model = talkModel(snap);
    if (snap.chip === 'offline' || !model) {
      const why = snap.chip === 'offline' ? offlineQueuedNotice(seatDisplayName(OKKIN_SEAT, hq.names)) : 'No allowed model is installed';
      appendThread(dataDir, OKKIN_SEAT, { id: randomBytes(4).toString('hex'), role: 'office', text: why, at: Date.now() });
      phase?.(chip());
      return { status: snap.chip === 'offline' ? 503 : 409, snapshot: okkinSnapshot(), messages: readThread(dataDir, OKKIN_SEAT) };
    }
    const settings = okkinSettings(env, hq, dataDir);
    if (!('url' in settings.url)) {
      phase?.(chip());
      return { status: 503, snapshot: okkinSnapshot(), messages: readThread(dataDir, OKKIN_SEAT) };
    }
    const made = createOllama(settings.url.url, fetchOf(fetchImpl));
    if ('refused' in made) {
      phase?.(chip());
      return { status: 503, snapshot: okkinSnapshot(), messages: readThread(dataDir, OKKIN_SEAT) };
    }
    depth++;
    phase?.('working');
    let reply = '';
    try {
      const history = readThread(dataDir, OKKIN_SEAT)
        .filter((m) => m.role === 'player' || m.role === 'bot')
        .slice(-8)
        .map((m) => ({ role: m.role === 'bot' ? 'assistant' : 'user', content: m.text }));
      const result = await made.client.chat(model, history);
      reply = chatText(result);
      const speed = result.ok ? tokenSpeed(result.body) : null;
      noteJob({ at: Date.now(), kind: 'ask', model, ok: !!reply, tokens: speed?.tokens ?? null, tokensPerSec: speed?.tokensPerSec ?? null });
    } finally {
      depth = Math.max(0, depth - 1);
    }
    if (reply) {
      const bot: TalkMessage = { id: randomBytes(4).toString('hex'), role: 'bot', text: reply, at: Date.now() };
      appendThread(dataDir, OKKIN_SEAT, bot);
      appendOutbox(dataDir, { kind: 'talk', role: 'bot', text: reply, at: bot.at, seat: OKKIN_SEAT });
    } else {
      appendThread(dataDir, OKKIN_SEAT, { id: randomBytes(4).toString('hex'), role: 'office', text: 'Okkin returned no reply', at: Date.now() });
    }
    phase?.(chip());
    return { status: 200, snapshot: okkinSnapshot(), messages: readThread(dataDir, OKKIN_SEAT) };
  } finally {
    held = false;
  }
}

function talkModel(snap: OkkinSnapshot): string | null {
  if (snap.configured && snap.options.includes(snap.configured)) return snap.configured;
  if (snap.state === 'loaded' && snap.model && snap.options.includes(snap.model)) return snap.model;
  return null;
}

/**
 * Switch the one loaded model. The requested name must be allowlist ∩ tags, exact.
 * Unload the previous model before warming the next. The chip stays `switching`, never WORKING.
 */
export async function switchOkkinModel(
  env: { OLLAMA_URL?: string; OKKIN_MODEL?: string; OKKIN_MODEL_ALLOW?: string },
  hq: HqLocal,
  requested: string,
  fetchImpl?: OllamaFetch,
  phase?: Phase,
  dataDir?: string,
): Promise<{ status: number; error?: string; snapshot: OkkinSnapshot }> {
  if (busy()) return { status: 409, error: 'Okkin is in a request', snapshot: okkinSnapshot() };
  const name = requested.trim();
  held = true;
  try {
    const snap = await probeOkkin(env, hq, fetchImpl, { force: true, dataDir });
    if (snap.chip === 'offline') return { status: 503, error: 'power is off', snapshot: snap };
    if (!snap.options.includes(name)) return { status: 400, error: 'model is not an installed allowed tag', snapshot: okkinSnapshot() };
    const loftModel = dataDir ? loadLoftConfig(dataDir).models.find((m) => m.tag === name) : undefined;
    if (!ramAllows(loftModel)) return { status: 409, error: `needs ${loftModel?.minFreeRamGB} GB free RAM`, snapshot: okkinSnapshot() };
    if (snap.state === 'loaded' && snap.model === name) return { status: 200, snapshot: okkinSnapshot() };
    const settings = okkinSettings(env, hq, dataDir);
    if (!('url' in settings.url)) return { status: 503, error: settings.url.refused, snapshot: okkinSnapshot() };
    const made = createOllama(settings.url.url, fetchOf(fetchImpl));
    if ('refused' in made) return { status: 503, error: made.refused, snapshot: okkinSnapshot() };
    return await runSwitch(made.client, snap.state === 'loaded' ? snap.model : null, name, phase, dataDir);
  } finally {
    held = false;
  }
}

async function runSwitch(client: OllamaRoutes, prev: string | null, next: string, phase?: Phase, saveDir?: string): Promise<{ status: number; error?: string; snapshot: OkkinSnapshot }> {
  switching = true;
  phase?.('switching');
  try {
    if (prev && prev !== next) {
      const unloaded = await client.generate({ model: prev, keep_alive: 0 });
      if (!unloaded.ok) return { status: 502, error: 'could not unload the loaded model', snapshot: finishSwitch() };
    }
    const tune = saveDir ? loadLoftConfig(saveDir).models.find((m) => m.tag === next) : undefined;
    const warmed = await client.generate({ model: next, keep_alive: tune?.keep_alive ?? '10m', options: { num_predict: 1, ...(tune?.num_ctx ? { num_ctx: tune.num_ctx } : {}) } });
    if (!warmed.ok) return { status: 502, error: 'could not load the model', snapshot: finishSwitch() };
    model = next;
    state = 'loaded';
    if (saveDir) saveOkkinChoice(saveDir, next);
    configured = next;
    return { status: 200, snapshot: finishSwitch() };
  } finally {
    switching = false;
    phase?.(chip());
  }
}

function finishSwitch(): OkkinSnapshot {
  switching = false;
  return okkinSnapshot();
}

/** Tests inject a fake Ollama. The office never sets this. */
export function setOkkinFetchForTests(fn: OllamaFetch | undefined) {
  testFetch = fn;
}

export function resetOkkinForTests() {
  held = false;
  depth = 0;
  switching = false;
  reachable = false;
  configured = '';
  options = [];
  model = null;
  state = 'unknown';
  refused = null;
  testFetch = undefined;
  memThread.length = 0;
  loadedModels = [];
  jobs.length = 0;
  lastSpeed = null;
}

export function isOkkinSeat(seat: string): seat is typeof OKKIN_SEAT {
  return seat === OKKIN_SEAT;
}

export function seatOrNull(value: string): SeatId | null {
  return value === 'okkin' || /^seat-[1-9]$/.test(value) ? (value as SeatId) : null;
}
