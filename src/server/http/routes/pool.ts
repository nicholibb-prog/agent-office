// Community work pool HTTP. Claimer and approver come from the authenticated caller.
// Owner approval is a human office session only: a bridge token cannot record it.
import type http from 'node:http';
import type { Ctx } from '../../office/context.js';
import type { Session } from '../../auth.js';
import { displayName, type PoolActor, type SeenJob } from '../../../shared/pool.js';
import { readBody, send } from '../util.js';
import type { Route, RouteRequest } from '../router.js';
import { bridgeCredentialPresent, bridgeGate, officeRequestShape } from './bridge.js';
import type { WorkPool } from '../../pool/pool.js';

const BODY_LIMIT = 16_384;
const INTERNAL = 'Internal error';

type FloorPool = { pool: WorkPool };

function floorOf(ctx: Ctx, url: URL): FloorPool | undefined {
  const id = url.searchParams.get('floor');
  if (id) return ctx.floors.get(id);
  return ctx.floors.values().next().value;
}

async function readJson(req: http.IncomingMessage, res: http.ServerResponse): Promise<Record<string, unknown> | undefined> {
  try {
    const raw = await readBody(req, BODY_LIMIT);
    const body = JSON.parse(raw) as unknown;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      send(res, 400, { error: 'bad json' });
      return undefined;
    }
    return body as Record<string, unknown>;
  } catch {
    if (!res.headersSent) send(res, 400, { error: 'bad json' });
    return undefined;
  }
}

function seenOf(body: Record<string, unknown>, res: http.ServerResponse): SeenJob | undefined {
  if (typeof body.state !== 'string' || !body.state) {
    send(res, 400, { error: 'state required' });
    return undefined;
  }
  if (typeof body.updatedAt !== 'number' || !Number.isFinite(body.updatedAt)) {
    send(res, 400, { error: 'updatedAt required' });
    return undefined;
  }
  if (typeof body.hash !== 'string' || !/^[a-f0-9]{64}$/.test(body.hash)) {
    send(res, 400, { error: 'hash required' });
    return undefined;
  }
  return { state: body.state, updatedAt: body.updatedAt, hash: body.hash };
}

/** Bot token if one was sent, otherwise the signed-in account id. Never a body field. */
function actor(ctx: Ctx, req: http.IncomingMessage, pool: WorkPool): { who: PoolActor; admin: boolean } | { error: string } {
  const header = req.headers['x-pool-caller'];
  if (typeof header === 'string' && header.trim()) {
    const who = pool.callerByToken(header.trim());
    if (!who) return { error: 'unknown caller' };
    return { who, admin: false };
  }
  const session = ctx.auth.fromRequest(req);
  const id = session?.account?.id;
  if (!id) return { error: 'caller identity required' };
  return { who: { id, label: displayName(session?.account?.name) || id }, admin: session?.account?.role === 'admin' };
}

function reply(res: http.ServerResponse, result: { ok: true; value: unknown } | { ok: false; status: number; error: string }, pool: WorkPool) {
  if (!result.ok) return send(res, result.status, { error: result.error });
  return send(res, 200, { ok: true, job: result.value, board: pool.board() });
}

async function guard(res: http.ServerResponse, fn: () => Promise<void>) {
  try {
    await fn();
  } catch {
    if (!res.headersSent) send(res, 500, { error: INTERNAL });
  }
}

function gated(ctx: Ctx, req: http.IncomingMessage, res: http.ServerResponse, url: URL): WorkPool | undefined {
  if (!bridgeGate(ctx, req, res)) return undefined;
  const floor = floorOf(ctx, url);
  if (!floor) {
    send(res, 404, { error: 'no floor' });
    return undefined;
  }
  return floor.pool;
}

