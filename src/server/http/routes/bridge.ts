import type http from 'node:http';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { appendOutboxItem } from '../../outbox.js';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import type { Ctx } from '../../office/context.js';
import type { ChatLine } from '../../../shared/protocol.js';
import { writeCrewPush } from '../../workers/crew.js';
import { send } from '../util.js';
import { seatForToken } from '../../seat-tokens.js';
import type { Route } from '../router.js';

const BRIDGE_FAILED = 'Bridge failed';

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const ALLOWED_HOSTS = new Set([
  '127.0.0.1:4600',
  '127.0.0.1:5173',
  'localhost:4600',
  'localhost:5173',
]);

const ALLOWED_ORIGINS = new Set([
  'http://127.0.0.1:4600',
  'http://127.0.0.1:5173',
  'http://localhost:4600',
  'http://localhost:5173',
]);

function hostOk(req: http.IncomingMessage): boolean {
  const host = (req.headers.host || '').toLowerCase();
  return ALLOWED_HOSTS.has(host);
}

function originOk(req: http.IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin) return true;
  return ALLOWED_ORIGINS.has(String(origin).toLowerCase());
}

function contentTypeOk(req: http.IncomingMessage): boolean {
  if (req.method !== 'POST') return true;
  const ct = String(req.headers['content-type'] || '').toLowerCase();
  return ct.startsWith('application/json');
}

/** True when the request presents a bridge token. A human session route must reject these. */
export function bridgeCredentialPresent(req: http.IncomingMessage): boolean {
  const hdr = req.headers['x-bridge-token'];
  if (typeof hdr === 'string' && hdr.trim()) return true;
  const auth = req.headers.authorization;
  return typeof auth === 'string' && /^Bearer\s+\S+/i.test(auth);
}

/** Host allowlist, Origin, and JSON content-type. Sends the error response when it fails. */
export function officeRequestShape(req: http.IncomingMessage, res: http.ServerResponse): boolean {
  if (!hostOk(req)) {
    send(res, 403, { error: 'host not allowed' });
    return false;
  }
  if (!originOk(req)) {
    send(res, 403, { error: 'origin not allowed' });
    return false;
  }
  if (!contentTypeOk(req)) {
    send(res, 415, { error: 'Content-Type must be application/json' });
    return false;
  }
  return true;
}

