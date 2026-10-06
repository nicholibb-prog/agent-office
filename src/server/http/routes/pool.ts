// Community work pool HTTP. Claimer and approver come from the authenticated caller.
// Nick yes is a human office session only: a bridge token cannot record it.
import type http from 'node:http';
import type { Ctx } from '../../office/context.js';
import type { Session } from '../../auth.js';
import { displayName, type SeenJob } from '../../../shared/pool.js';
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
  return { state: body.state, updatedAt: body.updatedAt };
}

/** Bot token if one was sent, otherwise the signed-in account. Never a body field. */
function actor(ctx: Ctx, req: http.IncomingMessage, pool: WorkPool): { name: string } | { error: string } {
  const header = req.headers['x-pool-caller'];
  if (typeof header === 'string' && header.trim()) {
    const name = pool.callerName(header.trim());
    if (!name) return { error: 'unknown caller' };
    return { name };
  }
  const session = ctx.auth.fromRequest(req);
  const name = displayName(session?.account?.name);
  if (!name) return { error: 'caller identity required' };
  return { name };
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
        }, who.name), pool);
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
        reply(res, pool.claim(id, who.name, lease), pool);
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
        reply(res, pool.heartbeat(typeof body.id === 'string' ? body.id : '', who.name), pool);
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
        reply(res, pool.release(typeof body.id === 'string' ? body.id : '', who.name), pool);
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
        reply(res, pool.complete(typeof body.id === 'string' ? body.id : '', who.name), pool);
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
        reply(res, pool.pull(who.name), pool);
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
        reply(res, pool.danPass(typeof body.id === 'string' ? body.id : '', who.name, seen), pool);
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
        const made = floor.pool.registerCaller(body.name);
        if ('error' in made) return send(res, 400, { error: made.error });
        return send(res, 200, { ok: true, name: made.name, token: made.token });
      });
    },
  },
  /**
   * Moves a level 6 or 7 job from needs approval to done.
   * Human office session only. x-bridge-token and Bearer are rejected.
   * The approver is the session account, never a body field.
   */
  nickYes: {
    method: 'POST' as const,
    path: '/api/pool/nick-yes',
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
        const approver = displayName(session.account?.name) || 'office';
        reply(res, floor.pool.nickYes(typeof body.id === 'string' ? body.id : '', approver, seen), floor.pool);
      });
    },
  },
} satisfies Record<string, Route>;
