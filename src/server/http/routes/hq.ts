// Local HQ routes. Every one sits behind bridgeGate (token or office session, loopback Host).
// Okkin answers carry a model name and a state word, never an Ollama response body.
import type http from 'node:http';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import type { Ctx } from '../../office/context.js';
import { send } from '../util.js';
import type { Route } from '../router.js';
import { bridgeGate, pushCrew } from './bridge.js';
import { activeSeatMap, CREW_SEATS, ageLabel, isSeatId, liveDesk, rosterChip, type BridgeBeat, type SeatId } from '../../../shared/hq.js';
import { loadHqLocal, readCrewFile } from '../../workers/crew.js';
import { cardFor, ingestInbox, notePlayerChat, readThread, appendThread, writeCard } from '../../hq/relay.js';
import { isOkkinSeat, okkinClient, probeOkkin, switchOkkinModel, talkToOkkin } from '../../hq/okkin.js';

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function envOf(processEnv: NodeJS.ProcessEnv) {
  return {
    OLLAMA_URL: processEnv.OLLAMA_URL,
    OKKIN_MODEL: processEnv.OKKIN_MODEL,
    OKKIN_MODEL_ALLOW: processEnv.OKKIN_MODEL_ALLOW,
  };
}

function beats(seen: Record<string, number>, crew: Record<string, string>, now: number): Record<string, BridgeBeat> {
  const out: Record<string, BridgeBeat> = {};
  for (const [key, value] of Object.entries(crew)) {
    if (!isSeatId(key)) continue;
    const st = String(value).toLowerCase();
    const status = st === 'working' ? 'working' : st === 'blocked' || st === 'needs_input' ? 'blocked' : st === 'done' ? 'done' : 'idle';
    out[key] = { status, at: seen[key] ?? now };
  }
  return out;
}

