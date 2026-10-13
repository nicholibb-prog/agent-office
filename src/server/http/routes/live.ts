// Live desk-screen feed over the existing office server (see live-frames.ts for the rules).
// Push: seat token only, seat taken from the token. View / switch on: signed-in office session
// plus the bridge Host and Origin checks. Frames are never written to disk or logged.
import type http from 'node:http';
import type { Ctx } from '../../office/context.js';
import { liveFrames, LIVE_MAX_BYTES, type LiveFrames } from '../../live-frames.js';
import { readBody, send } from '../util.js';
import { bridgeShape, seatGate } from './bridge.js';
import type { Route } from '../router.js';

type R = { req: http.IncomingMessage; res: http.ServerResponse; path?: string };

function sessionGate(ctx: Ctx, req: http.IncomingMessage, res: http.ServerResponse): boolean {
  if (!bridgeShape(req, res)) return false;
  if (req.headers['x-bridge-token'] || /^Bearer\s/i.test(String(req.headers.authorization || ''))) {
    send(res, 403, { error: 'office session only' });
    return false;
  }
  if (!ctx.auth.fromRequest(req)) {
    send(res, 401, { error: 'office session required' });
    return false;
  }
  return true;
}

export function liveRoutesFor(store: LiveFrames) {
  return {
    push: {
      method: 'POST' as const,
      path: '/api/bridge/live-frame',
      auth: 'public' as const,
      async handle(ctx: Ctx, { req, res }: R) {
        const seat = seatGate(ctx, req, res);
        if (!seat) return;
        let body: { mime?: string; data?: string };
        try {
          body = JSON.parse(await readBody(req, Math.ceil(LIVE_MAX_BYTES * 1.37) + 1024)) as typeof body;
        } catch (e) {
          return send(res, (e as Error).message === 'too large' ? 413 : 400, { error: (e as Error).message === 'too large' ? 'frame too large' : 'bad json' });
        }
        const bytes = Buffer.from(String(body.data || ''), 'base64');
        const r = store.push(seat, String(body.mime || ''), bytes);
        if (!r.ok) return send(res, r.status, { error: r.error });
        return send(res, 200, { ok: true, seat });
      },
    },
    seats: {
      method: 'GET' as const,
      path: '/api/live/seats',
      auth: 'public' as const,
      handle(ctx: Ctx, { req, res }: R) {
        if (!sessionGate(ctx, req, res)) return;
        return send(res, 200, { seats: store.list() });
      },
    },
    toggle: {
      method: 'POST' as const,
      path: '/api/live/seat',
      auth: 'public' as const,
      async handle(ctx: Ctx, { req, res }: R) {
        if (!sessionGate(ctx, req, res)) return;
        let body: { seat?: string; on?: boolean };
        try {
          body = JSON.parse(await readBody(req, 4096)) as typeof body;
        } catch {
          return send(res, 400, { error: 'bad json' });
        }
        if (!store.setEnabled(String(body.seat || ''), body.on === true)) return send(res, 400, { error: 'bad seat' });
        return send(res, 200, { ok: true, seats: store.list() });
      },
    },
    frame: {
      method: 'GET' as const,
      prefix: '/api/live/frame/',
      auth: 'public' as const,
      handle(ctx: Ctx, { req, res, path }: R) {
        if (!sessionGate(ctx, req, res)) return;
        const seat = decodeURIComponent(String(path ?? req.url ?? '').split('?')[0].replace(/^.*\/api\/live\/frame\//, '')).toLowerCase();
        const f = store.frame(seat);
        if (!f) return send(res, 404, { error: 'no live feed' });
        res.writeHead(200, { 'content-type': f.mime, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'x-frame-at': String(f.at) });
        res.end(f.bytes);
      },
    },
  } satisfies Record<string, Route>;
}

export const liveRoutes = liveRoutesFor(liveFrames);
