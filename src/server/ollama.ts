// Local model for the meeting room and the front desks. Loopback only.
// The address comes from the environment or .agent-office/ollama.json, never from a request.
// Calls are only GET /api/tags and POST /api/chat or /api/generate. No pull, delete, create, copy, or push.

import { readFileSync } from 'node:fs';
import path from 'node:path';

export const DEFAULT_OLLAMA_URL = 'http://127.0.0.1:11434';
export const PROBE_TIMEOUT_MS = 1500;
export const CHAT_TIMEOUT_MS = 20_000;
export const MAX_PREDICT = 256;
/** Stop reading a local-model response past this. */
export const MAX_RESPONSE_BYTES = 1_048_576;

const ALLOWED_PATHS = new Set(['/api/tags', '/api/chat', '/api/generate']);

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
  // http only. https would be a different stack, and we do not want a redirect to it either.
  if (url.protocol !== 'http:') return { ok: false };
  if (url.username || url.password) return { ok: false };
  // Node reports an IPv6 hostname with brackets (`[::1]`).
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host !== '127.0.0.1' && host !== 'localhost' && host !== '::1') return { ok: false };
  // The setting is an origin. A path would let a URL aim at some other route.
  if (url.pathname !== '/' && url.pathname !== '') return { ok: false };
  if (url.search || url.hash) return { ok: false };
  const port = url.port ? `:${url.port}` : '';
  // localhost is an alias we rewrite. fetch must not ask the OS resolver for it.
  if (host === '::1') return { ok: true, origin: `http://[::1]${port}` };
  return { ok: true, origin: `http://127.0.0.1${port}` };
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

/** Null unless `path` is one of the three routes this office may call. */
export function ollamaEndpoint(origin: string, route: string): string | null {
  if (!origin || !ALLOWED_PATHS.has(route)) return null;
  return origin + route;
}

export interface OllamaHttpResponse {
  ok: boolean;
  status: number;
  headers?: { get(name: string): string | null };
  body?: {
    getReader(): {
      read(): Promise<{ done: boolean; value?: Uint8Array }>;
      cancel(): Promise<void>;
    };
    cancel?(): Promise<void>;
  } | null;
  text(): Promise<string>;
}

export type OllamaFetch = (url: string, init: { method: string; headers?: Record<string, string>; body?: string; signal: AbortSignal; redirect: 'error' }) => Promise<OllamaHttpResponse>;

function declaredLength(res: OllamaHttpResponse): number | null {
  const raw = res.headers?.get('content-length');
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

/** Null when the body is over the cap or cannot be read. Never returns the overflow. */
async function readCapped(res: OllamaHttpResponse): Promise<string | null> {
  const declared = declaredLength(res);
  if (declared !== null && declared > MAX_RESPONSE_BYTES) {
    await res.body?.cancel?.();
    return null;
  }
  const reader = res.body?.getReader?.();
  if (reader) {
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      for (;;) {
        const step = await reader.read();
        if (step.done) break;
        const value = step.value ?? new Uint8Array();
        total += value.byteLength;
        if (total > MAX_RESPONSE_BYTES) {
          await reader.cancel();
          return null;
        }
        chunks.push(value);
      }
    } catch {
      try {
        await reader.cancel();
      } catch {
        /* already closed */
      }
      return null;
    }
    return Buffer.concat(chunks).toString('utf8');
  }
  try {
    const text = await res.text();
    if (Buffer.byteLength(text) > MAX_RESPONSE_BYTES) return null;
    return text;
  } catch {
    return null;
  }
}

async function call(origin: string, route: string, method: 'GET' | 'POST', body: unknown, timeoutMs: number, fetchImpl?: OllamaFetch): Promise<{ ok: boolean; text: string }> {
  const url = ollamaEndpoint(origin, route);
  if (!url) return { ok: false, text: '' };
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  timer.unref?.();
  try {
    const res = await (fetchImpl ?? fetch)(url, {
      method,
      redirect: 'error',
      signal: ac.signal,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await readCapped(res);
    if (text === null || !res.ok) return { ok: false, text: '' };
    return { ok: true, text };
  } catch {
    return { ok: false, text: '' };
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

/**
 * The local-model client another seat can import. Settings come from env and
 * `.agent-office/ollama.json` only. `probe` and `chat` return a state or extracted
 * text, never the HTTP body.
 */
export interface OllamaClient {
  readonly settings: OllamaSettings;
  probe(): Promise<'ready' | 'offline'>;
  chat(content: string): Promise<{ ok: true; text: string } | { ok: false; reason: 'offline' | 'model unset' }>;
}

/** Build the client. A request bag is not a parameter: the address is not taken from one. */
export function createOllamaClient(input: { env?: OllamaEnv; file?: OllamaFile | null; fetchImpl?: OllamaFetch }): OllamaClient {
  const settings = resolveOllamaSettings({ env: input.env, file: input.file });
  return {
    settings,
    probe: () => probeOllama(settings, input.fetchImpl),
    chat: (content) => chatOllama(settings, content, input.fetchImpl),
  };
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
