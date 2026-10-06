// Unblock queue and morning digest. Same gate as the rest of the bridge: loopback host,
// origin, JSON on POST, and a bridge token or an office session. Yes/No types 1 or 2 into
// the worker. It does not post a chat line and it does not mark anyone working.

import type http from 'node:http';
import type { Ctx } from '../../office/context.js';
import { answerKey, liveFromInfo, type LiveTask, type LiveWorker } from '../../../shared/hq-brief.js';
import { answerBlock, markSeen, readBrief, saveBlocks, saveItems } from '../../hq/brief.js';
import { send, readBody } from '../util.js';
import { bridgeGate } from './bridge.js';
import type { Route } from '../router.js';

function num(v: string | null): number | undefined {
  if (!v) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function snapshot(ctx: Ctx): { workers: LiveWorker[]; tasks: LiveTask[] } {
  const workers: LiveWorker[] = [];
  const tasks: LiveTask[] = [];
  for (const floor of ctx.floors.values()) {
    for (const w of floor.workers.list()) workers.push(liveFromInfo(w));
    for (const t of floor.queue?.state().tasks ?? []) {
      tasks.push({
        id: t.id,
        title: t.title,
        status: t.status,
        addedAt: t.addedAt,
        startedAt: t.startedAt,
        finishedAt: t.finishedAt,
        workerId: t.workerId,
      });
    }
  }
  return { workers, tasks };
}

function findWorker(ctx: Ctx, workerId: string) {
  for (const floor of ctx.floors.values()) {
    if (floor.workers.list().some((w) => w.id === workerId)) return floor;
  }
  return undefined;
}

async function jsonBody(req: http.IncomingMessage, res: http.ServerResponse): Promise<Record<string, unknown> | undefined> {
  try {
    const raw = JSON.parse(await readBody(req)) as unknown;
    if (!raw || typeof raw !== 'object') {
      send(res, 400, { error: 'bad json' });
      return;
    }
    return raw as Record<string, unknown>;
  } catch {
    send(res, 400, { error: 'bad json' });
    return;
  }
}

export const hqBriefRoutes = {
  brief: {
    method: 'GET' as const,
    path: '/api/bridge/hq-brief',
    auth: 'public' as const,
    handle(ctx: Ctx, { req, res, url }: { req: http.IncomingMessage; res: http.ServerResponse; url: URL }) {
      if (!bridgeGate(ctx, req, res)) return;
      const { workers, tasks } = snapshot(ctx);
      return send(res, 200, readBrief(ctx.cfg.dataDir, workers, tasks, num(url.searchParams.get('since')), Date.now()));
    },
  },
  seen: {
    method: 'POST' as const,
    path: '/api/bridge/hq-brief/seen',
    auth: 'public' as const,
    async handle(ctx: Ctx, { req, res }: { req: http.IncomingMessage; res: http.ServerResponse }) {
      if (!bridgeGate(ctx, req, res)) return;
      const body = await jsonBody(req, res);
      if (!body) return;
      const at = typeof body.at === 'number' && Number.isFinite(body.at) ? body.at : Date.now();
      try {
        markSeen(ctx.cfg.dataDir, at);
      } catch (e) {
        return send(res, 500, { error: String(e) });
      }
      return send(res, 200, { ok: true, at });
    },
  },
  needs: {
    method: 'POST' as const,
    path: '/api/bridge/unblock',
    auth: 'public' as const,
    async handle(ctx: Ctx, { req, res }: { req: http.IncomingMessage; res: http.ServerResponse }) {
      if (!bridgeGate(ctx, req, res)) return;
      const body = await jsonBody(req, res);
      if (!body) return;
      if (!Array.isArray(body.blocks)) return send(res, 400, { error: 'blocks array required' });
      try {
        const accepted = saveBlocks(ctx.cfg.dataDir, body.blocks);
        if (body.blocks.length > 0 && accepted === 0) return send(res, 400, { error: 'no actionable blocks' });
        return send(res, 200, { ok: true, accepted });
      } catch (e) {
        return send(res, 500, { error: String(e) });
      }
    },
  },
  board: {
    method: 'POST' as const,
    path: '/api/bridge/board-status',
    auth: 'public' as const,
    async handle(ctx: Ctx, { req, res }: { req: http.IncomingMessage; res: http.ServerResponse }) {
      if (!bridgeGate(ctx, req, res)) return;
      const body = await jsonBody(req, res);
      if (!body) return;
      if (!Array.isArray(body.items)) return send(res, 400, { error: 'items array required' });
      try {
        const accepted = saveItems(ctx.cfg.dataDir, body.items);
        if (body.items.length > 0 && accepted === 0) return send(res, 400, { error: 'no status lines' });
        return send(res, 200, { ok: true, accepted });
      } catch (e) {
        return send(res, 500, { error: String(e) });
      }
    },
  },
  answer: {
    method: 'POST' as const,
    path: '/api/bridge/unblock/answer',
    auth: 'public' as const,
    async handle(ctx: Ctx, { req, res }: { req: http.IncomingMessage; res: http.ServerResponse }) {
      if (!bridgeGate(ctx, req, res)) return;
      const body = await jsonBody(req, res);
      if (!body) return;
      const answer = body.answer === 'yes' || body.answer === 'no' ? body.answer : undefined;
      const id = typeof body.id === 'string' ? body.id.trim() : '';
      const workerId = typeof body.workerId === 'string' ? body.workerId.trim() : '';
      if (!answer || !id) return send(res, 400, { error: 'id and answer yes|no required' });
      let typed = false;
      if (workerId) {
        const floor = findWorker(ctx, workerId);
        if (!floor) return send(res, 404, { error: 'no such worker' });
        floor.workers.write(workerId, answerKey(answer), 'operator');
        typed = true;
      }
      let filed = false;
      try {
        filed = answerBlock(ctx.cfg.dataDir, id, answer, Date.now());
      } catch (e) {
        return send(res, 500, { error: String(e) });
      }
      if (!typed && !filed) return send(res, 404, { error: 'no such block' });
      return send(res, 200, { ok: true, typed, filed, answer });
    },
  },
} satisfies Record<string, Route>;