export const hqRoutes = {
  roster: {
    method: 'GET' as const,
    path: '/api/bridge/roster',
    auth: 'public' as const,
    async handle(ctx: Ctx, { req, res }: { req: http.IncomingMessage; res: http.ServerResponse }) {
      if (!bridgeGate(ctx, req, res)) return;
      ingestInbox(ctx.cfg.dataDir);
      const hq = loadHqLocal(path.join(ctx.cfg.dataDir, 'workers.json'));
      const file = readCrewFile(ctx.cfg.dataDir);
      const now = Date.now();
      const map = activeSeatMap(hq);
      const known = beats(file?.seen ?? {}, file?.crew ?? {}, now);
      const okkin = okkinClient(await probeOkkin(envOf(process.env), hq));
      const seats = CREW_SEATS.map((seat, index) => {
        const card = cardFor(ctx.cfg.dataDir, seat);
        if (seat === 'okkin') {
          return {
            seat,
            index,
            deskId: map.okkin ?? null,
            chip: okkin.chip,
            age: okkin.chip === 'offline' ? '—' : 'now',
            task: card.task,
            live: liveDesk(card),
            model: okkin.model,
            state: okkin.state,
            options: okkin.options,
            configured: okkin.configured,
          };
        }
        const beat = known[seat];
        const chip = rosterChip(beat, now);
        return {
          seat,
          index,
          deskId: map[seat] ?? null,
          chip,
          age: ageLabel(beat?.at, now),
          task: card.task,
          live: liveDesk(card) || chip === 'working' || chip === 'blocked',
        };
      });
      return send(res, 200, { now, seats });
    },
  },
  talk: {
    method: 'POST' as const,
    path: '/api/bridge/talk',
    auth: 'public' as const,
    async handle(ctx: Ctx, { req, res }: { req: http.IncomingMessage; res: http.ServerResponse }) {
      if (!bridgeGate(ctx, req, res)) return;
      let body: { seat?: string; text?: string };
      try {
        body = JSON.parse(await readBody(req)) as { seat?: string; text?: string };
      } catch {
        return send(res, 400, { error: 'bad json' });
      }
      const seat = String(body.seat || '');
      if (!isSeatId(seat)) return send(res, 400, { error: 'unknown seat' });
      const text = String(body.text || '').slice(0, 500).trim();
      if (!text) return send(res, 400, { error: 'empty text' });
      if (isOkkinSeat(seat)) {
        const result = await talkToOkkin(ctx.cfg.dataDir, envOf(process.env), loadHqLocal(path.join(ctx.cfg.dataDir, 'workers.json')), text);
        return send(res, result.status, { ok: result.status === 200, okkin: okkinClient(result.snapshot), messages: result.messages });
      }
      const noted = notePlayerChat(ctx.cfg.dataDir, { text, at: Date.now(), seat, kind: 'talk' });
      const messages = appendThread(ctx.cfg.dataDir, seat, { id: randomBytes(4).toString('hex'), role: 'player', text, at: Date.now() });
      return send(res, 200, { ok: true, reply: noted.reply, messages });
    },
  },
  talkGet: {
    method: 'GET' as const,
    path: '/api/bridge/talk',
    auth: 'public' as const,
    async handle(ctx: Ctx, { req, res, url }: { req: http.IncomingMessage; res: http.ServerResponse; url: URL }) {
      if (!bridgeGate(ctx, req, res)) return;
      const seat = url.searchParams.get('seat') || '';
      if (!isSeatId(seat)) return send(res, 400, { error: 'unknown seat' });
      ingestInbox(ctx.cfg.dataDir);
      const messages = readThread(ctx.cfg.dataDir, seat as SeatId);
      if (seat === 'okkin') {
        const okkin = okkinClient(await probeOkkin(envOf(process.env), loadHqLocal(path.join(ctx.cfg.dataDir, 'workers.json'))));
        return send(res, 200, { seat, messages, okkin });
      }
      return send(res, 200, { seat, messages });
    },
  },
  desk: {
    method: 'POST' as const,
    path: '/api/bridge/desk',
    auth: 'public' as const,
    async handle(ctx: Ctx, { req, res }: { req: http.IncomingMessage; res: http.ServerResponse }) {
      if (!bridgeGate(ctx, req, res)) return;
      let body: { seat?: string };
      try {
        body = JSON.parse(await readBody(req)) as { seat?: string };
      } catch {
        return send(res, 400, { error: 'bad json' });
      }
      const seat = String(body.seat || '');
      if (!isSeatId(seat)) return send(res, 400, { error: 'unknown seat' });
      const card = writeCard(ctx.cfg.dataDir, seat, body);
      return send(res, 200, { ok: true, seat, card });
    },
  },
  deskGet: {
    method: 'GET' as const,
    path: '/api/bridge/desk',
    auth: 'public' as const,
    handle(ctx: Ctx, { req, res, url }: { req: http.IncomingMessage; res: http.ServerResponse; url: URL }) {
      if (!bridgeGate(ctx, req, res)) return;
      const seat = url.searchParams.get('seat') || '';
      if (!isSeatId(seat)) return send(res, 400, { error: 'unknown seat' });
      return send(res, 200, { seat, card: cardFor(ctx.cfg.dataDir, seat as SeatId) });
    },
  },
  okkinModel: {
    method: 'POST' as const,
    path: '/api/bridge/okkin/model',
    auth: 'public' as const,
    async handle(ctx: Ctx, { req, res }: { req: http.IncomingMessage; res: http.ServerResponse }) {
      if (!bridgeGate(ctx, req, res)) return;
      let body: { model?: string };
      try {
        body = JSON.parse(await readBody(req)) as { model?: string };
      } catch {
        return send(res, 400, { error: 'bad json' });
      }
      const hq = loadHqLocal(path.join(ctx.cfg.dataDir, 'workers.json'));
      const result = await switchOkkinModel(envOf(process.env), hq, String(body.model || ''));
      return send(res, result.status, { ok: result.status === 200, error: result.error, okkin: okkinClient(result.snapshot) });
    },
  },
  status: {
    method: 'POST' as const,
    path: '/api/bridge/hq-status',
    auth: 'public' as const,
    async handle(ctx: Ctx, { req, res }: { req: http.IncomingMessage; res: http.ServerResponse }) {
      if (!bridgeGate(ctx, req, res)) return;
      let body: { name?: string; status?: string; crew?: Record<string, string> };
      try {
        body = JSON.parse(await readBody(req)) as typeof body;
      } catch {
        return send(res, 400, { error: 'bad json' });
      }
      const patch = body.crew && typeof body.crew === 'object' ? body.crew : { [String(body.name || '')]: String(body.status || '') };
      const file = pushCrew(ctx, patch, 'bridge-status');
      const results: { floor: string; applied: string[] }[] = [];
      for (const floor of ctx.floors.values()) {
        const hq = loadHqLocal(path.join(floor.dir, '.agent-office', 'workers.json'));
        results.push({ floor: floor.id, applied: floor.workers.applyCrewPresence(file.crew, { seen: file.seen, seats: activeSeatMap(hq) }).applied });
      }
      return send(res, 200, { ok: true, results });
    },
  },
} satisfies Record<string, Route>;
