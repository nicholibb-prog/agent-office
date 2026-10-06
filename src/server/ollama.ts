// Loopback-only Ollama client. One module for every caller (Okkin and any later seat).
// The address comes from the environment or a gitignored file, never from a request.
// Allowed calls: GET /api/tags, GET /api/ps, POST /api/chat, POST /api/generate.
// pull, delete, create, copy, and push are not implemented. There is no raw proxy.

import { readFileSync } from 'node:fs';
import http from 'node:http';
import { Readable } from 'node:stream';
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

type CappedReader = {
  read(): Promise<{ done: boolean; value?: Uint8Array }>;
  cancel(): Promise<void>;
  releaseLock(): void;
};

/** Reads a response up to 1 MB. A Content-Length over the cap fails before the body is read. */
export async function readCappedResponse(res: {
  headers?: { get(name: string): string | null };
  body?: { getReader(): CappedReader } | null;
  text(): Promise<string>;
}): Promise<string> {
  const declared = Number(res.headers?.get('content-length') ?? '');
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) throw new Error('response too large');
  const reader = res.body?.getReader();
  if (!reader) {
    const text = await res.text();
    if (Buffer.byteLength(text) > MAX_RESPONSE_BYTES) throw new Error('response too large');
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

/** Redirects are not followed. The body is capped, and Content-Length is checked before it is read. */
async function defaultFetch(url: string, init: { method: string; headers?: Record<string, string>; body?: string; signal: AbortSignal; redirect: 'error' }): Promise<{ ok: boolean; status: number; text(): Promise<string> }> {
  const target = new URL(url);
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: target.hostname.replace(/^\[|\]$/g, ''),
        port: target.port,
        path: `${target.pathname}${target.search}`,
        method: init.method,
        headers: init.headers,
        signal: init.signal,
      },
      (res) => {
        const headers = {
          get(name: string) {
            const value = res.headers[name.toLowerCase()];
            if (Array.isArray(value)) return value[0] ?? null;
            return value ?? null;
          },
        };
        readCappedResponse({
          headers,
          body: Readable.toWeb(res) as unknown as { getReader(): CappedReader },
          text: async () => '',
        }).then(
          (text) =>
            resolve({
              ok: (res.statusCode ?? 0) >= 200 && (res.statusCode ?? 0) < 300,
              status: res.statusCode ?? 0,
              text: async () => text,
            }),
          (err) => {
            res.destroy();
            req.destroy();
            reject(err);
          },
        );
      },
    );
    req.on('error', reject);
    if (init.body) req.end(init.body);
    else req.end();
  });
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

export type OllamaResult = { ok: true; status: number; body: unknown } | { ok: false; status: number; error: string };

export type OllamaClient = {
  url: string;
  tags(): Promise<OllamaResult>;
  ps(): Promise<OllamaResult>;
  chat(model: string, messages: { role: string; content: string }[]): Promise<OllamaResult>;
  /** Unload or warm. A warm-up sets num_predict so the prompt cannot run unbounded. */
  generate(body: { model: string; keep_alive: number | string; prompt?: string; options?: { num_predict: number } }): Promise<OllamaResult>;
};

/** Env wins over config. Unset means the loopback default. A non-loopback value is refused, not rewritten. */
export function resolveOllamaUrl(explicit: string | undefined): { url: string } | { refused: string } {
  if (explicit === undefined || explicit.trim() === '') return { url: DEFAULT_OLLAMA_URL };
  const parsed = loopbackOrigin(explicit.trim());
  if (!parsed.ok) return { refused: 'Ollama URL must be http on 127.0.0.1 or ::1' };
  return { url: parsed.origin };
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
      chat: (model, messages) => callRoute('/api/chat', 'POST', { model, messages, stream: false, options: { num_predict: MAX_PREDICT } }),
      generate: (body) =>
        callRoute('/api/generate', 'POST', {
          model: body.model,
          keep_alive: body.keep_alive,
          stream: false,
          ...(body.prompt !== undefined ? { prompt: body.prompt } : {}),
          ...(body.options ? { options: body.options } : {}),
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
