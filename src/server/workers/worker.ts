// A worker's record as the manager keeps it (see Worker in types.ts): what a new one is called, its
// colour, and the record itself, fresh from hiring or from workers.json.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { WorkerInfo } from '../../shared/protocol.js';
import { providerAdapter } from '../providers/index.js';
import type { UsageTracker } from '../usage.js';
import type { Worker } from './types.js';

export const NAMES = [
  'Pixel', 'Byte', 'Nibble', 'Sprocket', 'Widget', 'Gizmo', 'Bolt', 'Cosmo', 'Dot', 'Echo',
  'Fizz', 'Glitch', 'Hopper', 'Jinx', 'Kilo', 'Lumen', 'Mochi', 'Noodle', 'Orbit', 'Pip',
  'Quark', 'Rivet', 'Sparky', 'Tofu', 'Uno', 'Volt', 'Waffle', 'Zippy',
];
export const COLORS = ['#ff8a5b', '#5bc0eb', '#9bc53d', '#fde74c', '#c3423f', '#b388eb', '#f7aef8', '#72ddf7', '#ffb400', '#00a6a6'];

/** sha256 (hex) of a hook token: what workers.json keeps instead of the token. */
export const hashHookToken = (token: string) => createHash('sha256').update(token, 'utf8').digest('hex');
export const isHookTokenHash = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);

/** Mints a fresh hook token for a launch: the raw one goes to the child, only its hash is kept. */
export function mintHookToken(w: Pick<Worker, 'hookToken' | 'hookTokenHash'>): string {
  const token = randomBytes(32).toString('hex');
  w.hookToken = token;
  w.hookTokenHash = hashHookToken(token);
  return token;
}

/** Does `token` match the worker's current hook token? By hash, in constant time (equal 32-byte buffers). */
export function hookTokenOk(w: Pick<Worker, 'hookTokenHash'>, token: unknown): boolean {
  if (typeof token !== 'string' || !token || !isHookTokenHash(w.hookTokenHash)) return false;
  const want = Buffer.from(w.hookTokenHash, 'hex');
  const got = createHash('sha256').update(token, 'utf8').digest();
  return want.length === got.length && timingSafeEqual(want, got);
}

export function newWorker(info: WorkerInfo, tracker: UsageTracker, hookTokenHash?: string): Worker {
  return {
    info,
    viewers: new Map(),
    screenDirty: true,
    lastLines: [],
    leftNeedsInputAt: 0,
    keyframeAt: 0,
    // No usable token until it is launched (see mintHookToken); restored workers keep only the hash.
    hookTokenHash: isHookTokenHash(hookTokenHash) ? hookTokenHash : hashHookToken(randomBytes(32).toString('hex')),
    state: providerAdapter(info.provider)?.createState?.(),
    failStreak: 0,
    prompts: [],
    tools: [],
    toolsSinceNamed: 0,
    namedAt: 0,
    taskEpoch: 0,
    tracker,
  };
}
