// Loopback crew status: Grok Bot (or a poller on this machine) pushes working / idle for a hired desk.
import type { Ctx } from '../../office/context.js';
import { applyCrewStatus, readCrewStatus, remoteBridge } from '../../bridge/status.js';
import { readBody, send } from '../util.js';
import type { Route, RouteRequest } from '../router.js';

const EXAMPLE = 'Send JSON: {"name":"george","status":"working"}';

function workersOf(ctx: Ctx) {
  return [...ctx.floors.values()].flatMap((floor) => floor.workers.list());
}

function floorOf(ctx: Ctx, id: string) {
  return [...ctx.floors.values()].find((floor) => floor.workers.get(id));
}

export const bridgeRoutes = {
  statusGet: {
    method: 'GET',
    path: '/api/bridge/status',
    auth: 'public',
    handle(ctx: Ctx, { req, res }: RouteRequest) {
      if (remoteBridge(req)) return send(res, 403, { error: 'The status bridge only answers on this machine' });
      const workers = [...ctx.floors.values()].flatMap((floor) =>
        floor.workers.list().map((w) => ({ name: w.name, desk: w.deskId, status: w.status, live: floor.workers.live(w.id) })),
      );
      send(res, 200, { ok: true, workers });
    },
  },
  statusPost: {
    method: 'POST',
    path: '/api/bridge/status',
    auth: 'public',
    async handle(ctx: Ctx, { req, res }: RouteRequest) {
      if (remoteBridge(req)) return send(res, 403, { error: 'The status bridge only answers on this machine' });
      let body: unknown;
      try {
        const raw = await readBody(req, 4096);
        body = raw ? JSON.parse(raw) : {};
      } catch {
        return send(res, 400, { error: EXAMPLE });
      }
      const parsed = readCrewStatus(body);
      if ('error' in parsed) return send(res, 400, { error: parsed.error });
      const result = applyCrewStatus(
        workersOf(ctx),
        (id) => floorOf(ctx, id)?.workers.live(id) ?? false,
        parsed,
        (id, status) => floorOf(ctx, id)?.workers.reportStatus(id, status) ?? 'missing',
      );
      if ('error' in result) return send(res, result.code, { error: result.error });
      send(res, 200, result);
    },
  },
} satisfies Record<string, Route>;
