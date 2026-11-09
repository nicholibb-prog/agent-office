// Local HQ routes. Roster and desk sit behind bridgeGate. Talk and the model switch are session-only.
// Okkin answers carry a model name and a state word, never an Ollama response body.
import type http from 'node:http';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import type { Ctx } from '../../office/context.js';
import { send } from '../util.js';
import { BodyTooLarge, closeTooLarge, readJsonBody } from '../read-body.js';
import type { Route } from '../router.js';
import { bridgeCaller, bridgeGate, pushCrew, seatPrivateCaller, sessionOnly } from './bridge.js';
import { botCredential, pinOwnerIntegrity, checkOwnerPassphrase, clearLegacyOwnerCookieHeader, clearOwnerCookieHeader, cookieOf, endOwnerSession, logOkkinRefusal, noteUnlockFailure, okkinCaller, ownerCookieHeader, ownerFile, ownerState, startOwnerSession, unlockLocked } from '../../hq/okkin-owner.js';
import { clientIp, isSecure } from '../util.js';
import { activeSeatMap, CREW_SEATS, ageLabel, isSeatId, liveDesk, offlineQueuedNotice, rosterChip, seatDisplayName, type BridgeBeat, type SeatId } from '../../../shared/hq.js';
import { loadHqLocal, readCrewFile } from '../../workers/crew.js';
import { cardFor, ingestInbox, notePlayerChat, readThread, appendThread, writeCard } from '../../hq/relay.js';
import { isOkkinSeat, okkinClient, okkinThread, probeOkkin, switchOkkinModel, talkToOkkin } from '../../hq/okkin.js';
import { markSwitch, switchCooling, talkLimited } from '../../hq/limits.js';
import { okkinInstalled, okkinJobs, okkinLoaded, okkinQueueDepth } from '../../hq/okkin.js';
import { flipPower, loadPowerConfig, recheckExposure, parseAction, powerCooling, powerRightsBlocked, realRunner } from '../../hq/okkin-power.js';
import { benchByTag, bestModelPick, loadedSpeed, dialConfig, dialStops, loadLoftConfig, ramAllows } from '../../hq/okkin-loft.js';
import { createOllama, psModels } from '../../ollama.js';
import { OKKIN_OLLAMA_ORIGINS, latestOkkinOutput, okkinFetchOverride } from '../../hq/okkin.js';

/** Real per-model speeds seen this session; 'not measured yet' is the client's word for a missing one. */
function benchmarks() {
  const out: Record<string, { tokensPerSec: number; at: number }> = {};
  for (const j of okkinJobs()) if (j.ok && j.tokensPerSec !== null && !out[j.model]) out[j.model] = { tokensPerSec: j.tokensPerSec, at: j.at };
  return out;
}

function pinnedClient() {
  const made = createOllama(OKKIN_OLLAMA_ORIGINS[0], okkinFetchOverride());
  if ('refused' in made) throw new Error('unreachable');
  return made.client;
}

let idleSince = Date.now();
let idleTimer: NodeJS.Timeout | null = null;


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

/**
 * Owner only, on the server: power, the model switch and Ask to Okkin. Needs the office session AND a
 * live owner cookie from 'Unlock owner' (see hq/okkin-owner.ts); power also needs a fresh unlock. A bot
 * credential is refused even alongside an owner cookie. Refusals are 403 and logged.
 */
function okkinOwnerOnly(ctx: Ctx, req: http.IncomingMessage, res: http.ServerResponse, route: string, opts: { fresh?: boolean } = {}): boolean {
  const bot = botCredential(req);
  if (bot) {
    logOkkinRefusal(ctx.cfg.dataDir, { route, caller: bot });
    send(res, 403, { error: 'owner only' });
    return false;
  }
  if (!sessionOnly(ctx, req, res)) return false;
  pinOwnerIntegrity(ctx.cfg.dataDir);
  const caller = okkinCaller(req);
  if (caller.kind === 'owner' && (!opts.fresh || caller.fresh)) return true;
  const why = caller.kind === 'owner' ? 'unlock-stale' : caller.kind;
  logOkkinRefusal(ctx.cfg.dataDir, { route, caller: why });
  const error = why === 'not-set-up' ? 'owner not set up' : why === 'owner-file-changed' ? 'owner file changed; restart the office' : why === 'unlock-stale' ? 'unlock again' : 'owner only';
  send(res, 403, { error });
  return false;
}

