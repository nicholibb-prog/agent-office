// The one Okkin seat. Status is a probe of local Ollama, not a bridge paint.
// WORKING only while /api/chat is in flight. Switching unloads the previous model first and is not WORKING.
import { randomBytes } from 'node:crypto';
import { modelChoices, modelTagOk, OKKIN_SEAT, type HqLocal, type SeatId, type TalkMessage } from '../../shared/hq.js';
import { chatText, createOllama, ollamaUrlFrom, psView, tagNames, type OllamaClient, type OllamaFetch, type PsState } from '../ollama.js';
import { appendOutbox, appendThread, readThread } from './relay.js';

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

export function okkinSettings(env: { OLLAMA_URL?: string; OKKIN_MODEL?: string; OKKIN_MODEL_ALLOW?: string }, hq: HqLocal) {
  const url = ollamaUrlFrom(env, hq.ollamaUrl);
  const model = (env.OKKIN_MODEL !== undefined && env.OKKIN_MODEL.trim() !== '' ? env.OKKIN_MODEL : hq.okkinModel ?? '').trim();
  const allowRaw = env.OKKIN_MODEL_ALLOW !== undefined && env.OKKIN_MODEL_ALLOW.trim() !== '' ? env.OKKIN_MODEL_ALLOW : (hq.okkinAllow ?? []).join(',');
  const allow = allowRaw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => modelTagOk(s));
  return { url, model, allow };
}

/** Probe /api/tags and /api/ps. Does not mark WORKING. Skips the network while a talk or switch holds the seat. */
export async function probeOkkin(
  env: { OLLAMA_URL?: string; OKKIN_MODEL?: string; OKKIN_MODEL_ALLOW?: string },
  hq: HqLocal,
  fetchImpl?: OllamaFetch,
  opts?: { force?: boolean },
): Promise<OkkinSnapshot> {
  if (busy() && !opts?.force) return okkinSnapshot();
  const settings = okkinSettings(env, hq);
  configured = settings.model;
  if ('refused' in settings.url) {
    refused = settings.url.refused;
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
  const view = psView(await made.client.ps());
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
): Promise<{ status: number; snapshot: OkkinSnapshot; messages: TalkMessage[] }> {
  const at = Date.now();
  const player: TalkMessage = { id: randomBytes(4).toString('hex'), role: 'player', text: text.slice(0, 500).trim(), at };
  if (!player.text) return { status: 400, snapshot: okkinSnapshot(), messages: readThread(dataDir, OKKIN_SEAT) };
  if (busy()) return { status: 409, snapshot: okkinSnapshot(), messages: readThread(dataDir, OKKIN_SEAT) };
  held = true;
  try {
    appendOutbox(dataDir, { kind: 'talk', role: 'player', text: player.text, at, seat: OKKIN_SEAT });
    appendThread(dataDir, OKKIN_SEAT, player);
    const snap = await probeOkkin(env, hq, fetchImpl, { force: true });
    phase?.(chip());
    const model = talkModel(snap);
    if (snap.chip === 'offline' || !model) {
      const why = snap.chip === 'offline' ? 'Okkin is offline' : 'No allowed model is installed';
      appendThread(dataDir, OKKIN_SEAT, { id: randomBytes(4).toString('hex'), role: 'office', text: why, at: Date.now() });
      phase?.(chip());
      return { status: snap.chip === 'offline' ? 503 : 409, snapshot: okkinSnapshot(), messages: readThread(dataDir, OKKIN_SEAT) };
    }
    const settings = okkinSettings(env, hq);
    const made = createOllama('url' in settings.url ? settings.url.url : undefined, fetchOf(fetchImpl));
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
): Promise<{ status: number; error?: string; snapshot: OkkinSnapshot }> {
  if (busy()) return { status: 409, error: 'Okkin is in a request', snapshot: okkinSnapshot() };
  const name = requested.trim();
  held = true;
  try {
    const snap = await probeOkkin(env, hq, fetchImpl, { force: true });
    if (snap.chip === 'offline') return { status: 503, error: 'Okkin is offline', snapshot: snap };
    if (!snap.options.includes(name)) return { status: 400, error: 'model is not an installed allowed tag', snapshot: okkinSnapshot() };
    if (snap.state === 'loaded' && snap.model === name) return { status: 200, snapshot: okkinSnapshot() };
    const settings = okkinSettings(env, hq);
    const made = createOllama('url' in settings.url ? settings.url.url : undefined, fetchOf(fetchImpl));
    if ('refused' in made) return { status: 503, error: made.refused, snapshot: okkinSnapshot() };
    return await runSwitch(made.client, snap.state === 'loaded' ? snap.model : null, name, phase);
  } finally {
    held = false;
  }
}

async function runSwitch(client: OllamaClient, prev: string | null, next: string, phase?: Phase): Promise<{ status: number; error?: string; snapshot: OkkinSnapshot }> {
  switching = true;
  phase?.('switching');
  try {
    if (prev && prev !== next) {
      const unloaded = await client.generate({ model: prev, keep_alive: 0 });
      if (!unloaded.ok) return { status: 502, error: 'could not unload the loaded model', snapshot: finishSwitch() };
    }
    const warmed = await client.generate({ model: next, keep_alive: '10m', prompt: '.' });
    if (!warmed.ok) return { status: 502, error: 'could not load the model', snapshot: finishSwitch() };
    model = next;
    state = 'loaded';
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
}

export function isOkkinSeat(seat: string): seat is typeof OKKIN_SEAT {
  return seat === OKKIN_SEAT;
}

export function seatOrNull(value: string): SeatId | null {
  return value === 'okkin' || /^seat-[1-9]$/.test(value) ? (value as SeatId) : null;
}
