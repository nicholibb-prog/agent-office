import { actorId, displayName, emptyPolicy, type PoolPolicy } from '../../shared/pool.js';
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
  const names = src.reservedNames;
  if (Array.isArray(names)) {
    const reserved: string[] = [];
    for (const item of names) {
      const shown = displayName(item);
      if (shown && !reserved.includes(shown)) reserved.push(shown);
      if (reserved.length >= 64) break;
    }
    policy.reservedNames = reserved;
  }
  return policy;
}
