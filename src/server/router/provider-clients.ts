// The cloud provider HTTP clients. ONLY cloud-send.ts may import this file, and no other file may
// name a provider host (tests/router-provider-imports.test.ts fails the build otherwise).
// Keys are read from the env var named by flags.ts at call time; they are never logged or returned.
import type { HttpProvider } from './types.js';

export const PROVIDER_ENDPOINTS: Record<HttpProvider, string> = {
  openrouter: 'https://openrouter.ai/api/v1/chat/completions',
  groq: 'https://api.groq.com/openai/v1/chat/completions',
  nim: 'https://integrate.api.nvidia.com/v1/chat/completions',
  glm: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
  deepseek: 'https://api.deepseek.com/chat/completions',
};

export type ProviderFetch = (url: string, init: { method: 'POST'; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}>;

export interface ProviderReply {
  status: number;
  text: string;
  tokensIn: number;
  tokensOut: number;
  /** Rate-limit headers, lower-cased, for the cap ledger. */
  limits: Record<string, string>;
}

const LIMIT_HEADERS = [
  'x-ratelimit-limit-requests', 'x-ratelimit-remaining-requests', 'x-ratelimit-reset-requests',
  'x-ratelimit-limit-tokens', 'x-ratelimit-remaining-tokens', 'x-ratelimit-reset-tokens',
  'x-ratelimit-limit', 'x-ratelimit-remaining', 'x-ratelimit-reset', 'retry-after',
];
const MAX_REPLY = 1_048_576;

export async function httpChat(provider: HttpProvider, key: string, body: string, fetchImpl: ProviderFetch, timeoutMs = 60_000): Promise<ProviderReply> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(PROVIDER_ENDPOINTS[provider], {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body,
      signal: ctl.signal,
    });
    const raw = (await res.text()).slice(0, MAX_REPLY);
    const limits: Record<string, string> = {};
    for (const h of LIMIT_HEADERS) {
      const v = res.headers.get(h);
      if (v != null && /^[0-9a-zA-Z.:\s-]{1,40}$/.test(v)) limits[h] = v.trim();
    }
    let text = '';
    let tokensIn = 0;
    let tokensOut = 0;
    try {
      const j = JSON.parse(raw) as { choices?: { message?: { content?: unknown } }[]; usage?: { prompt_tokens?: unknown; completion_tokens?: unknown } };
      text = typeof j.choices?.[0]?.message?.content === 'string' ? j.choices[0].message.content : '';
      tokensIn = typeof j.usage?.prompt_tokens === 'number' ? j.usage.prompt_tokens : 0;
      tokensOut = typeof j.usage?.completion_tokens === 'number' ? j.usage.completion_tokens : 0;
    } catch {
      // not JSON: an error page; status says what happened
    }
    return { status: res.status, text, tokensIn, tokensOut, limits };
  } finally {
    clearTimeout(t);
  }
}

export const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models';
export type ListFetch = (url: string, init: { method: 'GET'; signal?: AbortSignal }) => Promise<{ status: number; text(): Promise<string> }>;

/** The live OpenRouter model ids (public list, no key, nothing sent but the request). For #34. */
export async function listOpenRouterModels(fetchImpl: ListFetch, timeoutMs = 15_000): Promise<string[]> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(OPENROUTER_MODELS_URL, { method: 'GET', signal: ctl.signal });
    if (res.status !== 200) return [];
    const j = JSON.parse((await res.text()).slice(0, 4 * MAX_REPLY)) as { data?: { id?: unknown }[] };
    return (j.data ?? []).map((m) => m.id).filter((id): id is string => typeof id === 'string' && /^[\w./:-]{1,128}$/.test(id));
  } catch {
    return [];
  } finally {
    clearTimeout(t);
  }
}
