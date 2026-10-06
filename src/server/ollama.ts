// Loopback-only Ollama client. One module for every caller (Okkin and any later seat).
// The address comes from the environment or a gitignored file, never from a request.
// Allowed calls: GET /api/tags, GET /api/ps, POST /api/chat, POST /api/generate.
// pull, delete, create, copy, and push are not implemented. There is no raw proxy.

import { readFileSync } from 'node:fs';
import path from 'node:path';

export const DEFAULT_OLLAMA_URL = 'http://127.0.0.1:11434';
export const PROBE_TIMEOUT_MS = 1500;
export const CHAT_TIMEOUT_MS = 20_000;
export const MAX_PREDICT = 256;

const ALLOWED_PATHS = new Set(['/api/tags', '/api/ps', '/api/chat', '/api/generate']);
/** A response larger than this is dropped. The body is read as a stream and cancelled past the cap. */
const MAX_RESPONSE_BYTES = 1024 * 1024;

export interface OllamaSettings {
  /** Origin, or empty when the configured URL was refused. */
  url: string;
  /** Unset until OKKIN_MODEL or ollama.json says. Never invented. */
  model: string | null;
  /** The configured URL was not loopback. The provider does not start. */
  refused: boolean;
}

export interface OllamaEnv {
  OLLAMA_URL?: string;
  OKKIN_MODEL?: string;
}

export interface OllamaFile {
  url?: string;
  model?: string;
}

/** A bag a request might carry. These fields are not read. */
export interface OllamaRequestBag {
  url?: string;
  model?: string;
  OLLAMA_URL?: string;
  OKKIN_MODEL?: string;
}

export function loopbackOrigin(raw: string): { ok: true; origin: string } | { ok: false } {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false };
  }
  // http only. https would send the prompt through a TLS stack we do not pin.
  if (url.protocol !== 'http:') return { ok: false };
  if (url.username || url.password) return { ok: false };
  // Node reports an IPv6 hostname with brackets (`[::1]`).
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  // `localhost` is rewritten to the IPv4 literal so the OS resolver is never asked.
  const literal = host === 'localhost' ? '127.0.0.1' : host;
  if (literal !== '127.0.0.1' && literal !== '::1') return { ok: false };
  // The setting is an origin. A path would let a URL aim at some other route.
  if (url.pathname !== '/' && url.pathname !== '') return { ok: false };
  if (url.search || url.hash) return { ok: false };
  const port = url.port ? `:${url.port}` : '';
  const origin = literal === '::1' ? `http://[::1]${port}` : `http://127.0.0.1${port}`;
  return { ok: true, origin };
}

/**
 * Env wins over the file, and the file wins over the default origin.
 * `request` is accepted so callers can pass a message through and tests can see it is ignored.
 */
export function resolveOllamaSettings(input: { env?: OllamaEnv; file?: OllamaFile | null; request?: OllamaRequestBag }): OllamaSettings {
  const envUrl = input.env?.OLLAMA_URL?.trim();
  const fileUrl = input.file?.url?.trim();
  const raw = envUrl || fileUrl || DEFAULT_OLLAMA_URL;
  const parsed = loopbackOrigin(raw);
  const model = input.env?.OKKIN_MODEL?.trim() || input.file?.model?.trim() || null;
  if (!parsed.ok) return { url: '', model, refused: true };
  return { url: parsed.origin, model: model || null, refused: false };
}

export function loadOllamaFile(dataDir: string): OllamaFile | null {
  try {
    const raw = JSON.parse(readFileSync(path.join(dataDir, 'ollama.json'), 'utf8')) as { url?: unknown; model?: unknown };
    return {
      url: typeof raw.url === 'string' ? raw.url : undefined,
      model: typeof raw.model === 'string' ? raw.model : undefined,
    };
  } catch {
    return null;
  }
}

/** Null unless `route` is one of the routes this office may call. */
export function ollamaEndpoint(origin: string, route: string): string | null {
  if (!origin || !ALLOWED_PATHS.has(route)) return null;
  return origin + route;
}

