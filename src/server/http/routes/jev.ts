// Local Jev rankings. Signed-in browsers on this machine can read the board and post a metric
// delta or one already-redacted line. This route does not open logs or call out to a network API.
import { openJevStore } from '../../jev/store.js';
import { parseAdd } from '../../../shared/jev.js';
import { readBody, sameOrigin, send } from '../util.js';
import type { Route } from '../router.js';

const ALLOWED = new Set(['agentId', 'displayName', 'deskId', 'add', 'line']);

export const jevRoutes = {
  board: {
    method: 'GET',
    path: '/api/jev',
    auth: 'session',
    handle(ctx, { res }) {
      send(res, 200, openJevStore(ctx.cfg.dataDir).board());
    },
  },
  update: {
    method: 'POST',
    path: '/api/jev',
    auth: 'session',
    async handle(ctx, { req, res }) {
      if (!sameOrigin(req, ctx.cfg)) return send(res, 403, { error: 'Forbidden' });
      let body: unknown;
      try {
        body = JSON.parse(await readBody(req, 16 * 1024));
      } catch (err) {
        return send(res, (err as Error).message === 'too large' ? 413 : 400, { error: 'Bad request' });
      }
      if (!body || typeof body !== 'object' || Array.isArray(body)) return send(res, 400, { error: 'Bad request' });
      const record = body as Record<string, unknown>;
      for (const key of Object.keys(record)) if (!ALLOWED.has(key)) return send(res, 400, { error: 'Unexpected field' });
      const store = openJevStore(ctx.cfg.dataDir);
      if (typeof record.line === 'string') {
        if ('agentId' in record || 'add' in record) return send(res, 400, { error: 'Unexpected field' });
        const result = store.ingest(record.line);
        return result.ok ? send(res, 200, result.board) : send(res, 400, { error: result.reason });
      }
      if (typeof record.agentId !== 'string') return send(res, 400, { error: 'Bad agent' });
      const add = parseAdd(record.add ?? {});
      if (typeof add === 'string') return send(res, 400, { error: add });
      const deskId = record.deskId === null ? null : typeof record.deskId === 'string' ? record.deskId : undefined;
      if ('deskId' in record && deskId === undefined) return send(res, 400, { error: 'Bad desk' });
      if ('displayName' in record && typeof record.displayName !== 'string') return send(res, 400, { error: 'Name rejected' });
      const displayName = typeof record.displayName === 'string' ? record.displayName : undefined;
      const result = store.add({ agentId: record.agentId, displayName, deskId, add });
      return typeof result === 'string' ? send(res, 400, { error: result }) : send(res, 200, result);
    },
  },
} satisfies Record<string, Route>;
