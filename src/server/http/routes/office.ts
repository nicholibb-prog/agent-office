/**
 * Office open/closed and the since-close morning glance (read-only summary).
 * No approve/send/merge actions. Loopback-friendly session routes for the signed-in HUD.
 */
import type http from 'node:http';
import { closedSinceLabel } from '../../../shared/since-close.js';
import type { Ctx } from '../../office/context.js';
import { readSinceClose } from '../../since-close.js';
import { send } from '../util.js';
import type { Route } from '../router.js';

export const officeRoutes = {
  state: {
    method: 'GET' as const,
    path: '/api/office/state',
    auth: 'session' as const,
    handle(ctx: Ctx, { res }: { req: http.IncomingMessage; res: http.ServerResponse }) {
      const st = ctx.officeState.state();
      return send(res, 200, {
        ...st,
        closedSince: st.office === 'closed' ? closedSinceLabel(st.closedAt) : null,
        glanceDismissed: ctx.officeState.glanceDismissed(),
      });
    },
  },
  sinceClose: {
    method: 'GET' as const,
    path: '/api/office/since-close',
    auth: 'session' as const,
    handle(ctx: Ctx, { res }: { req: http.IncomingMessage; res: http.ServerResponse }) {
      return send(res, 200, readSinceClose(ctx.officeState, ctx.cfg.dataDir, ctx.building));
    },
  },
  dismiss: {
    method: 'POST' as const,
    path: '/api/office/since-close/dismiss',
    auth: 'session' as const,
    handle(ctx: Ctx, { res }: { req: http.IncomingMessage; res: http.ServerResponse }) {
      const ok = ctx.officeState.dismissGlance();
      return send(res, 200, { ok, state: ctx.officeState.state() });
    },
  },
  /** Internal close path for tests / owner close without inventing a big HUD control. */
  close: {
    method: 'POST' as const,
    path: '/api/office/close',
    auth: 'session' as const,
    handle(ctx: Ctx, { res }: { req: http.IncomingMessage; res: http.ServerResponse }) {
      const st = ctx.officeState.close('owner');
      return send(res, 200, {
        ...st,
        closedSince: closedSinceLabel(st.closedAt),
      });
    },
  },
} satisfies Record<string, Route>;
