// GET /api/router/board (funnel #19): today's routing numbers for the office HUD. Office session
// only; any bot credential is refused and logged. Counts and provider names only, never task text.
import type http from 'node:http';
import type { Ctx } from '../../office/context.js';
import { send } from '../util.js';
import { sessionOnly } from './bridge.js';
import { botCredential, logOkkinRefusal } from '../../hq/okkin-owner.js';
import { boardFromLog } from '../../router/board.js';
import { capFromEnv } from '../../router/budget.js';
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
        return send(res, 403, { error: 'office session only' });
      }
      if (!sessionOnly(ctx, req, res)) return;
      return send(res, 200, boardFromLog(ctx.cfg.dataDir, capFromEnv(process.env)));
    },
  },
} satisfies Record<string, Route>;
