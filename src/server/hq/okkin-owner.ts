// Okkin's controls (power, the model switch, Ask) are the owner's alone, checked here on the server.
//
// The owner is an office ACCOUNT session whose account id is on the work pool's `approvers` list
// (work-pool-policy.json), the same accounts that may give an owner-yes on the pool. A shared-password
// session has no account, so it is NOT the owner: the office has no other way to tell the owner apart.
// Bots, the bridge token, per-seat tokens and any Bearer are read-only: a change from them is 403.
// Each refusal is logged (caller kind, route, time; never a token, cookie or body).
import { appendFileSync, chmodSync } from 'node:fs';
import type http from 'node:http';
import path from 'node:path';
import { readPolicy } from '../pool/policy.js';

export const OKKIN_REFUSALS_LOG = 'okkin-refusals.log';

export type OkkinCaller =
  | { kind: 'owner'; id: string }
  | { kind: 'bridge-token' | 'bearer' | 'shared-password' | 'non-owner-account' | 'no-session' };

type SessionLike = { account?: { id?: string } } | null | undefined;

/** Who is asking, for Okkin's controls. Tokens are checked first: a token never counts as the owner, cookie or not. */
export function okkinCaller(req: http.IncomingMessage, session: SessionLike, dataDir: string): OkkinCaller {
  const hdr = req.headers['x-bridge-token'];
  if (typeof hdr === 'string' && hdr.trim()) return { kind: 'bridge-token' };
  const auth = req.headers.authorization;
  if (typeof auth === 'string' && auth.trim()) return { kind: 'bearer' };
  if (!session) return { kind: 'no-session' };
  const id = session.account?.id;
  if (!id) return { kind: 'shared-password' };
  return readPolicy(dataDir).approvers.includes(id) ? { kind: 'owner', id } : { kind: 'non-owner-account' };
}

export function logOkkinRefusal(dataDir: string, line: { route: string; caller: OkkinCaller['kind'] }, now = Date.now()) {
  const file = path.join(dataDir, OKKIN_REFUSALS_LOG);
  try {
    appendFileSync(file, `${JSON.stringify({ at: new Date(now).toISOString(), route: line.route, caller: line.caller })}\n`, { mode: 0o600 });
    chmodSync(file, 0o600);
  } catch {
    // Logging must never turn a refusal into a crash.
  }
}
