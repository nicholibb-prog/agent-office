import { FLOOR } from './layout.js';

/**
 * Okkin's loft: a freestanding server island on the open floor south-east of the desk pods, west of
 * the meeting room and north of the loft stairs, its racks facing the desks (-x). It backs onto no
 * wall, so it covers no board, sign or window.
 */
export const OKKIN_LOFT = { minX: 5, maxX: 6.2, minZ: 7, maxZ: 10, rackDepth: 0.8, rackHeight: 2.2 } as const;
/** Where you stand to use the panel: in front of the racks, on open floor. */
export const OKKIN_LOFT_SPOT = { x: 2.1, z: 8.5 } as const;
void FLOOR;
/**
 * The physical controls: a console on a pedestal in front of the racks (between them and where you
 * stand), with the power switch on the left and the model dial on the right, facing the floor (-x).
 */
export const OKKIN_CONSOLE = { x: 4.5, z: 8.5, width: 0.9, depth: 0.4, height: 0.95 } as const;

/**
 * The five models the switch always offers, in dial order (Jack's verified tags). okkin-loft.json
 * can replace them; with no config, these are the stops. A stop that /api/tags doesn't list is shown
 * as 'not installed', never hidden.
 */
export const OKKIN_MODELS = [
  { tag: 'qwen3.5:4b', role: 'quick', bestFor: ['quick', 'summary'] },
  { tag: 'okkin:latest', role: 'default', bestFor: ['open', 'chat'] },
  { tag: 'qwen3.5:9b', role: 'chat', bestFor: ['chat', 'writing'], keep_alive: '10m' },
  { tag: 'ornith-1.5:9b', role: 'code', bestFor: ['code'], num_ctx: 16384, keep_alive: '10m' },
  { tag: 'hf.co/ornith-ai/Ornith-1.5-35B-A3B-GGUF:Q4_K_M', role: 'big', bestFor: ['long', 'reasoning'], keep_alive: 0, minFreeRamGB: 22 },
] as const;

/**
 * A short, readable name for a model tag. Hugging Face ids (hf.co/org/Name-1.5-35B-A3B-GGUF:Q4_K_M)
 * become "Name 35B Q4"; ordinary Ollama tags (qwen3.5:9b, okkin:latest) stay as they are. The full
 * tag always goes in the title and aria-label alongside it.
 */
export function modelShortName(tag: string): string {
  if (!tag.includes('/')) return tag;
  const last = tag.split('/').pop() ?? tag;
  const [rawName = last, quant = ''] = last.split(':');
  const name = rawName.replace(/[-_.]?gguf$/i, '');
  const family = name.split(/[-_]/)[0] || name;
  const size = /(?:^|[-_])(\d+(?:\.\d+)?[BM])(?=$|[-_])/i.exec(name)?.[1]?.toUpperCase() ?? '';
  const q = /^(Q\d+|IQ\d+|BF16|F16|FP16|F32)/i.exec(quant)?.[1]?.toUpperCase() ?? '';
  return [family, size, q].filter(Boolean).join(' ') || tag;
}