function safeTokenEq(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  try {
    return timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}

function bridgeToken(dataDir: string): string {
  const file = path.join(dataDir, 'bridge-token');
  try {
    if (existsSync(file)) {
      const t = readFileSync(file, 'utf8').trim();
      if (t.length >= 32) return t;
    }
  } catch {
    /* regenerate below */
  }
  mkdirSync(dataDir, { recursive: true });
  const t = randomBytes(32).toString('hex');
  writeFileSync(file, t + '\n', { mode: 0o600 });
  return t;
}

function tokenFromReq(req: http.IncomingMessage): string {
  const hdr = req.headers['x-bridge-token'];
  if (typeof hdr === 'string' && hdr.trim()) return hdr.trim();
  const auth = req.headers.authorization;
  if (typeof auth === 'string' && /^Bearer\s+/i.test(auth)) return auth.replace(/^Bearer\s+/i, '').trim();
  return '';
}

/**
 * Host allowlist, Origin, and JSON Content-Type. Does not look at a bridge token or a session.
 * Approval routes use this and then require a signed-in office session on their own.
 */
export function bridgeShape(req: http.IncomingMessage, res: http.ServerResponse): boolean {
  if (!hostOk(req)) {
    send(res, 403, { error: 'host not allowed' });
    return false;
  }
  if (!originOk(req)) {
    send(res, 403, { error: 'origin not allowed' });
    return false;
  }
  if (!contentTypeOk(req)) {
    send(res, 415, { error: 'Content-Type must be application/json' });
    return false;
  }
  return true;
}

export type BridgeCaller = { kind: 'seat'; seat: string } | { kind: 'shared' } | { kind: 'session' };

/**
 * Who is calling the bridge. A per-seat token names its seat; that is the only bridge identity.
 * The old shared bridge-token is read-only (GET). A presented token that matches nothing is 401
 * even when a session cookie is also present. Sends the error response and returns null on failure.
 */
export function bridgeCaller(ctx: Ctx, req: http.IncomingMessage, res: http.ServerResponse): BridgeCaller | null {
  if (!bridgeShape(req, res)) return null;
  const got = tokenFromReq(req);
  if (got) {
    const seat = seatForToken(ctx.cfg.dataDir, got);
    if (seat) return { kind: 'seat', seat };
    if (safeTokenEq(got, bridgeToken(ctx.cfg.dataDir))) {
      if ((req.method || 'GET') === 'GET') return { kind: 'shared' };
      send(res, 403, { error: 'shared bridge token is read-only; use a seat token' });
      return null;
    }
    send(res, 401, { error: 'bridge token not recognised' });
    return null;
  }
  if (ctx.auth.fromRequest(req) || ctx.auth.fromAnyCookie(req)) return { kind: 'session' };
  send(res, 401, { error: 'bridge token or office session required' });
  return null;
}

/** Bridge auth: Host allowlist + Origin check + (seat token, read-only shared token, or office session). */
export function bridgeGate(ctx: Ctx, req: http.IncomingMessage, res: http.ServerResponse): boolean {
  return bridgeCaller(ctx, req, res) !== null;
}

/** Routes that speak or set presence: a seat token only. Returns the caller's seat. */
function seatGate(ctx: Ctx, req: http.IncomingMessage, res: http.ServerResponse): string | null {
  const c = bridgeCaller(ctx, req, res);
  if (!c) return null;
  if (c.kind !== 'seat') {
    send(res, 403, { error: 'seat token required' });
    return null;
  }
  return c.seat;
}

/** Local HQ bridge: crew bots to office T-chat / presence / feed. */
export const bridgeRoutes = {
  chatRecent: {
    method: 'GET' as const,
    path: '/api/bridge/chat',
    auth: 'public' as const,
    handle(ctx: Ctx, { req, res, url }: { req: http.IncomingMessage; res: http.ServerResponse; url: URL }) {
      if (!bridgeGate(ctx, req, res)) return;
      const n = Math.min(50, Math.max(1, Number(url.searchParams.get('n') || 20) || 20));
      return send(res, 200, { lines: ctx.chat.recent(n) });
    },
  },
  say: {
    method: 'POST' as const,
    path: '/api/bridge/say',
    auth: 'public' as const,
    async handle(ctx: Ctx, { req, res }: { req: http.IncomingMessage; res: http.ServerResponse }) {
      const seat = seatGate(ctx, req, res);
      if (!seat) return;
      let body: { name?: string; text?: string; color?: string };
      try {
        body = JSON.parse(await readBody(req)) as { name?: string; text?: string; color?: string };
      } catch {
        return send(res, 400, { error: 'bad json' });
      }
      // Identity is the token's seat. A body name is allowed only when it is that seat.
      if (body.name !== undefined && String(body.name).trim().toLowerCase() !== seat) {
        return send(res, 403, { error: 'name does not match seat token' });
      }
      const name = seat;
      const text = String(body.text || '').slice(0, 500).trim();
      if (!text) return send(res, 400, { error: 'empty text' });
      // account:true comes only from the authenticated seat token, never from a body name.
      const line: ChatLine = {
        from: 'bridge',
        name,
        account: true,
        color: typeof body.color === 'string' ? body.color.slice(0, 16) : '#8d99ae',
        text,
        at: Date.now(),
      };
      ctx.chat.add(line);
      ctx.broadcast({ t: 'chat', ...line });
      for (const floor of ctx.floors.values()) {
        floor.workers.chatWorking(name, text);
      }
      return send(res, 200, { ok: true, name, text });
    },
  },
  crewStatus: {
    method: 'POST' as const,
    path: '/api/bridge/crew-status',
    auth: 'public' as const,
    async handle(ctx: Ctx, { req, res }: { req: http.IncomingMessage; res: http.ServerResponse }) {
      const seat = seatGate(ctx, req, res);
      if (!seat) return;
      let body: { crew?: Record<string, string> };
      try {
        body = JSON.parse(await readBody(req)) as { crew?: Record<string, string> };
      } catch {
        return send(res, 400, { error: 'bad json' });
      }
      const crew = body.crew || {};
      if (Object.keys(crew).some((k) => k.trim().toLowerCase() !== seat)) {
        return send(res, 403, { error: 'a seat can only set its own status' });
      }
      let file;
      try {
        // Seat ids only; display names never flip a desk. seen is stamped on this push.
        file = writeCrewPush(ctx.cfg.dataDir, crew, 'bridge', Date.now(), seat);
      } catch {
        return send(res, 500, { error: BRIDGE_FAILED });
      }
      const results: { floor: string; applied: string[] }[] = [];
      for (const floor of ctx.floors.values()) {
        const r = floor.workers.applyCrewPresence(file.crew, { seen: file.seen, tokenSeat: seat });
        results.push({ floor: floor.id, applied: r.applied });
      }
      return send(res, 200, { ok: true, updatedAt: file.updatedAt, crew: file.crew, seen: file.seen, source: file.source, results });
    },
  },
  crewStatusGet: {
    method: 'GET' as const,
    path: '/api/bridge/crew-status',
    auth: 'public' as const,
    handle(ctx: Ctx, { req, res }: { req: http.IncomingMessage; res: http.ServerResponse }) {
      if (!bridgeGate(ctx, req, res)) return;
      try {
        const file = path.join(ctx.cfg.dataDir, 'crew-status.json');
        if (!existsSync(file)) return send(res, 200, { crew: {}, updatedAt: null });
        return send(res, 200, JSON.parse(readFileSync(file, 'utf8')));
      } catch {
        return send(res, 500, { error: BRIDGE_FAILED });
      }
    },
  },
  status: {
    method: 'POST' as const,
    path: '/api/bridge/status',
    auth: 'public' as const,
    async handle(ctx: Ctx, { req, res }: { req: http.IncomingMessage; res: http.ServerResponse }) {
      const seat = seatGate(ctx, req, res);
      if (!seat) return;
      let body: { name?: string; status?: string };
      try {
        body = JSON.parse(await readBody(req)) as { name?: string; status?: string };
      } catch {
        return send(res, 400, { error: 'bad json' });
      }
      const st = String(body.status || '').toLowerCase();
      if (body.name !== undefined && String(body.name).trim().toLowerCase() !== seat) {
        return send(res, 403, { error: 'a seat can only set its own status' });
      }
      const name = seat;
      if (st !== 'working' && st !== 'idle') return send(res, 400, { error: 'status working|idle' });
      // The seat comes from the #20 seat token only; a body name never picks the desk.
      let file;
      try {
        file = writeCrewPush(ctx.cfg.dataDir, { [name]: st }, 'bridge-status', Date.now(), seat);
      } catch {
        return send(res, 500, { error: BRIDGE_FAILED });
      }
      const results: { floor: string; applied: string[] }[] = [];
      for (const floor of ctx.floors.values()) {
        results.push({ floor: floor.id, applied: floor.workers.applyCrewPresence(file.crew, { seen: file.seen, tokenSeat: seat }).applied });
      }
      return send(res, 200, { ok: true, name, status: st, results });
    },
  },
  kaviFeed: {
    method: 'POST' as const,
    path: '/api/bridge/kavi-feed',
    auth: 'public' as const,
    async handle(ctx: Ctx, { req, res }: { req: http.IncomingMessage; res: http.ServerResponse }) {
      if (!bridgeGate(ctx, req, res)) return;
      let body: { titles?: { name?: string; id?: string; modifiedTime?: string }[] };
      try {
        body = JSON.parse(await readBody(req)) as typeof body;
      } catch {
        return send(res, 400, { error: 'bad json' });
      }
      const titles = (body.titles || [])
        .map((t) => ({
          name: String(t.name || '').slice(0, 120).trim(),
          id: t.id ? String(t.id).slice(0, 80) : undefined,
          modifiedTime: t.modifiedTime ? String(t.modifiedTime).slice(0, 40) : undefined,
        }))
        .filter((t) => t.name);
      const payload = {
        updatedAt: new Date().toISOString(),
        source: 'bridge',
        allowlist: 'local bridge feed',
        titles,
      };
      try {
        writeFileSync(path.join(ctx.cfg.dataDir, 'kavi-feed.json'), JSON.stringify(payload, null, 2) + '\n', { mode: 0o600 });
      } catch {
        return send(res, 500, { error: BRIDGE_FAILED });
      }
      return send(res, 200, { ok: true, count: titles.length });
    },
  },
  kaviFeedGet: {
    method: 'GET' as const,
    path: '/api/bridge/kavi-feed',
    auth: 'public' as const,
    handle(ctx: Ctx, { req, res }: { req: http.IncomingMessage; res: http.ServerResponse }) {
      if (!bridgeGate(ctx, req, res)) return;
      try {
        const file = path.join(ctx.cfg.dataDir, 'kavi-feed.json');
        if (!existsSync(file)) return send(res, 200, { titles: [], updatedAt: null });
        return send(res, 200, JSON.parse(readFileSync(file, 'utf8')));
      } catch {
        return send(res, 500, { error: BRIDGE_FAILED });
      }
    },
  },
  kaviOutbox: {
    method: 'POST' as const,
    path: '/api/bridge/kavi-outbox',
    auth: 'public' as const,
    async handle(ctx: Ctx, { req, res }: { req: http.IncomingMessage; res: http.ServerResponse }) {
      if (!bridgeGate(ctx, req, res)) return;
      let body: { title?: string; text?: string };
      try {
        body = JSON.parse(await readBody(req)) as typeof body;
      } catch {
        return send(res, 400, { error: 'bad json' });
      }
      const title = String(body.title || 'office-chat').slice(0, 80).trim() || 'office-chat';
      const text = String(body.text || '').slice(0, 4000);
      const file = path.join(ctx.cfg.dataDir, 'kavi-outbox.json');
      try {
        const items = appendOutboxItem(file, { title, text, at: new Date().toISOString() });
        return send(res, 200, { ok: true, queued: items.length });
      } catch {
        return send(res, 500, { error: BRIDGE_FAILED });
      }
    },
  },
  kaviOutboxGet: {
    method: 'GET' as const,
    path: '/api/bridge/kavi-outbox',
    auth: 'public' as const,
    handle(ctx: Ctx, { req, res }: { req: http.IncomingMessage; res: http.ServerResponse }) {
      if (!bridgeGate(ctx, req, res)) return;
      try {
        const file = path.join(ctx.cfg.dataDir, 'kavi-outbox.json');
        if (!existsSync(file)) return send(res, 200, { items: [] });
        return send(res, 200, JSON.parse(readFileSync(file, 'utf8')));
      } catch {
        return send(res, 500, { error: BRIDGE_FAILED });
      }
    },
  },
} satisfies Record<string, Route>;