export const poolRoutes = {
  list: {
    method: 'GET' as const,
    path: '/api/bridge/pool',
    auth: 'public' as const,
    handle(ctx: Ctx, { req, res, url }: RouteRequest) {
      const pool = gated(ctx, req, res, url);
      if (!pool) return;
      return send(res, 200, { board: pool.board() });
    },
  },
  post: {
    method: 'POST' as const,
    path: '/api/bridge/pool',
    auth: 'public' as const,
    handle(ctx: Ctx, { req, res, url }: RouteRequest) {
      return guard(res, async () => {
        const pool = gated(ctx, req, res, url);
        if (!pool) return;
        const body = await readJson(req, res);
        if (!body) return;
        const who = actor(ctx, req, pool);
        if ('error' in who) return send(res, 401, { error: who.error });
        reply(res, pool.post({
          title: body.title,
          body: body.body,
          level: body.level,
          targetBot: body.targetBot,
          tags: body.tags,
          notBefore: body.notBefore,
        }, who.who, { admin: who.admin }), pool);
      });
    },
  },
  claim: {
    method: 'POST' as const,
    path: '/api/bridge/pool/claim',
    auth: 'public' as const,
    handle(ctx: Ctx, { req, res, url }: RouteRequest) {
      return guard(res, async () => {
        const pool = gated(ctx, req, res, url);
        if (!pool) return;
        const body = await readJson(req, res);
        if (!body) return;
        const who = actor(ctx, req, pool);
        if ('error' in who) return send(res, 401, { error: who.error });
        const id = typeof body.id === 'string' ? body.id : '';
        const lease = typeof body.leaseMs === 'number' ? body.leaseMs : undefined;
        reply(res, pool.claim(id, who.who, lease), pool);
      });
    },
  },
  heartbeat: {
    method: 'POST' as const,
    path: '/api/bridge/pool/heartbeat',
    auth: 'public' as const,
    handle(ctx: Ctx, { req, res, url }: RouteRequest) {
      return guard(res, async () => {
        const pool = gated(ctx, req, res, url);
        if (!pool) return;
        const body = await readJson(req, res);
        if (!body) return;
        const who = actor(ctx, req, pool);
        if ('error' in who) return send(res, 401, { error: who.error });
        reply(res, pool.heartbeat(typeof body.id === 'string' ? body.id : '', who.who), pool);
      });
    },
  },
  release: {
    method: 'POST' as const,
    path: '/api/bridge/pool/release',
    auth: 'public' as const,
    handle(ctx: Ctx, { req, res, url }: RouteRequest) {
      return guard(res, async () => {
        const pool = gated(ctx, req, res, url);
        if (!pool) return;
        const body = await readJson(req, res);
        if (!body) return;
        const who = actor(ctx, req, pool);
        if ('error' in who) return send(res, 401, { error: who.error });
        reply(res, pool.release(typeof body.id === 'string' ? body.id : '', who.who), pool);
      });
    },
  },
  complete: {
    method: 'POST' as const,
    path: '/api/bridge/pool/complete',
    auth: 'public' as const,
    handle(ctx: Ctx, { req, res, url }: RouteRequest) {
      return guard(res, async () => {
        const pool = gated(ctx, req, res, url);
        if (!pool) return;
        const body = await readJson(req, res);
        if (!body) return;
        const who = actor(ctx, req, pool);
        if ('error' in who) return send(res, 401, { error: who.error });
        reply(res, pool.complete(typeof body.id === 'string' ? body.id : '', who.who), pool);
      });
    },
  },
  pull: {
    method: 'POST' as const,
    path: '/api/bridge/pool/pull',
    auth: 'public' as const,
    handle(ctx: Ctx, { req, res, url }: RouteRequest) {
      return guard(res, async () => {
        const pool = gated(ctx, req, res, url);
        if (!pool) return;
        const who = actor(ctx, req, pool);
        if ('error' in who) return send(res, 401, { error: who.error });
        reply(res, pool.pull(who.who), pool);
      });
    },
  },
  danPass: {
    method: 'POST' as const,
    path: '/api/bridge/pool/dan-pass',
    auth: 'public' as const,
    handle(ctx: Ctx, { req, res, url }: RouteRequest) {
      return guard(res, async () => {
        const pool = gated(ctx, req, res, url);
        if (!pool) return;
        const body = await readJson(req, res);
        if (!body) return;
        const seen = seenOf(body, res);
        if (!seen) return;
        const who = actor(ctx, req, pool);
        if ('error' in who) return send(res, 401, { error: who.error });
        reply(res, pool.danPass(typeof body.id === 'string' ? body.id : '', who.who, seen), pool);
      });
    },
  },
  /** Register a bot token. Admin office session only, so a bridge token cannot mint an identity. */
  callers: {
    method: 'POST' as const,
    path: '/api/pool/callers',
    auth: 'session' as const,
    handle(ctx: Ctx, { req, res, url, session }: RouteRequest & { session: Session }) {
      return guard(res, async () => {
        if (bridgeCredentialPresent(req)) return send(res, 403, { error: 'human session only' });
        if (!officeRequestShape(req, res)) return;
        if (session.account?.role !== 'admin') return send(res, 403, { error: 'admin session required' });
        const floor = floorOf(ctx, url);
        if (!floor) return send(res, 404, { error: 'no floor' });
        const body = await readJson(req, res);
        if (!body) return;
        const names = ctx.accounts.state(new Set()).accounts.map((a) => a.name);
        const made = floor.pool.registerCaller(body.name, names);
        if ('error' in made) return send(res, 400, { error: made.error });
        return send(res, 200, { ok: true, id: made.id, name: made.name, token: made.token });
      });
    },
  },
  /**
   * Moves a level 6 or 7 job from needs approval to done.
   * Human office session only. x-bridge-token and Bearer are rejected.
   * The approver is the session account, never a body field.
   */
  ownerApproval: {
    method: 'POST' as const,
    path: '/api/pool/owner-yes',
    auth: 'session' as const,
    handle(ctx: Ctx, { req, res, url, session }: RouteRequest & { session: Session }) {
      return guard(res, async () => {
        if (bridgeCredentialPresent(req)) return send(res, 403, { error: 'human session only' });
        if (!officeRequestShape(req, res)) return;
        const floor = floorOf(ctx, url);
        if (!floor) return send(res, 404, { error: 'no floor' });
        const body = await readJson(req, res);
        if (!body) return;
        const seen = seenOf(body, res);
        if (!seen) return;
        if (!session.account?.id) return send(res, 403, { error: 'account required' });
        const approver = { id: session.account.id, label: displayName(session.account.name) || session.account.id };
        reply(res, floor.pool.ownerApproval(typeof body.id === 'string' ? body.id : '', approver, seen), floor.pool);
      });
    },
  },
} satisfies Record<string, Route>;
