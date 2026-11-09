// GET /api/ops, GET /api/ops/history, GET /ops. Read-only. Same gate as the router board:
// a bot credential is a logged 403, then an office session. Dollar fields stay on the owner unlock.
import path from 'node:path';
import type http from 'node:http';
import type { Ctx } from '../../office/context.js';
import { serveFile } from '../static.js';
import { send } from '../util.js';
import type { Route } from '../router.js';
import { sessionOnly } from './bridge.js';
import { botCredential, logOkkinRefusal, okkinCaller } from '../../hq/okkin-owner.js';
import { isUsdMetric, stripUsd, type Metric } from '../../../shared/ops.js';
import { historyMetric, opsBag, parseSince, readOpsHistory } from '../../ops/sampler.js';

function guard(ctx: Ctx, req: http.IncomingMessage, res: http.ServerResponse, route: string): 'owner' | 'session' | 'off' | null {
  const bot = botCredential(req);
  if (bot) {
    logOkkinRefusal(ctx.cfg.dataDir, { route, caller: bot });
    send(res, 403, { error: 'owner only' });
    return null;
  }
  if (!sessionOnly(ctx, req, res)) return null;
  if (!opsBag(ctx)) {
    send(res, 200, { on: false });
    return 'off';
  }
  return okkinCaller(req, { touch: false }).kind === 'owner' ? 'owner' : 'session';
}

export const opsRoutes = {
  api: {
    method: 'GET' as const,
    path: '/api/ops',
    auth: 'session' as const,
    handle(ctx: Ctx, { req, res }: { req: http.IncomingMessage; res: http.ServerResponse }) {
      const who = guard(ctx, req, res, 'GET /api/ops');
      if (!who || who === 'off') return;
      const bag = opsBag(ctx);
      const latest = bag?.latest ?? null;
      const periodSec = bag?.periodSec ?? 60;
      const sampledAt = latest?.sampledAt ?? null;
      const stale = sampledAt === null || Date.now() - sampledAt > periodSec * 2 * 1000;
      const tiles = who === 'owner' ? (latest?.tiles ?? {}) : stripUsd(latest?.tiles ?? {});
      return send(res, 200, {
        on: true,
        sampledAt,
        periodSec,
        tiles,
        ...(stale ? { samplerStale: true } : {}),
        ...(who === 'owner' ? {} : { redacted: ['usd'] }),
      });
    },
  },
  history: {
    method: 'GET' as const,
    path: '/api/ops/history',
    auth: 'session' as const,
    handle(ctx: Ctx, { req, res, url }: { req: http.IncomingMessage; res: http.ServerResponse; url: URL }) {
      const who = guard(ctx, req, res, 'GET /api/ops/history');
      if (!who || who === 'off') return;
      const metric = historyMetric(url.searchParams.get('metric'));
      if (!metric) return send(res, 400, { error: 'bad metric' });
      if (who !== 'owner' && isUsdMetric(metric)) return send(res, 200, { metric, private: true });
      const bag = opsBag(ctx);
      const since = parseSince(url.searchParams.get('since'), Date.now(), bag?.historyDays ?? 30);
      if (since === 'bad') return send(res, 400, { error: 'bad since' });
      const points = bag ? readOpsHistory(bag.dataDir, metric as Metric, since, Date.now()) : [];
      return send(res, 200, { metric, points });
    },
  },
  page: {
    method: 'GET' as const,
    path: ['/ops', '/ops.html'],
    auth: 'session' as const,
    handle(ctx: Ctx, { req, res }: { req: http.IncomingMessage; res: http.ServerResponse }) {
      const bot = botCredential(req);
      if (bot) {
        logOkkinRefusal(ctx.cfg.dataDir, { route: 'GET /ops', caller: bot });
        return send(res, 403, { error: 'owner only' });
      }
      return serveFile(res, path.join(ctx.publicDir, 'ops.html'), false);
    },
  },
} satisfies Record<string, Route>;