function speaker(ctx: Ctx, req: http.IncomingMessage): { role: 'player' | 'guest'; by?: string; key: string } {
  const session = ctx.auth.sessionFromAnyCookie(req);
  const account = session?.account;
  if (session && !account) return { role: 'player', key: 'shared' };
  if (account?.role === 'admin') return { role: 'player', by: account.id, key: account.id };
  if (account) return { role: 'guest', by: account.id, key: account.id };
  return { role: 'guest', key: 'unknown' };
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
      const okkin = okkinClient(await probeOkkin(envOf(process.env), hq, undefined, { dataDir: ctx.cfg.dataDir }));
      const seats = CREW_SEATS.map((seat, index) => {
        const card = cardFor(ctx.cfg.dataDir, seat);
        const name = seatDisplayName(seat, hq.names);
        if (seat === 'okkin') {
          return {
            seat,
            name,
            index,
            deskId: map.okkin ?? null,
            chip: okkin.chip,
            age: okkin.chip === 'offline' ? '' : 'now',
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
          name,
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
      // A token can't talk here at all (any seat, Okkin's included; sessionOnly sends the 403). Logged.
      const tok = botCredential(req);
      if (tok === 'bridge-token' || tok === 'bearer') logOkkinRefusal(ctx.cfg.dataDir, { route: 'POST /api/bridge/talk', caller: tok });
      if (!sessionOnly(ctx, req, res)) return;
      const body = await readJson<{ seat?: string; text?: string }>(req, res);
      if (!body) return;
      const seat = String(body.seat || '');
      if (!isSeatId(seat)) return send(res, 400, { error: 'unknown seat' });
      const text = String(body.text || '').slice(0, 500).trim();
      if (!text) return send(res, 400, { error: 'empty text' });
      // Every seat's thread is the owner's: a non-owner session is refused (logged), Okkin's or not.
      if (!okkinOwnerOnly(ctx, req, res, isOkkinSeat(seat) ? 'POST /api/bridge/talk (okkin)' : 'POST /api/bridge/talk')) return;
      const who = speaker(ctx, req);
      if (talkLimited(who.key)) return send(res, 429, { error: 'slow down' });
      const hq = loadHqLocal(path.join(ctx.cfg.dataDir, 'workers.json'));
      const name = seatDisplayName(seat, hq.names);
      if (isOkkinSeat(seat)) {
        const result = await talkToOkkin(ctx.cfg.dataDir, envOf(process.env), hq, text, undefined, undefined, { role: who.role, by: who.by });
        return send(res, result.status, { ok: result.status === 200, name, chip: result.snapshot.chip, okkin: okkinClient(result.snapshot), messages: result.messages });
      }
      ingestInbox(ctx.cfg.dataDir);
      const file = readCrewFile(ctx.cfg.dataDir);
      const now = Date.now();
      const chip = rosterChip(beats(file?.seen ?? {}, file?.crew ?? {}, now)[seat], now);
      const noted = notePlayerChat(ctx.cfg.dataDir, { text, at: now, seat, kind: 'talk', role: who.role, by: who.by });
      let messages = appendThread(ctx.cfg.dataDir, seat, { id: randomBytes(4).toString('hex'), role: who.role, text, at: now, ...(who.by ? { by: who.by } : {}) });
      const replied = messages.some((m) => m.role === 'bot');
      if (chip === 'offline' && !replied) {
        messages = appendThread(ctx.cfg.dataDir, seat, { id: randomBytes(4).toString('hex'), role: 'office', text: offlineQueuedNotice(name), at: Date.now() });
      }
      return send(res, 200, { ok: true, reply: noted.reply, chip, name, messages });
    },
  },
  talkGet: {
    method: 'GET' as const,
    path: '/api/bridge/talk',
    auth: 'public' as const,
    async handle(ctx: Ctx, { req, res, url }: { req: http.IncomingMessage; res: http.ServerResponse; url: URL }) {
      const seat = url.searchParams.get('seat') || '';
      // Okkin's Ask thread is the owner's private conversation: never through the bot bridge.
      if (seat === 'okkin') {
        const bot = botCredential(req);
        if (bot) {
          logOkkinRefusal(ctx.cfg.dataDir, { route: 'GET /api/bridge/talk (okkin)', caller: bot });
          return send(res, 403, { error: 'owner only' });
        }
        if (!sessionOnly(ctx, req, res)) return;
        const hq = loadHqLocal(path.join(ctx.cfg.dataDir, 'workers.json'));
        const owner = okkinCaller(req, { touch: false }).kind === 'owner';
        const okkin = okkinClient(await probeOkkin(envOf(process.env), hq, undefined, { dataDir: ctx.cfg.dataDir }));
        return send(res, 200, { seat, name: seatDisplayName('okkin', hq.names), messages: owner ? okkinThread() : [], private: !owner, okkin, chip: okkin.chip });
      }
      const caller = seatPrivateCaller(ctx, req, res, 'GET /api/bridge/talk');
      if (!caller) return;
      if (!isSeatId(seat)) return send(res, 400, { error: 'unknown seat' });
      if (caller.kind === 'seat' && caller.seat !== seat) {
        logOkkinRefusal(ctx.cfg.dataDir, { route: 'GET /api/bridge/talk (other seat)', caller: 'seat-token' });
        return send(res, 403, { error: 'a seat token reads its own seat only' });
      }
      ingestInbox(ctx.cfg.dataDir);
      const hq = loadHqLocal(path.join(ctx.cfg.dataDir, 'workers.json'));
      const name = seatDisplayName(seat as SeatId, hq.names);
      const priv = caller.kind === 'session';
      const messages = priv ? [] : readThread(ctx.cfg.dataDir, seat as SeatId);
      const file = readCrewFile(ctx.cfg.dataDir);
      const chip = rosterChip(beats(file?.seen ?? {}, file?.crew ?? {}, Date.now())[seat], Date.now());
      return send(res, 200, { seat, name, chip, messages, private: priv });
    },
  },
  desk: {
    method: 'POST' as const,
    path: '/api/bridge/desk',
    auth: 'public' as const,
    async handle(ctx: Ctx, { req, res }: { req: http.IncomingMessage; res: http.ServerResponse }) {
      const c = bridgeCaller(ctx, req, res);
      if (!c) return;
      if (c.kind === 'session' && okkinCaller(req, { touch: false }).kind !== 'owner') {
        logOkkinRefusal(ctx.cfg.dataDir, { route: 'POST /api/bridge/desk', caller: 'not-owner' });
        return send(res, 403, { error: 'owner only' });
      }
      if (c.kind === 'shared') return send(res, 403, { error: 'shared bridge token is read-only; use a seat token' });
      const body = await readJson<{ seat?: string }>(req, res);
      if (!body) return;
      let seat = String(body.seat || '');
      if (c.kind === 'seat') {
        // A seat token writes its own desk. Naming another seat is a spoof: refused and logged.
        if (seat && seat !== c.seat) {
          logOkkinRefusal(ctx.cfg.dataDir, { route: 'POST /api/bridge/desk (other seat)', caller: 'seat-token' });
          return send(res, 403, { error: 'a seat token writes its own seat only' });
        }
        seat = c.seat;
      }
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
      if (!okkinOwnerOnly(ctx, req, res, 'POST /api/bridge/okkin/model')) return;
      if (switchCooling()) return send(res, 429, { error: 'slow down' });
      const body = await readJson<{ model?: string }>(req, res);
      if (!body) return;
      const hq = loadHqLocal(path.join(ctx.cfg.dataDir, 'workers.json'));
      const result = await switchOkkinModel(envOf(process.env), hq, String(body.model || ''), undefined, undefined, ctx.cfg.dataDir);
      if (result.status === 200 || result.status === 502) markSwitch();
      return send(res, result.status, { ok: result.status === 200, error: result.error, okkin: okkinClient(result.snapshot) });
    },
  },
  status: {
    method: 'POST' as const,
    path: '/api/bridge/hq-status',
    auth: 'public' as const,
    async handle(ctx: Ctx, { req, res }: { req: http.IncomingMessage; res: http.ServerResponse }) {
      if (!bridgeGate(ctx, req, res)) return;
      const body = await readJson<{ name?: string; status?: string; crew?: Record<string, string> }>(req, res);
      if (!body) return;
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
  okkinLoft: {
    method: 'GET' as const,
    path: '/api/bridge/okkin/loft',
    auth: 'public' as const,
    async handle(ctx: Ctx, { req, res, url }: { req: http.IncomingMessage; res: http.ServerResponse; url: URL }) {
      if (!sessionOnly(ctx, req, res)) return;
      const hq = loadHqLocal(path.join(ctx.cfg.dataDir, 'workers.json'));
      const snap = okkinClient(await probeOkkin(envOf(process.env), hq, undefined, { dataDir: ctx.cfg.dataDir }));
      startOkkinIdleSleep(ctx.cfg.dataDir);
      const loft = loadLoftConfig(ctx.cfg.dataDir);
      const stops = dialStops(dialConfig(loft), snap.chip === 'offline' ? null : okkinInstalled(), snap.options);
      const power = loadPowerConfig(ctx.cfg.dataDir);
      const exposed = snap.chip !== 'offline' ? await recheckExposure(ctx.cfg.dataDir, realRunner, power) : false;
      const gpu = (await realRunner.gpuStats?.()) ?? null;
      const job = String(url.searchParams.get('job') || '').slice(0, 24);
      const bench = benchmarks();
      const loadedNow = snap.chip === 'offline' ? [] : okkinLoaded();
      const best = job ? bestModelPick(job, stops.filter((m) => m.installed && m.allowed), bench, ramAllows) : null;
      if (snap.chip === 'working' || snap.chip === 'switching') idleSince = Date.now();
      return send(res, 200, {
        okkin: snap,
        power: snap.chip === 'offline' ? 'off' : 'on',
        powerControl: power.ok ? (powerRightsBlocked() ? 'no-rights' : powerCooling() ? 'cooling' : 'ready') : 'not-set-up',
        powerReason: power.ok ? null : power.reason,
        // Read-only for everyone else: the panel shows 'Owner only' on the controls.
        // Polling: reads the owner session without extending its idle timer.
        owner: !botCredential(req) && okkinCaller(req, { touch: false }).kind === 'owner',
        ownerState: botCredential(req) ? 'locked' : (pinOwnerIntegrity(ctx.cfg.dataDir), ownerState(req)),
        dial: stops.map((m) => ({ tag: m.tag, role: m.role, bestFor: m.bestFor, installed: m.installed, allowed: m.allowed, ramOk: ramAllows(m), minFreeRamGB: m.minFreeRamGB ?? null })),
        loaded: loadedNow,
        queue: okkinQueueDepth(),
        speed: loadedSpeed(loadedNow, bench),
        bench: benchByTag(bench),
        jobs: okkinJobs(),
        // The CRT: Okkin's latest reply from the in-memory Ask thread (never invented). Private like the
        // thread itself: only the unlocked owner gets it; everyone else (bots included) gets null.
        crt: !botCredential(req) && okkinCaller(req, { touch: false }).kind === 'owner' ? latestOkkinOutput() : null,
        pool: null,
        gpu,
        pick: best?.tag ?? null,
        pickReason: best?.reason ?? null,
        pickMeasured: best?.measured ?? null,
        idleSleepMin: loft.idleSleepMin,
        exposed,
      });
    },
  },
  okkinPower: {
    method: 'POST' as const,
    path: '/api/bridge/okkin/power',
    auth: 'public' as const,
    async handle(ctx: Ctx, { req, res }: { req: http.IncomingMessage; res: http.ServerResponse }) {
      if (!okkinOwnerOnly(ctx, req, res, 'POST /api/bridge/okkin/power', { fresh: true })) return;
      const body = await readJson<{ action?: unknown }>(req, res);
      if (!body) return;
      const action = parseAction(body.action);
      if (!action) return send(res, 400, { error: 'action must be start or stop' });
      const who = speaker(ctx, req);
      const result = await runPower(ctx.cfg.dataDir, action, who.by ?? who.key);
      return send(res, result.status, result);
    },
  },
  okkinOwnerUnlock: {
    method: 'POST' as const,
    path: '/api/bridge/okkin/owner/unlock',
    auth: 'public' as const,
    async handle(ctx: Ctx, { req, res }: { req: http.IncomingMessage; res: http.ServerResponse }) {
      const bot = botCredential(req);
      if (bot) {
        logOkkinRefusal(ctx.cfg.dataDir, { route: 'POST /api/bridge/okkin/owner/unlock', caller: bot });
        return send(res, 403, { error: 'owner only' });
      }
      if (!sessionOnly(ctx, req, res)) return;
      const file = ownerFile();
      pinOwnerIntegrity(ctx.cfg.dataDir, file);
      const st = ownerState(req, file);
      if (st === 'changed') {
        logOkkinRefusal(ctx.cfg.dataDir, { route: 'POST /api/bridge/okkin/owner/unlock', caller: 'owner-file-changed' });
        return send(res, 403, { error: 'owner file changed; restart the office' });
      }
      if (st === 'not-set-up') return send(res, 403, { error: 'owner not set up' });
      const addr = clientIp(req, !!(ctx.cfg as { trustProxy?: boolean }).trustProxy);
      if (unlockLocked(addr)) {
        logOkkinRefusal(ctx.cfg.dataDir, { route: 'POST /api/bridge/okkin/owner/unlock', caller: 'unlock-locked-out' });
        return send(res, 429, { error: 'too many tries; wait 15 minutes' });
      }
      const body = await readJson<{ passphrase?: unknown }>(req, res);
      if (!body) return;
      const ok = typeof body.passphrase === 'string' && (await checkOwnerPassphrase(file, body.passphrase));
      if (!ok) {
        noteUnlockFailure(addr);
        // The input is never logged.
        logOkkinRefusal(ctx.cfg.dataDir, { route: 'POST /api/bridge/okkin/owner/unlock', caller: 'wrong-passphrase' });
        return send(res, 403, { error: 'wrong passphrase' });
      }
      endOwnerSession(cookieOf(req));
      return send(res, 200, { ok: true, ownerState: 'unlocked' }, { 'set-cookie': [ownerCookieHeader(startOwnerSession(), isSecure(req, ctx.cfg as never)), clearLegacyOwnerCookieHeader(isSecure(req, ctx.cfg as never))] });
    },
  },
  okkinOwnerLock: {
    method: 'POST' as const,
    path: '/api/bridge/okkin/owner/lock',
    auth: 'public' as const,
    handle(ctx: Ctx, { req, res }: { req: http.IncomingMessage; res: http.ServerResponse }) {
      const bot = botCredential(req);
      if (bot) {
        logOkkinRefusal(ctx.cfg.dataDir, { route: 'POST /api/bridge/okkin/owner/lock', caller: bot });
        return send(res, 403, { error: 'owner only' });
      }
      // Same checks as every state change here: a session, this office's Host and Origin, JSON.
      if (!sessionOnly(ctx, req, res)) return;
      endOwnerSession(cookieOf(req));
      return send(res, 200, { ok: true, ownerState: 'locked' }, { 'set-cookie': [clearOwnerCookieHeader(isSecure(req, ctx.cfg as never)), clearLegacyOwnerCookieHeader(isSecure(req, ctx.cfg as never))] });
    },
  },
} satisfies Record<string, Route>;

/** The one power path: the switch and the idle auto-sleep both come through here, with the same rules. */
export async function runPower(dataDir: string, action: 'start' | 'stop', who: string) {
  const hq = loadHqLocal(path.join(dataDir, 'workers.json'));
  return flipPower(dataDir, action, who, {
    runner: realRunner,
    reachable: async () => (await probeOkkin(envOf(process.env), hq, undefined, { dataDir, force: true })).chip !== 'offline',
    loaded: async () => psModels(await pinnedClient().ps()).map((m) => m.name),
    generate: async (b) => (await pinnedClient().generate(b as never)).ok,
    chosenModel: async () => {
      const snap = await probeOkkin(envOf(process.env), hq, undefined, { dataDir, force: true });
      const tag = snap.configured && snap.options.includes(snap.configured) ? snap.configured : '';
      if (!tag) return null;
      const m = loadLoftConfig(dataDir).models.find((x) => x.tag === tag);
      if (m && !ramAllows(m)) return null;
      return { tag, ...(m?.num_ctx ? { num_ctx: m.num_ctx } : {}), ...(m?.keep_alive !== undefined ? { keep_alive: m.keep_alive } : {}) };
    },
  });
}

/** Idle auto-sleep: off unless okkin-loft.json sets idleSleepMin. Powers OFF through runPower, same rules and log. */
export function startOkkinIdleSleep(dataDir: string) {
  if (idleTimer) return;
  idleTimer = setInterval(() => {
    const min = loadLoftConfig(dataDir).idleSleepMin;
    if (!min) return;
    if (okkinQueueDepth() > 0) idleSince = Date.now();
    if (Date.now() - idleSince < min * 60_000) return;
    idleSince = Date.now();
    void runPower(dataDir, 'stop', 'idle-sleep').catch(() => undefined);
  }, 60_000);
  idleTimer.unref?.();
}
