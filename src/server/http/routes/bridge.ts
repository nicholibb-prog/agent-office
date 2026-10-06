import type http from 'node:http';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import type { Ctx } from '../../office/context.js';
import type { ChatLine } from '../../../shared/protocol.js';
import { activeSeatMap, isSeatId } from '../../../shared/hq.js';
import { send } from '../util.js';
import { BodyTooLarge, closeTooLarge, readJsonBody } from '../read-body.js';
import type { Route } from '../router.js';
import { appendInbox, ingestInbox } from '../../hq/relay.js';
import { loadHqLocal, writeCrewPush } from '../../workers/crew.js';
import { writePrivate } from '../../private-file.js';

const OFFICE_ERROR = 'The office could not complete that';

function dataDirs(ctx: Ctx): string[] {
  const dirs = new Set<string>([ctx.cfg.dataDir]);
  for (const floor of ctx.floors.values()) dirs.add(path.join(floor.dir, '.agent-office'));
  return [...dirs];
}

/** Writes the push where the office keeps data and on every floor, with the seen time the lease uses. */
export function pushCrew(ctx: Ctx, patch: Record<string, string>, source: string) {
  const now = Date.now();
  let file = writeCrewPush(ctx.cfg.dataDir, patch, source, now);
  for (const dir of dataDirs(ctx)) if (dir !== ctx.cfg.dataDir) file = writeCrewPush(dir, patch, source, now);
  return file;
}

async function readJson<T extends object>(req: http.IncomingMessage, res: http.ServerResponse): Promise<T | undefined> {
  try {
    const value = JSON.parse(await readJsonBody(req)) as T;
    if (!value || typeof value !== 'object') {
      send(res, 400, { error: 'bad json' });
      return undefined;
    }
    return value;
  } catch (err) {
    if (err instanceof BodyTooLarge) {
      closeTooLarge(req, res);
      return undefined;
    }
    else send(res, 400, { error: 'bad json' });
    return undefined;
  }
}

/** Letters and digits that fold toward o, k, i, or n. Applied after NFKD and mark stripping. */
const LOOKALIKE: Record<string, string> = {
  '0': 'o',
  '1': 'i',
  l: 'i',
  L: 'i',
  '\u0131': 'i',
  '\u03bf': 'o',
  '\u039f': 'o',
  '\u03ba': 'k',
  '\u039a': 'k',
  '\u03b9': 'i',
  '\u0399': 'i',
  '\u03bd': 'n',
  '\u039d': 'n',
  '\u1d0f': 'o',
  '\u1d0b': 'k',
  '\u026a': 'i',
  '\u0274': 'n',
  '\u04c0': 'i',
  '\u0456': 'i',
  '\u0406': 'i',
  '\u043e': 'o',
  '\u041e': 'o',
  '\u043a': 'k',
  '\u041a': 'k',
  '\u043d': 'n',
  '\u041d': 'n',
};

