import { actorId, emptyPolicy, type PoolPolicy } from '../../shared/pool.js';
import { poolPath, readPrivate } from './persist.js';

const KEYS = ['approvers', 'lowLevelPosters', 'highLevelPosters', 'crew', 'dan', 'okkin'] as const;

/** The floor's allowlists. A missing file is an empty policy: nobody is allowed. */
export function readPolicy(dataDir: string): PoolPolicy {
  const raw = readPrivate(poolPath(dataDir, 'work-pool-policy.json'));
  const policy = emptyPolicy();
  if (!raw || typeof raw !== 'object') return policy;
  const src = raw as Record<string, unknown>;
  for (const key of KEYS) {
    const list = src[key];
    if (!Array.isArray(list)) continue;
    const ids: string[] = [];
    for (const item of list) {
      const id = actorId(item);
      if (id && !ids.includes(id)) ids.push(id);
      if (ids.length >= 64) break;
    }
    policy[key] = ids;
  }
  return policy;
}
