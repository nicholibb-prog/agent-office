// The single gate to every cloud destination (funnel §2, §8; Dan's spec §1). Everything that is not
// Okkin is cloud (C3): HTTP model providers and crew escalations (ForgeL, PolishL, Grok crew) alike.
// Order: label gate -> provider enabled -> presendScan(full wire body) -> send. A hit throws
// ScanBlocked (types only, never values); nothing is redacted and nothing is retried trimmed.
import { httpChat, type ProviderFetch, type ProviderReply } from './provider-clients.js';
import { keyEnvFor, type RouterEnv, type RouterFlags } from './flags.js';
import { denyStoreUsable, presendScan, scanPayload, serialize, type ScanContext } from './presend-scan.js';
import { isCloud, isHttpProvider, type CloudProvider, type CrewProvider, type Label, type ScanHit, type WirePayload } from './types.js';

export type { ProviderReply, ProviderFetch } from './provider-clients.js';

export class ScanBlocked extends Error {
  constructor(readonly hits: ScanHit[]) {
    super(`pre-send scan blocked: ${[...new Set(hits.map((h) => h.type))].join(', ')}`);
    this.name = 'ScanBlocked';
  }
}
export class SendRefused extends Error {
  constructor(readonly reason: 'not-cloud' | 'label' | 'disabled' | 'student-held') {
    super(`cloud send refused: ${reason}`);
    this.name = 'SendRefused';
  }
}

export interface CloudSendDeps {
  label: Label;
  flags: RouterFlags;
  /** null: no usable deny-hash store (unset, unreadable, or no owner_name hashes). All cloud sends are refused. */
  scan: ScanContext | null;
  env?: RouterEnv;
  fetchImpl?: ProviderFetch;
  /** How the office hands a payload to a crew seat (bridge outbox). Absent: crew sends are refused. */
  crewSend?: (to: CrewProvider, wire: string) => Promise<{ text: string }>;
  /** Called with every scan result (hash-only hits) so the router can log it. */
  onScan?: (hits: ScanHit[]) => void;
}

const defaultFetch: ProviderFetch = (url, init) => fetch(url, init) as never;

/**
 * Public data only; DeepSeek and Poolside always public-only. C1 (default OFF) lets a secret-labelled
 * task reach the Grok crew past this label gate only: its payload must still pass the scan.
 */
function labelAllows(provider: CloudProvider, label: Label, flags: RouterFlags): boolean {
  if (label === 'public') return true;
  return label === 'secret' && provider === 'grok-crew' && flags.c1SecretToGrokCrew;
}

export async function cloudSend(provider: CloudProvider, payload: WirePayload, deps: CloudSendDeps): Promise<ProviderReply> {
  if (!isCloud(provider)) throw new SendRefused('not-cloud');
  if (!labelAllows(provider, deps.label, deps.flags)) throw new SendRefused('label');
  // Fail closed: without the owner's deny hashes the scan can't see private literals.
  if (!deps.scan || !denyStoreUsable(deps.scan.deny)) throw new SendRefused('disabled');
  const env = deps.env ?? process.env;
  let key = '';
  if (isHttpProvider(provider)) {
    const name = keyEnvFor(provider, deps.flags);
    key = (name && env[name]?.trim()) || '';
    if (!key) throw new SendRefused('disabled');
  } else if (!deps.crewSend) {
    throw new SendRefused('disabled');
  }
  // Scan the payload and the exact HTTP body that will go on the wire (after templating).
  const body = isHttpProvider(provider) ? JSON.stringify({ model: payload.model, messages: messagesOf(payload) }) : '';
  const scan = deps.scan;
  const first = scanPayload(payload, scan);
  const onWire = body ? presendScan(body, scan) : { ok: true, hits: [] };
  const result = { ok: first.ok && onWire.ok, hits: [...first.hits, ...onWire.hits.filter((h) => !first.hits.some((f) => f.type === h.type && f.sha8 === h.sha8))] };
  deps.onScan?.(result.hits);
  // Every hit blocks, for every destination. C1 relaxes the label gate only, never the scan (Dan).
  if (!result.ok) throw new ScanBlocked(result.hits);
  const wire = serialize(payload);
  if (isHttpProvider(provider)) {
    return httpChat(provider, key, body, deps.fetchImpl ?? defaultFetch);
  }
  const reply = await deps.crewSend!(provider as CrewProvider, wire);
  return { status: 200, text: reply.text, tokensIn: 0, tokensOut: 0, limits: {} };
}

/** The chat messages exactly as scanned: system, carried history, tool results, attachments, prompt. */
function messagesOf(p: WirePayload): { role: string; content: string }[] {
  const out: { role: string; content: string }[] = [];
  if (p.system) out.push({ role: 'system', content: p.system });
  for (const h of p.history ?? []) out.push({ role: 'user', content: `Earlier attempt ${h.attempt} (${h.provider}): ${h.result}${h.log ? `\n${h.log}` : ''}` });
  for (const t of p.toolResults ?? []) out.push({ role: 'user', content: `Tool result:\n${t}` });
  for (const a of p.attachments ?? []) out.push({ role: 'user', content: `Attachment ${a.name}:\n${a.text ?? ''}` });
  out.push({ role: 'user', content: p.prompt });
  return out;
}
