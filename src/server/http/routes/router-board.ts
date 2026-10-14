// GET /api/router/board (funnel #19): today's routing numbers for the office HUD. Owner only, the
// same gate as GET /api/kavi/thread (#60): any bot credential is a logged 403, even alongside an
// owner cookie; then an office session (sessionOnly) and a live owner unlock. A non-owner session
// gets { private: true } and no spend data. Router off (ROUTER_ON unset): { on: false }.
import type http from 'node:http';
import type { Ctx } from '../../office/context.js';
import { send } from '../util.js';
import { sessionOnly } from './bridge.js';
import { botCredential, logOkkinRefusal, okkinCaller } from '../../hq/okkin-owner.js';
import { boardFromLog } from '../../router/board.js';
import { capFromEnv } from '../../router/budget.js';
import { readRouterFlags } from '../../router/flags.js';
import type { Route } from '../router.js';

export const routerBoardRoutes = {
  board: {
    method: 'GET' as const,
    path: '/api/router/board',
    auth: 'public' as const,
    handle(ctx: Ctx, { req, res }: { req: http.IncomingMessage; res: http.ServerResponse }) {
      const bot = botCredential(req);
      if (bot) {
        logOkkinRefusal(ctx.cfg.dataDir, { route: 'GET /api/router/board', caller: bot });
        return send(res, 403, { error: 'owner only' });
      }
      if (!sessionOnly(ctx, req, res)) return;
      if (okkinCaller(req, { touch: false }).kind !== 'owner') return send(res, 200, { private: true });
      if (!readRouterFlags(process.env).routerOn) return send(res, 200, { on: false });
      return send(res, 200, { on: true, ...boardFromLog(ctx.cfg.dataDir, capFromEnv(process.env)) });
    },
  },
} satisfies Record<string, Route>;