export type OllamaFetch = (
  url: string,
  init: { method: string; headers?: Record<string, string>; body?: string; signal: AbortSignal; redirect: 'error' },
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

async function readCapped(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) {
    const text = await res.text();
    if (text.length > MAX_RESPONSE_BYTES) throw new Error('response too large');
    return text;
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  let tooBig = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.byteLength) continue;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        tooBig = true;
        break;
      }
      chunks.push(value);
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      /* the stream may already be closed */
    }
    try {
      reader.releaseLock();
    } catch {
      /* cancel already released it */
    }
  }
  if (tooBig) throw new Error('response too large');
  const buf = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    buf.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(buf);
}

/** Redirects are an error. The body is capped so a stream cannot grow without a bound. */
async function defaultFetch(url: string, init: { method: string; headers?: Record<string, string>; body?: string; signal: AbortSignal; redirect: 'error' }): Promise<{ ok: boolean; status: number; text(): Promise<string> }> {
  const res = await fetch(url, { method: init.method, headers: init.headers, body: init.body, signal: init.signal, redirect: 'error' });
  const text = await readCapped(res);
  return { ok: res.ok, status: res.status, text: async () => text };
}

async function call(origin: string, route: string, method: 'GET' | 'POST', body: unknown, timeoutMs: number, fetchImpl?: OllamaFetch): Promise<{ ok: boolean; status: number; text: string }> {
  const url = ollamaEndpoint(origin, route);
  if (!url) return { ok: false, status: 403, text: '' };
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  timer.unref?.();
  try {
    const res = await (fetchImpl ?? defaultFetch)(url, {
      method,
      signal: ac.signal,
      redirect: 'error',
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { ok: res.ok, status: res.status, text: await res.text() };
  } catch {
    return { ok: false, status: 0, text: '' };
  } finally {
    clearTimeout(timer);
  }
}

export async function probeOllama(settings: OllamaSettings, fetchImpl?: OllamaFetch): Promise<'ready' | 'offline'> {
  if (settings.refused || !settings.url) return 'offline';
  const res = await call(settings.url, '/api/tags', 'GET', undefined, PROBE_TIMEOUT_MS, fetchImpl);
  if (!res.ok) return 'offline';
  try {
    const json = JSON.parse(res.text) as { models?: unknown };
    if (!json || !Array.isArray(json.models)) return 'offline';
  } catch {
    return 'offline';
  }
  return 'ready';
}

export async function chatOllama(
  settings: OllamaSettings,
  content: string,
  fetchImpl?: OllamaFetch,
): Promise<{ ok: true; text: string } | { ok: false; reason: 'offline' | 'model unset' }> {
  if (settings.refused || !settings.url) return { ok: false, reason: 'offline' };
  if (!settings.model) return { ok: false, reason: 'model unset' };
  const res = await call(
    settings.url,
    '/api/chat',
    'POST',
    {
      model: settings.model,
      messages: [{ role: 'user', content: content.slice(0, 4000) }],
      stream: false,
      options: { num_predict: MAX_PREDICT },
    },
    CHAT_TIMEOUT_MS,
    fetchImpl,
  );
  if (!res.ok) return { ok: false, reason: 'offline' };
  try {
    const json = JSON.parse(res.text) as { message?: { content?: unknown } };
    const text = typeof json.message?.content === 'string' ? json.message.content.trim() : '';
    if (!text) return { ok: false, reason: 'offline' };
    return { ok: true, text: text.slice(0, 4000) };
  } catch {
    return { ok: false, reason: 'offline' };
  }
}

export type OllamaResult = { ok: true; status: number; body: unknown } | { ok: false; status: number; error: string };

export type OllamaClient = {
  url: string;
  tags(): Promise<OllamaResult>;
  ps(): Promise<OllamaResult>;
  chat(model: string, messages: { role: string; content: string }[]): Promise<OllamaResult>;
  /** Unload or warm. Callers only pass model, keep_alive, and an optional warm prompt. */
  generate(body: { model: string; keep_alive: number | string; prompt?: string }): Promise<OllamaResult>;
};

/** Env wins over config. Unset means the loopback default. A non-loopback value is refused, not rewritten. */
export function resolveOllamaUrl(explicit: string | undefined): { url: string } | { refused: string } {
  if (explicit === undefined || explicit.trim() === '') return { url: DEFAULT_OLLAMA_URL };
  const parsed = loopbackOrigin(explicit.trim());
  if (!parsed.ok) return { refused: 'Ollama URL must be http on 127.0.0.1 or ::1' };
  return { url: parsed.origin };
}

export function ollamaUrlFrom(env: { OLLAMA_URL?: string }, configured: string | undefined): { url: string } | { refused: string } {
  const fromEnv = env.OLLAMA_URL;
  const explicit = fromEnv !== undefined && fromEnv.trim() !== '' ? fromEnv : configured;
  return resolveOllamaUrl(explicit);
}

async function requestJson(origin: string, route: string, method: 'GET' | 'POST', body: unknown, fetchImpl?: OllamaFetch): Promise<OllamaResult> {
  const res = await call(origin, route, method, body, CHAT_TIMEOUT_MS, fetchImpl);
  if (!res.ok && !res.text) {
    if (!ollamaEndpoint(origin, route)) return { ok: false, status: 403, error: 'path not allowed' };
    return { ok: false, status: res.status, error: 'ollama unreachable' };
  }
  let parsed: unknown = null;
  if (res.text) {
    try {
      parsed = JSON.parse(res.text);
    } catch {
      parsed = null;
    }
  }
  if (!res.ok) return { ok: false, status: res.status, error: 'ollama request failed' };
  return { ok: true, status: res.status, body: parsed };
}

export function createOllama(explicit: string | undefined, fetchImpl?: OllamaFetch): { client: OllamaClient } | { refused: string } {
  const resolved = resolveOllamaUrl(explicit);
  if ('refused' in resolved) return resolved;
  const callRoute = (route: string, method: 'GET' | 'POST', body?: unknown) => requestJson(resolved.url, route, method, body, fetchImpl);
  return {
    client: {
      url: resolved.url,
      tags: () => callRoute('/api/tags', 'GET'),
      ps: () => callRoute('/api/ps', 'GET'),
      chat: (model, messages) => callRoute('/api/chat', 'POST', { model, messages, stream: false }),
      generate: (body) =>
        callRoute('/api/generate', 'POST', {
          model: body.model,
          keep_alive: body.keep_alive,
          stream: false,
          ...(body.prompt !== undefined ? { prompt: body.prompt } : {}),
        }),
    },
  };
}

export function tagNames(body: unknown): string[] {
  const models = body && typeof body === 'object' ? (body as { models?: unknown }).models : undefined;
  if (!Array.isArray(models)) return [];
  const out: string[] = [];
  for (const row of models) {
    if (!row || typeof row !== 'object') continue;
    const name = (row as { name?: unknown; model?: unknown }).name ?? (row as { model?: unknown }).model;
    if (typeof name === 'string' && name.trim()) out.push(name.trim());
  }
  return out;
}

export type PsState = 'loaded' | 'unloaded' | 'unknown';

/**
 * What a browser may see of /api/ps: the loaded model name and a state word.
 * Size, digest, expiry, and the rest of the Ollama body stay here.
 */
export function psView(result: OllamaResult): { model: string | null; state: PsState } {
  if (!result.ok) return { model: null, state: 'unknown' };
  const names = tagNames(result.body);
  if (!names.length) return { model: null, state: 'unloaded' };
  return { model: names[0] ?? null, state: 'loaded' };
}

export function chatText(result: OllamaResult): string {
  if (!result.ok || !result.body || typeof result.body !== 'object') return '';
  const message = (result.body as { message?: { content?: unknown } }).message;
  const content = message && typeof message.content === 'string' ? message.content : (result.body as { response?: unknown }).response;
  return typeof content === 'string' ? content.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 500) : '';
}
