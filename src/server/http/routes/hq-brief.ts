// Unblock queue and morning digest. Filing blocks and reading the brief use the bridge gate
// (token or session). Answering does not: only a signed-in office session can type 1 or 2,
// and only into the desk the block names while that desk still needs input. A bridge token
// never approves. Nothing here posts a chat line or marks anyone working.

import type http from 'node:http';
import type { Session } from '../../auth.js';
import type { Ctx } from '../../office/context.js';
import type { WorkerInfo } from '../../../shared/protocol.js';
import { answerKey, liveBlock, liveFromInfo, titleHash, type LiveTask, type LiveWorker } from '../../../shared/hq-brief.js';
import { answerBlock, loadBook, markSeen, readBlocks, readBrief, saveBlocks, saveItems } from '../../hq/brief.js';
import { send, readBody } from '../util.js';
import { bridgeGate, bridgeShape } from './bridge.js';
import type { Route } from '../router.js';

const INTERNAL = 'internal error';

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

function locate(ctx: Ctx, workerId: string): { info: WorkerInfo; write(data: string, by: string): void } | undefined {
  for (const floor of ctx.floors.values()) {
    const info = floor.workers.list().find((w) => w.id === workerId);
    if (info) return { info, write: (data, by) => floor.workers.write(info.id, data, by) };
  }
  return undefined;
}

/** A bridge token or a Bearer credential on this route is a bot, not a person tapping Yes. */
function presentedToken(req: http.IncomingMessage): boolean {
  const hdr = req.headers['x-bridge-token'];
  if (typeof hdr === 'string' && hdr.trim()) return true;
  if (Array.isArray(hdr) && hdr.some((h) => h.trim())) return true;
  const auth = req.headers.authorization;
  return typeof auth === 'string' && /^Bearer\s+\S/i.test(auth);
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
      } catch {
        return send(res, 500, { error: INTERNAL });
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
      } catch {
        return send(res, 500, { error: INTERNAL });
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
      } catch {
        return send(res, 500, { error: INTERNAL });
      }
    },
  },
  answer: {
    method: 'POST' as const,
    path: '/api/bridge/unblock/answer',
    auth: 'session' as const,
    async handle(ctx: Ctx, { req, res, session }: { req: http.IncomingMessage; res: http.ServerResponse; session: Session }) {
      if (!bridgeShape(req, res)) return;
      if (presentedToken(req)) return send(res, 403, { error: 'bridge token cannot approve' });
      const body = await jsonBody(req, res);
      if (!body) return;
      const answer = body.answer === 'yes' || body.answer === 'no' ? body.answer : undefined;
      const id = typeof body.id === 'string' ? body.id.trim() : '';
      if (!answer || !id) return send(res, 400, { error: 'id and answer yes|no required' });
      // body.workerId is ignored. The block decides which desk, and only while it still matches.
      const { book } = loadBook(ctx.cfg.dataDir);
      const filed = id.startsWith('live:') ? undefined : readBlocks(ctx.cfg.dataDir, book).find((b) => b.id === id);
      if (!id.startsWith('live:') && !filed) return send(res, 404, { error: 'no such block' });
      if (filed && filed.kind !== 'yesno') return send(res, 409, { error: 'not a yes or no' });
      const workerId = id.startsWith('live:') ? id.slice('live:'.length) : filed?.workerId;
      if (!workerId) return send(res, 409, { error: 'not waiting' });
      const desk = locate(ctx, workerId);
      if (!desk || desk.info.status !== 'needs_input') return send(res, 409, { error: 'not waiting' });
      const live = liveBlock(liveFromInfo(desk.info), book);
      if (!live || live.kind !== 'yesno') return send(res, 409, { error: 'not a yes or no' });
      const at = typeof body.at === 'number' && Number.isFinite(body.at) ? body.at : undefined;
      const hash = typeof body.titleHash === 'string' ? body.titleHash : '';
      if (at !== live.at || hash !== titleHash(live.title)) return send(res, 409, { error: 'stale' });
      const who = session.account?.id ?? '';
      try {
        desk.write(answerKey(answer), who || 'session');
        answerBlock(ctx.cfg.dataDir, id, answer, Date.now(), who);
      } catch {
        return send(res, 500, { error: INTERNAL });
      }
      return send(res, 200, { ok: true, typed: true, answer });
    },
  },
} satisfies Record<string, Route>;
