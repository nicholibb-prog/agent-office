// A loopback push that sets one hired worker's desk to working or idle. It never hires anyone.
import type http from 'node:http';
import type { WorkerInfo, WorkerStatus } from '../../shared/protocol.js';
import { findWorker } from '../office-workers.js';

export type CrewPush = 'working' | 'idle';

/** The socket is this machine. `::ffff:127.0.0.1` is IPv4 loopback seen on an IPv6 socket. */
export function isLoopback(address: string | undefined): boolean {
  if (!address) return false;
  const ip = address.startsWith('::ffff:') ? address.slice('::ffff:'.length) : address;
  return ip === '127.0.0.1' || ip === '::1';
}

export function readCrewStatus(body: unknown): { name: string; status: CrewPush } | { error: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'Send JSON: {"name":"george","status":"working"}' };
  const name = (body as { name?: unknown }).name;
  const status = (body as { status?: unknown }).status;
  if (typeof name !== 'string' || !name.trim()) return { error: 'name is the worker at the desk' };
  if (name.trim().length > 80) return { error: 'name is too long' };
  if (status !== 'working' && status !== 'idle') return { error: 'status is "working" or "idle"' };
  return { name: name.trim(), status };
}

const PARKED: ReadonlySet<WorkerStatus> = new Set(['offline', 'exited']);

export interface CrewApply {
  ok: true;
  name: string;
  desk: string;
  status: WorkerStatus;
  /** WORKING was set or cleared. */
  changed: boolean;
  /** The worker stays at the desk they were hired to. Working shows them seated there. */
  seated: true;
}

/**
 * Apply one push. `live` is whether a process is actually running at that desk.
 * Working is refused for a parked bot. Idle only asks the caller to clear WORKING.
 * Nobody is hired: a name with no desk is an error, not a new worker.
 */
export function applyCrewStatus(
  workers: WorkerInfo[],
  live: (id: string) => boolean,
  request: { name: string; status: CrewPush },
  set: (id: string, status: CrewPush) => WorkerStatus | 'parked' | 'missing',
): CrewApply | { error: string; code: 404 | 409 } {
  const found = findWorker(workers, request.name);
  if (typeof found === 'string') return { error: found, code: found.startsWith('No worker') ? 404 : 409 };
  const parked = PARKED.has(found.status) || !live(found.id);
  if (request.status === 'working' && parked) {
    return { error: `${found.name} is parked (not running). Status was left as ${found.status}`, code: 409 };
  }
  const before = found.status;
  const status = set(found.id, request.status);
  if (status === 'parked' || status === 'missing') {
    return { error: `${found.name} is parked (not running). Status was left as ${found.status}`, code: 409 };
  }
  return { ok: true, name: found.name, desk: found.deskId, status, changed: status !== before, seated: true };
}

/** True when this connection is from this machine. The bridge has no session cookie. */
export function remoteBridge(req: http.IncomingMessage): boolean {
  return !isLoopback(req.socket.remoteAddress);
}
