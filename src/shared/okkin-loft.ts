import { FLOOR } from './layout.js';

/**
 * Okkin's loft: a freestanding server island on the open floor south-east of the desk pods, west of
 * the meeting room and north of the loft stairs, its racks facing the desks (-x). It backs onto no
 * wall, so it covers no board, sign or window.
 */
export const OKKIN_LOFT = { minX: 5, maxX: 6.2, minZ: 7, maxZ: 10, rackDepth: 0.8, rackHeight: 2.2 } as const;
/** Where you stand to use the panel: in front of the racks, on open floor. */
export const OKKIN_LOFT_SPOT = { x: 1.1, z: 8.5 } as const;
void FLOOR;
/**
 * The physical controls: a console on a pedestal in front of the racks (between them and where you
 * stand), with the power switch on the left and the model dial on the right, facing the floor (-x).
 */
/**
 * The stone pedestal the supercomputer stands on (0.45 m: a step up, scaled to the office), a little
 * larger than the loft's footprint. Its front face (-x) carries the Paleo-Hebrew engraving.
 */
export const OKKIN_PEDESTAL = { minX: OKKIN_LOFT.minX - 0.05, maxX: OKKIN_LOFT.maxX + 0.05, minZ: OKKIN_LOFT.minZ - 0.05, maxZ: OKKIN_LOFT.maxZ + 0.05, height: 1.1 } as const;
/** The 日光 hanging scroll (kakejiku) on its stand, at the pedestal's north end, facing the floor (-x). */
export const OKKIN_SCROLL = { x: OKKIN_LOFT.minX + 0.25, z: OKKIN_LOFT.minZ - 0.35, width: 0.5, height: 1.6, bottom: 0.55 } as const;
/** The OKKIN sign above it all. */
export const OKKIN_SIGN = { width: 3.4, height: 0.9, y: 5.2 } as const;
/** The console stands on a low stone step (`step`), its top at a comfortable standing height (step + height ≈ 1.05 m). */
export const OKKIN_CONSOLE = { x: 4.5, z: 8.5, width: 0.9, depth: 0.4, height: 0.85, step: 0.2 } as const;
/** That step: from just in front of the console back to the plinth, wide enough for the console and the CRT. */
export const OKKIN_CONSOLE_STEP = { minX: OKKIN_CONSOLE.x - OKKIN_CONSOLE.depth / 2 - 0.25, maxX: OKKIN_PEDESTAL.minX, minZ: OKKIN_CONSOLE.z - 0.75, maxZ: OKKIN_CONSOLE.z + 1.05 } as const;
/** The little CRT on the step beside the console (its centre, and its screen's height). */
export const OKKIN_CRT = { x: OKKIN_CONSOLE.x + 0.05, z: OKKIN_CONSOLE.z + 0.75, y: OKKIN_CONSOLE.step + 0.62, width: 0.42, height: 0.34 } as const;

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

/**
 * One spelling per model, so the dial, /api/tags, /api/ps and benchmarks all match: lower case,
 * ':latest' when no tag is given, 'huggingface.co/' as 'hf.co/', and Ollama's own registry prefix
 * ('registry.ollama.ai/library/') dropped. Display and matching only: the allowlist stays exact.
 */
export function normTag(tag: string): string {
  let t = tag.trim().toLowerCase();
  t = t.replace(/^https?:\/\//, '').replace(/^huggingface\.co\//, 'hf.co/').replace(/^registry\.ollama\.ai\/library\//, '');
  const last = t.split('/').pop() ?? t;
  if (!last.includes(':')) t += ':latest';
  return t;
}
