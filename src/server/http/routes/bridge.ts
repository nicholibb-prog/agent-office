import type http from 'node:http';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import type { Ctx } from '../../office/context.js';
import type { ChatLine } from '../../../shared/protocol.js';
import { send } from '../util.js';
import type { Route } from '../router.js';

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

/** Bridge auth: Host allowlist + Origin check + (token OR office session). Loopback alone is not enough. */
export function bridgeGate(ctx: Ctx, req: http.IncomingMessage, res: http.ServerResponse): boolean {
  if (!bridgeShape(req, res)) return false;
  const expected = bridgeToken(ctx.cfg.dataDir);
  const got = tokenFromReq(req);
  if (got && safeTokenEq(got, expected)) return true;
  if (ctx.auth.fromRequest(req) || ctx.auth.fromAnyCookie(req)) return true;
  send(res, 401, { error: 'bridge token or office session required' });
  return false;
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
      if (!bridgeGate(ctx, req, res)) return;
      let body: { name?: string; text?: string; color?: string };
      try {
        body = JSON.parse(await readBody(req)) as { name?: string; text?: string; color?: string };
      } catch {
        return send(res, 400, { error: 'bad json' });
      }
      const name = String(body.name || 'agent').slice(0, 32).trim() || 'agent';
      const text = String(body.text || '').slice(0, 500).trim();
      if (!text) return send(res, 400, { error: 'empty text' });
      const line: ChatLine = {
        from: 'bridge',
        name,
        color: typeof body.color === 'string' ? body.color.slice(0, 16) : '#8d99ae',
        text,
        at: Date.now(),
        account: true,
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
      if (!bridgeGate(ctx, req, res)) return;
      let body: { crew?: Record<string, string> };
      try {
        body = JSON.parse(await readBody(req)) as { crew?: Record<string, string> };
      } catch {
        return send(res, 400, { error: 'bad json' });
      }
      const crew = body.crew || {};
      const payload = { updatedAt: new Date().toISOString(), crew, source: 'bridge' };
      try {
        const file = path.join(ctx.cfg.dataDir, 'crew-status.json');
        writeFileSync(file, JSON.stringify(payload, null, 2) + '\n', { mode: 0o600 });
      } catch (e) {
        return send(res, 500, { error: String(e) });
      }
      const results: { floor: string; applied: string[] }[] = [];
      for (const floor of ctx.floors.values()) {
        const r = floor.workers.applyCrewPresence(crew);
        results.push({ floor: floor.id, applied: r.applied });
      }
      return send(res, 200, { ok: true, ...payload, results });
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
      } catch (e) {
        return send(res, 500, { error: String(e) });
      }
    },
  },
  status: {
    method: 'POST' as const,
    path: '/api/bridge/status',
    auth: 'public' as const,
    async handle(ctx: Ctx, { req, res }: { req: http.IncomingMessage; res: http.ServerResponse }) {
      if (!bridgeGate(ctx, req, res)) return;
      let body: { name?: string; status?: string };
      try {
        body = JSON.parse(await readBody(req)) as { name?: string; status?: string };
      } catch {
        return send(res, 400, { error: 'bad json' });
      }
      const name = String(body.name || '').trim();
      const st = String(body.status || '').toLowerCase();
      if (!name) return send(res, 400, { error: 'name required' });
      if (st !== 'working' && st !== 'idle') return send(res, 400, { error: 'status working|idle' });
      const crew: Record<string, string> = { [name]: st };
      let merged = crew;
      try {
        const file = path.join(ctx.cfg.dataDir, 'crew-status.json');
        if (existsSync(file)) {
          const prev = JSON.parse(readFileSync(file, 'utf8')) as { crew?: Record<string, string> };
          merged = { ...(prev.crew || {}), ...crew };
        }
        writeFileSync(
          file,
          JSON.stringify({ updatedAt: new Date().toISOString(), crew: merged, source: 'bridge-status' }, null, 2) + '\n',
          { mode: 0o600 },
        );
      } catch (e) {
        return send(res, 500, { error: String(e) });
      }
      const results: { floor: string; applied: string[] }[] = [];
      for (const floor of ctx.floors.values()) {
        results.push({ floor: floor.id, applied: floor.workers.applyCrewPresence(merged).applied });
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
      } catch (e) {
        return send(res, 500, { error: String(e) });
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
      } catch (e) {
        return send(res, 500, { error: String(e) });
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
      let items: { title: string; text: string; at: string }[] = [];
      try {
        if (existsSync(file)) items = (JSON.parse(readFileSync(file, 'utf8')) as { items?: typeof items }).items || [];
      } catch {
        /* */
      }
      items.push({ title, text, at: new Date().toISOString() });
      writeFileSync(file, JSON.stringify({ items, note: 'crew picks up via local connector' }, null, 2) + '\n', { mode: 0o600 });
      return send(res, 200, { ok: true, queued: items.length });
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
      } catch (e) {
        return send(res, 500, { error: String(e) });
      }
    },
  },
} satisfies Record<string, Route>;