/** True when the name folds to something that contains okkin. */
export function refusesOkkinName(raw: string): boolean {
  const folded = String(raw).normalize('NFKD').replace(/\p{Cf}/gu, '').replace(/\p{M}/gu, '');
  let mapped = '';
  for (const ch of folded) mapped += LOOKALIKE[ch] ?? ch;
  return mapped.toLowerCase().replace(/[^a-z0-9]/g, '').includes('okkin');
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

/** Host, origin, and JSON content-type. Shared by the token gate and the session-only routes. */
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

/** Office session only. A bridge token or Bearer header is refused even when a cookie is also present. */
export function sessionOnly(ctx: Ctx, req: http.IncomingMessage, res: http.ServerResponse): boolean {
  if (!bridgeShape(req, res)) return false;
  if (tokenFromReq(req)) {
    send(res, 403, { error: 'session required' });
    return false;
  }
  if (ctx.auth.sessionFromAnyCookie(req)) return true;
  send(res, 401, { error: 'office session required' });
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
      const body = await readJson<{ name?: string; text?: string; color?: string }>(req, res);
      if (!body) return;
      const name = String(body.name || 'agent').slice(0, 32).trim() || 'agent';
      const text = String(body.text || '').slice(0, 500).trim();
      if (refusesOkkinName(name)) return send(res, 400, { error: 'Okkin speaks only through the local model' });
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
  inbox: {
    method: 'POST' as const,
    path: '/api/bridge/inbox',
    auth: 'public' as const,
    async handle(ctx: Ctx, { req, res }: { req: http.IncomingMessage; res: http.ServerResponse }) {
      if (!bridgeGate(ctx, req, res)) return;
      const body = await readJson<{ seat?: string; text?: string }>(req, res);
      if (!body) return;
      const seat = String(body.seat || '');
      const text = String(body.text || '');
      if (!isSeatId(seat) || seat === 'okkin') return send(res, 400, { error: 'inbox is for a generic seat' });
      const at = Date.now();
      let wrote = false;
      for (const dir of dataDirs(ctx)) {
        if (appendInbox(dir, { seat, text, at })) wrote = true;
        ingestInbox(dir);
      }
      if (!wrote) return send(res, 400, { error: 'empty text' });
      return send(res, 200, { ok: true, seat, text: text.trim().slice(0, 500) });
    },
  },
  crewStatus: {
    method: 'POST' as const,
    path: '/api/bridge/crew-status',
    auth: 'public' as const,
    async handle(ctx: Ctx, { req, res }: { req: http.IncomingMessage; res: http.ServerResponse }) {
      if (!bridgeGate(ctx, req, res)) return;
      const body = await readJson<{ crew?: Record<string, string> }>(req, res);
      if (!body) return;
      const crew = body.crew || {};
      let file;
      try {
        file = pushCrew(ctx, crew, 'bridge');
      } catch {
        return send(res, 500, { error: OFFICE_ERROR });
      }
      const results: { floor: string; applied: string[] }[] = [];
      for (const floor of ctx.floors.values()) {
        const hq = loadHqLocal(path.join(floor.dir, '.agent-office', 'workers.json'));
        const r = floor.workers.applyCrewPresence(file.crew, { seen: file.seen, seats: activeSeatMap(hq) });
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
        return send(res, 500, { error: OFFICE_ERROR });
      }
    },
  },
  status: {
    method: 'POST' as const,
    path: '/api/bridge/status',
    auth: 'public' as const,
    async handle(ctx: Ctx, { req, res }: { req: http.IncomingMessage; res: http.ServerResponse }) {
      if (!bridgeGate(ctx, req, res)) return;
      const body = await readJson<{ name?: string; status?: string }>(req, res);
      if (!body) return;
      const name = String(body.name || '').trim();
      const st = String(body.status || '').toLowerCase();
      if (!name) return send(res, 400, { error: 'name required' });
      if (st !== 'working' && st !== 'idle') return send(res, 400, { error: 'status working|idle' });
      let file;
      try {
        file = pushCrew(ctx, { [name]: st }, 'bridge-status');
      } catch {
        return send(res, 500, { error: OFFICE_ERROR });
      }
      const results: { floor: string; applied: string[] }[] = [];
      for (const floor of ctx.floors.values()) {
        const hq = loadHqLocal(path.join(floor.dir, '.agent-office', 'workers.json'));
        results.push({ floor: floor.id, applied: floor.workers.applyCrewPresence(file.crew, { seen: file.seen, seats: activeSeatMap(hq) }).applied });
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
      const body = await readJson<{ titles?: { name?: string; id?: string; modifiedTime?: string }[] }>(req, res);
      if (!body) return;
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
        writePrivate(path.join(ctx.cfg.dataDir, 'kavi-feed.json'), JSON.stringify(payload, null, 2) + '\n');
      } catch {
        return send(res, 500, { error: OFFICE_ERROR });
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
        return send(res, 500, { error: OFFICE_ERROR });
      }
    },
  },
  kaviOutbox: {
    method: 'POST' as const,
    path: '/api/bridge/kavi-outbox',
    auth: 'public' as const,
    async handle(ctx: Ctx, { req, res }: { req: http.IncomingMessage; res: http.ServerResponse }) {
      if (!bridgeGate(ctx, req, res)) return;
      const body = await readJson<{ title?: string; text?: string }>(req, res);
      if (!body) return;
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
      items = items.slice(-200);
      writePrivate(file, JSON.stringify({ items, note: 'crew picks up via local connector' }, null, 2) + '\n');
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
      } catch {
        return send(res, 500, { error: OFFICE_ERROR });
      }
    },
  },
} satisfies Record<string, Route>;