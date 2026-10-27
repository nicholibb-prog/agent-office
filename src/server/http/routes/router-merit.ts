// GET/POST /api/router/merit. Owner only, same gate as the model-use board.
// ROUTER_ON defaults off: the office reports the picker is off and does not assign.
// The body is a class and a kind. It is not a deliverable, and proofs for Okkin,
// DeepSeek, and Jev are not accepted here.
import type http from 'node:http';
import type { Ctx } from '../../office/context.js';
import { send } from '../util.js';
import { sessionOnly } from './bridge.js';
import { BodyTooLarge, closeTooLarge, readJsonBody } from '../read-body.js';
import { botCredential, logOkkinRefusal, okkinCaller } from '../../hq/okkin-owner.js';
import { readRouterFlags } from '../../router/flags.js';
import { OVERSEER_ID, pickMerit, type MeritKind, type PrivacyClass } from '../../router/merit.js';
import { candidatesForHost, recordMerit } from '../../router/merit-crew.js';
import type { Route } from '../router.js';

const KINDS: readonly MeritKind[] = ['research', 'grok-proart', 'high-logic', 'privacy', 'public-bulk', 'general'];
const CLASSES: readonly PrivacyClass[] = ['public', 'grey', 'private', 'secret'];
const KEYS = new Set(['id', 'privacy', 'kind', 'link']);
const LINK = /^https?:\/\/[^\s]{1,180}$/;

function ownerGate(ctx: Ctx, req: http.IncomingMessage, res: http.ServerResponse, route: string): boolean {
  const bot = botCredential(req);
  if (bot) {
    logOkkinRefusal(ctx.cfg.dataDir, { route, caller: bot });
    send(res, 403, { error: 'owner only' });
    return false;
  }
  if (!sessionOnly(ctx, req, res)) return false;
  if (okkinCaller(req, { touch: false }).kind !== 'owner') {
    send(res, 200, { private: true });
    return false;
  }
  return true;
}

function off() {
  return { on: false as const, top: null, overseer: OVERSEER_ID };
}

async function readObject(req: http.IncomingMessage, res: http.ServerResponse): Promise<Record<string, unknown> | undefined> {
  try {
    const body = JSON.parse(await readJsonBody(req)) as unknown;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      send(res, 400, { error: 'bad json' });
      return undefined;
    }
    return body as Record<string, unknown>;
  } catch (err) {
    if (err instanceof BodyTooLarge) closeTooLarge(req, res);
    else if (!res.headersSent) send(res, 400, { error: 'bad json' });
    return undefined;
  }
}

export const routerMeritRoutes = {
  seat: {
    method: 'GET' as const,
    path: '/api/router/merit',
    auth: 'public' as const,
    handle(ctx: Ctx, { req, res }: { req: http.IncomingMessage; res: http.ServerResponse }) {
      if (!ownerGate(ctx, req, res, 'GET /api/router/merit')) return;
      if (!readRouterFlags(process.env).routerOn) return send(res, 200, off());
      const decision = pickMerit({ id: 'seat', privacy: 'public', kind: 'general' }, candidatesForHost(ctx));
      return send(res, 200, {
        on: true,
        top: decision.top,
        overseer: decision.overseer,
        tieBreak: decision.tieBreak,
        scores: decision.scores.map((score) => ({ id: score.id, eligible: score.eligible, score: score.score, presence: score.presence })),
      });
    },
  },
  assign: {
    method: 'POST' as const,
    path: '/api/router/merit',
    auth: 'public' as const,
    async handle(ctx: Ctx, { req, res }: { req: http.IncomingMessage; res: http.ServerResponse }) {
      if (!ownerGate(ctx, req, res, 'POST /api/router/merit')) return;
      const body = await readObject(req, res);
      if (!body) return;
      if (Object.keys(body).some((key) => !KEYS.has(key))) return send(res, 400, { error: 'only id, privacy, kind, and link' });
      if (typeof body.id !== 'string' || !/^[A-Za-z0-9._:-]{1,64}$/.test(body.id)) return send(res, 400, { error: 'bad id' });
      if (typeof body.privacy !== 'string' || !CLASSES.includes(body.privacy as PrivacyClass)) return send(res, 400, { error: 'bad privacy' });
      if (typeof body.kind !== 'string' || !KINDS.includes(body.kind as MeritKind)) return send(res, 400, { error: 'bad kind' });
      if (body.link !== undefined && (typeof body.link !== 'string' || !LINK.test(body.link))) return send(res, 400, { error: 'link must be an http(s) url' });
      if (!readRouterFlags(process.env).routerOn) return send(res, 200, off());
      const decision = pickMerit(
        { id: body.id, privacy: body.privacy as PrivacyClass, kind: body.kind as MeritKind, link: typeof body.link === 'string' ? body.link : undefined },
        candidatesForHost(ctx),
      );
      recordMerit(ctx.cfg.dataDir, decision, body.privacy as PrivacyClass, body.kind as MeritKind);
      return send(res, 200, { on: true, ...decision });
    },
  },
} satisfies Record<string, Route>;
