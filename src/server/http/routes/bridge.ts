import type http from 'node:http';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
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

function loopback(req: http.IncomingMessage): boolean {
  const a = req.socket.remoteAddress || '';
  return a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1';
}

/** Localhost-only bridge: crew bots ? office T-chat. */
export const bridgeRoutes = {
  chatRecent: {
    method: 'GET',
    path: '/api/bridge/chat',
    auth: 'public',
    handle(ctx: Ctx, { req, res, url }) {
      if (!loopback(req)) return send(res, 403, { error: 'loopback only' });
      const n = Math.min(50, Math.max(1, Number(url.searchParams.get('n') || 20) || 20));
      return send(res, 200, { lines: ctx.chat.recent(n) });
    },
  },
  say: {
    method: 'POST',
    path: '/api/bridge/say',
    auth: 'public',
    async handle(ctx: Ctx, { req, res }) {
      if (!loopback(req)) return send(res, 403, { error: 'loopback only' });
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
    method: 'POST',
    path: '/api/bridge/crew-status',
    auth: 'public',
    async handle(ctx: Ctx, { req, res }) {
      if (!loopback(req)) return send(res, 403, { error: 'loopback only' });
      let body: { crew?: Record<string, string>; updatedAt?: string };
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
    method: 'GET',
    path: '/api/bridge/crew-status',
    auth: 'public',
    handle(ctx: Ctx, { req, res }) {
      if (!loopback(req)) return send(res, 403, { error: 'loopback only' });
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
    method: 'POST',
    path: '/api/bridge/status',
    auth: 'public',
    async handle(ctx: Ctx, { req, res }) {
      if (!loopback(req)) return send(res, 403, { error: 'loopback only' });
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
      // Merge into existing crew-status file so poller keeps others.
      let merged = crew;
      try {
        const file = path.join(ctx.cfg.dataDir, 'crew-status.json');
        if (existsSync(file)) {
          const prev = JSON.parse(readFileSync(file, 'utf8')) as { crew?: Record<string, string> };
          merged = { ...(prev.crew || {}), ...crew };
        }
        writeFileSync(file, JSON.stringify({ updatedAt: new Date().toISOString(), crew: merged, source: 'bridge-status' }, null, 2) + '\n', { mode: 0o600 });
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
    method: 'POST',
    path: '/api/bridge/kavi-feed',
    auth: 'public',
    async handle(ctx: Ctx, { req, res }) {
      if (!loopback(req)) return send(res, 403, { error: 'loopback only' });
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
    method: 'GET',
    path: '/api/bridge/kavi-feed',
    auth: 'public',
    handle(ctx: Ctx, { req, res }) {
      // Face reads this from browser on 127.1 — allow loopback OR same-origin signed session later; for now public on 127-only host.
      if (!loopback(req) && req.socket.remoteAddress) {
        // Vite proxies from 5173; remote may be ::ffff:127.0.0.1 already covered by loopback().
      }
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
    method: 'POST',
    path: '/api/bridge/kavi-outbox',
    auth: 'public',
    async handle(ctx: Ctx, { req, res }) {
      if (!loopback(req)) return send(res, 403, { error: 'loopback only' });
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
      } catch { /* */ }
      items.push({ title, text, at: new Date().toISOString() });
      writeFileSync(file, JSON.stringify({ items, note: 'crew picks up via local connector' }, null, 2) + '\n', { mode: 0o600 });
      return send(res, 200, { ok: true, queued: items.length });
    },
  },
  kaviOutboxGet: {
    method: 'GET',
    path: '/api/bridge/kavi-outbox',
    auth: 'public',
    handle(ctx: Ctx, { req, res }) {
      if (!loopback(req)) return send(res, 403, { error: 'loopback only' });
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
