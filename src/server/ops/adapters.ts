// Read-only ops tiles. None of these throw. Unknown fields are dropped. Strings go through sanitize.
import path from 'node:path';
import { CREW_SEATS, sanitizeNames, sanitizeSeatMap, seatDisplayName, isSeatId, type SeatId } from '../../shared/hq.js';
import {
  NOTION_LOOP_STALE_MS,
  NOTION_URL,
  PROJECT_STATUSES,
  PROJECTS_STALE_MS,
  SEAT_QUIET_MS,
  USAGE_STALE_MS,
  mtDate,
  notWired,
  sanitize,
  staleness,
  type CrewData,
  type DeepseekData,
  type GrokUsage,
  type HostData,
  type IssueRow,
  type OkkinData,
  type OpsTile,
  type ProjectRow,
  type ProjectsData,
  type SeatRow,
} from '../../shared/ops.js';
import { boardFromLog } from '../router/board.js';
import { createOllama, psModels } from '../ollama.js';
import { safeRead, type SafeRead } from './safe-path.js';

export interface OpsMem {
  total: number;
  free: number;
  load: readonly number[];
  rss: number;
}

export interface OpsEnv {
  dataDir: string;
  floorDirs: string[];
  crewRouterHome?: string;
  notionLoopLog?: string;
  routerOn: boolean;
  capUsd: number;
  now: number;
  ps: () => Promise<{ name: string; vramMB: number | null }[]>;
  mem: OpsMem;
}

export interface OpsAdapter {
  id: string;
  run(env: OpsEnv): Promise<OpsTile>;
}

const dirsOf = (env: OpsEnv) => [env.dataDir, ...env.floorDirs];

function reasonOf(read: SafeRead): string {
  return read.ok ? 'malformed' : read.reason;
}

function parseJson(read: SafeRead): { ok: true; value: unknown } | { ok: false; reason: string } {
  if (!read.ok) return { ok: false, reason: read.reason };
  try {
    return { ok: true, value: JSON.parse(read.text) };
  } catch {
    return { ok: false, reason: 'malformed' };
  }
}

function iso(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value)) return null;
  return Number.isFinite(Date.parse(value)) ? value : null;
}

function usd(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function optText(value: string | undefined): string | undefined {
  if (!value || value === '[redacted]') return undefined;
  return value;
}

async function readUsage(env: OpsEnv): Promise<OpsTile<GrokUsage>> {
  const id = 'grok.usage';
  const parsed = parseJson(safeRead(path.join(env.dataDir, 'ops', 'usage-snapshot.json'), [env.dataDir]));
  if (!parsed.ok) return notWired(id, parsed.reason);
  const raw = parsed.value;
  if (!raw || typeof raw !== 'object') return notWired(id, 'malformed');
  const row = raw as Record<string, unknown>;
  const captured = iso(row.capturedAt);
  const weekly = row.grokWeekly;
  const demand = row.onDemand;
  if (row.schema !== 1 || !captured || !weekly || typeof weekly !== 'object' || !demand || typeof demand !== 'object') {
    return notWired(id, 'malformed');
  }
  const w = weekly as Record<string, unknown>;
  const d = demand as Record<string, unknown>;
  const pct = typeof w.pct === 'number' && Number.isFinite(w.pct) && w.pct >= 0 && w.pct <= 100 ? w.pct : null;
  const weeklyResetsAt = iso(w.resetsAt);
  const onDemandUsd = usd(d.usedUsd);
  const onDemandLimitUsd = usd(d.limitUsd);
  const onDemandResetsAt = iso(d.resetsAt);
  if (pct === null || !weeklyResetsAt || onDemandUsd === null || onDemandLimitUsd === null || !onDemandResetsAt) {
    return notWired(id, 'malformed');
  }
  const age = staleness(Date.parse(captured), env.now, USAGE_STALE_MS);
  return {
    id,
    state: age.state,
    ageSec: age.ageSec,
    data: { weeklyPct: pct, weeklyResetsAt, onDemandUsd, onDemandLimitUsd, onDemandResetsAt, over: onDemandUsd > onDemandLimitUsd },
  };
}

function notionUrl(value: unknown): string | undefined {
  return typeof value === 'string' && NOTION_URL.test(value) ? value : undefined;
}

function statusText(value: unknown): string {
  const raw = typeof value === 'string' ? sanitize(value, 24) : '';
  if ((PROJECT_STATUSES as readonly string[]).includes(raw)) return raw;
  return raw.slice(0, 24);
}

async function readProjects(env: OpsEnv): Promise<OpsTile<ProjectsData>> {
  const id = 'projects';
  const parsed = parseJson(safeRead(path.join(env.dataDir, 'ops', 'projects.json'), [env.dataDir]));
  if (!parsed.ok) return notWired(id, parsed.reason);
  const raw = parsed.value;
  if (!raw || typeof raw !== 'object') return notWired(id, 'malformed');
  const row = raw as Record<string, unknown>;
  const captured = iso(row.capturedAt);
  if (row.schema !== 1 || !captured || !Array.isArray(row.projects) || !Array.isArray(row.issues)) return notWired(id, 'malformed');
  const projects: ProjectRow[] = [];
  for (const item of row.projects.slice(0, 100)) {
    if (!item || typeof item !== 'object') continue;
    const p = item as Record<string, unknown>;
    if (typeof p.name !== 'string' || !p.name.trim()) continue;
    const status = statusText(p.status);
    const url = notionUrl(p.url);
    const owner = typeof p.owner === 'string' ? optText(sanitize(p.owner, 80)) : undefined;
    projects.push({ name: sanitize(p.name), status, ...(owner ? { owner } : {}), ...(url ? { url } : {}) });
  }
  const issues: IssueRow[] = [];
  const byStatus: Record<string, number> = {};
  for (const item of row.issues.slice(0, 100)) {
    if (!item || typeof item !== 'object') continue;
    const issue = item as Record<string, unknown>;
    if (typeof issue.id !== 'string' || typeof issue.title !== 'string') continue;
    const status = statusText(issue.status);
    const url = notionUrl(issue.url);
    const project = typeof issue.project === 'string' ? optText(sanitize(issue.project)) : undefined;
    byStatus[status] = (byStatus[status] ?? 0) + 1;
    issues.push({
      id: sanitize(issue.id, 24),
      title: sanitize(issue.title),
      status,
      ...(project ? { project } : {}),
      ...(url ? { url } : {}),
    });
  }
  const age = staleness(Date.parse(captured), env.now, PROJECTS_STALE_MS);
  return { id, state: age.state, ageSec: age.ageSec, data: { projects, issues, counts: { byStatus } } };
}

interface WorkerRow {
  id?: string;
  name?: string;
  deskId?: string;
  provider?: string;
  model?: string;
}

function parseWorkers(value: unknown): WorkerRow[] {
  if (!Array.isArray(value)) return [];
  const out: WorkerRow[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    out.push({
      id: typeof row.id === 'string' ? row.id : undefined,
      name: typeof row.name === 'string' ? row.name : undefined,
      deskId: typeof row.deskId === 'string' ? row.deskId : undefined,
      provider: typeof row.provider === 'string' ? optText(sanitize(row.provider, 32)) : undefined,
      model: typeof row.model === 'string' ? optText(sanitize(row.model)) : undefined,
    });
  }
  return out;
}

function queueCounts(dirList: string[], now: number): CrewData['queue'] {
  const today = mtDate(now);
  let waiting = 0;
  let running = 0;
  let doneToday = 0;
  for (const dir of dirList) {
    const parsed = parseJson(safeRead(path.join(dir, 'queue.json'), [dir]));
    if (!parsed.ok || !parsed.value || typeof parsed.value !== 'object') continue;
    const tasks = (parsed.value as { tasks?: unknown }).tasks;
    if (!Array.isArray(tasks)) continue;
    for (const task of tasks) {
      if (!task || typeof task !== 'object') continue;
      const row = task as { status?: unknown; finishedAt?: unknown };
      const finished = typeof row.finishedAt === 'number' && Number.isFinite(row.finishedAt) ? row.finishedAt : undefined;
      if (row.status === 'queued') waiting += 1;
      else if (row.status === 'running') running += 1;
      else if (row.status === 'done' && finished !== undefined && mtDate(finished) === today) doneToday += 1;
    }
  }
  return { waiting, running, doneToday };
}

async function readCrew(env: OpsEnv): Promise<OpsTile<CrewData>> {
  const id = 'crew';
  const crew: Record<string, string> = {};
  const seen: Record<string, number> = {};
  let found = false;
  let bad = false;
  const workers: WorkerRow[] = [];
  for (const dir of dirsOf(env)) {
    const crewRead = safeRead(path.join(dir, 'crew-status.json'), [dir]);
    if (crewRead.ok) {
      found = true;
      try {
        const value = JSON.parse(crewRead.text) as { crew?: unknown; seen?: unknown };
        if (value.crew && typeof value.crew === 'object') {
          for (const [key, beat] of Object.entries(value.crew as Record<string, unknown>)) {
            if (isSeatId(key) && typeof beat === 'string') crew[key] = beat;
          }
        }
        if (value.seen && typeof value.seen === 'object') {
          for (const [key, at] of Object.entries(value.seen as Record<string, unknown>)) {
            if (isSeatId(key) && typeof at === 'number' && Number.isFinite(at)) seen[key] = at;
          }
        }
      } catch {
        bad = true;
      }
    } else if (crewRead.reason !== 'missing') bad = true;
    const workerRead = safeRead(path.join(dir, 'workers.json'), [dir]);
    if (workerRead.ok) {
      try {
        workers.push(...parseWorkers(JSON.parse(workerRead.text)));
      } catch {
        /* a bad workers file does not invent seats */
      }
    }
  }
  if (!found) return notWired(id, bad ? 'malformed' : 'missing');
  let names: Partial<Record<SeatId, string>> = {};
  let desks: Partial<Record<SeatId, string>> = {};
  const hq = parseJson(safeRead(path.join(env.dataDir, 'hq-local.json'), [env.dataDir]));
  if (hq.ok && hq.value && typeof hq.value === 'object') {
    const raw = hq.value as { names?: unknown; seats?: unknown };
    names = sanitizeNames(raw.names);
    desks = sanitizeSeatMap(raw.seats);
  }
  const seats: SeatRow[] = CREW_SEATS.map((seat) => {
    const beat = crew[seat] ? sanitize(crew[seat]) : '';
    const at = seen[seat];
    const seenAgoSec = typeof at === 'number' ? Math.max(0, Math.round((env.now - at) / 1000)) : null;
    const quiet = seenAgoSec === null || seenAgoSec * 1000 > SEAT_QUIET_MS;
    const working = !quiet && beat !== '[redacted]' && /^working\b/i.test(beat);
    const desk = desks[seat];
    const worker = workers.find((row) => row.id === `crew-${seat}` || row.name?.toLowerCase() === seat || (!!desk && row.deskId === desk));
    const row: SeatRow = { seat, label: sanitize(seatDisplayName(seat, names)), beat, seenAgoSec, working, quiet };
    if (worker?.provider) row.provider = worker.provider;
    if (worker?.model) row.model = worker.model;
    return row;
  });
  return { id, state: 'ok', data: { seats, queue: queueCounts(dirsOf(env), env.now) } };
}

interface Turn {
  ts: number;
  iso: string;
  cost: number;
  estimated: boolean;
}

function deepseekTurns(text: string): Turn[] {
  const out: Turn[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let row: Record<string, unknown>;
    try {
      row = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (row.type !== 'cloud-reply' || typeof row.model !== 'string' || !/deepseek/i.test(row.model)) continue;
    const stamp = iso(row.ts);
    if (!stamp) continue;
    const cost = usd(row.cost_usd) ?? 0;
    out.push({ ts: Date.parse(stamp), iso: stamp, cost, estimated: row.usage_estimated === true });
  }
  return out;
}

function monthSpend(text: string): { usd: number | null; malformed: boolean } {
  let sum = 0;
  let malformed = false;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line) as { usd?: unknown };
      const value = usd(row.usd);
      if (value === null) malformed = true;
      else sum += value;
    } catch {
      malformed = true;
    }
  }
  return { usd: malformed ? null : sum, malformed };
}

async function readDeepseek(env: OpsEnv): Promise<OpsTile<DeepseekData>> {
  const id = 'deepseek';
  if (!env.crewRouterHome) return notWired(id, 'missing');
  const home = env.crewRouterHome;
  const log = safeRead(path.join(home, 'data', 'log.jsonl'), [home], { tail: true });
  if (!log.ok) return notWired(id, reasonOf(log));
  const turns = deepseekTurns(log.text);
  const today = mtDate(env.now);
  const weekAgo = env.now - 7 * 86_400_000;
  const todayTurns = turns.filter((turn) => mtDate(turn.ts) === today);
  const usdToday = todayTurns.reduce((sum, turn) => sum + turn.cost, 0);
  const last = turns.reduce<Turn | null>((best, turn) => (!best || turn.ts > best.ts ? turn : best), null);
  const estimatedShare = todayTurns.length ? todayTurns.filter((turn) => turn.estimated).length / todayTurns.length : null;
  const month = today.slice(0, 7);
  const spend = safeRead(path.join(home, 'data', 'spend', `${month}.jsonl`), [home], { tail: true });
  let usdMonth: number | null = null;
  let reason: string | undefined;
  if (spend.ok) {
    const summed = monthSpend(spend.text);
    usdMonth = summed.usd;
    if (summed.malformed) reason = 'spend ledger malformed';
  }
  const data: DeepseekData = {
    turnsToday: todayTurns.length,
    turns7d: turns.filter((turn) => turn.ts >= weekAgo).length,
    usdToday,
    usdMonth,
    lastTurnAt: last?.iso ?? null,
    estimatedShare,
  };
  return { id, state: 'ok', ...(reason ? { reason } : {}), data };
}

async function readRouter(env: OpsEnv): Promise<OpsTile> {
  const id = 'router.board';
  if (!env.routerOn) return notWired(id, 'ROUTER_ON off');
  try {
    return { id, state: 'ok', data: boardFromLog(env.dataDir, env.capUsd, env.now) };
  } catch {
    return notWired(id, 'unreadable');
  }
}

function numField(row: Record<string, unknown>, key: string): number | null {
  const value = row[key];
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function okkinFrom(value: unknown, now: number): OkkinData | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  const restUntil = typeof row.restUntil === 'string' ? iso(row.restUntil) : null;
  const jobs = numField(row, 'jobs');
  const total = numField(row, 'totalJobMs');
  return {
    resting: restUntil !== null && Date.parse(restUntil) > now,
    restUntil,
    jobs,
    batches: numField(row, 'batches'),
    rests: numField(row, 'rests'),
    avgJobMs: jobs && total !== null ? total / jobs : null,
    maxJobMs: numField(row, 'maxJobMs'),
    loaded: [],
  };
}

export async function defaultPs(): Promise<{ name: string; vramMB: number | null }[]> {
  const made = createOllama(undefined);
  if ('refused' in made) return [];
  let timer: NodeJS.Timeout | undefined;
  try {
    const result = await Promise.race([
      made.client.ps(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('timeout')), 1500);
      }),
    ]);
    return psModels(result).map((row) => ({ name: sanitize(row.name), vramMB: row.vramMB }));
  } catch {
    return [];
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function readOkkin(env: OpsEnv): Promise<OpsTile<OkkinData>> {
  const id = 'okkin';
  const home = env.crewRouterHome;
  const parsed = home ? parseJson(safeRead(path.join(home, 'data', 'okkin.json'), [home])) : { ok: false as const, reason: 'missing' };
  const fromFile = parsed.ok ? okkinFrom(parsed.value, env.now) : null;
  let loaded: { name: string; vramMB: number | null }[] = [];
  let psOk = true;
  try {
    loaded = (await env.ps()).map((row) => ({ name: sanitize(row.name), vramMB: row.vramMB })).filter((row) => row.name !== '[redacted]');
  } catch {
    psOk = false;
    loaded = [];
  }
  if (!fromFile && loaded.length === 0) return notWired(id, parsed.ok ? 'malformed' : parsed.reason);
  const data: OkkinData = fromFile ?? {
    resting: false,
    restUntil: null,
    jobs: null,
    batches: null,
    rests: null,
    avgJobMs: null,
    maxJobMs: null,
    loaded,
  };
  data.loaded = loaded;
  if (!fromFile) return { id, state: 'ok', reason: 'okkin.json missing', data };
  if (!psOk) return { id, state: 'ok', reason: 'ollama unreachable', data };
  return { id, state: 'ok', data };
}

function readHost(env: OpsEnv): OpsTile<HostData> {
  const { total, free, rss, load } = env.mem;
  const ramPct = total > 0 ? Math.round(((total - free) / total) * 1000) / 10 : 0;
  const officeRssMB = Math.round((rss / 1048576) * 10) / 10;
  const data: HostData = { ramPct, ramLimitPct: 70, officeRssMB, rssBudgetMB: 150 };
  if (load.length >= 3 && load.some((n) => n !== 0)) data.loadavg = [load[0] ?? 0, load[1] ?? 0, load[2] ?? 0];
  return { id: 'proart.host', state: 'ok', data };
}

async function readNotion(env: OpsEnv): Promise<OpsTile> {
  const id = 'notion.loop';
  if (!env.notionLoopLog) return notWired(id, 'missing');
  const read = safeRead(env.notionLoopLog, [path.dirname(env.notionLoopLog)], { tail: true });
  if (!read.ok) return notWired(id, reasonOf(read));
  const today = mtDate(env.now);
  let passesToday = 0;
  let usdToday = 0;
  let last = 0;
  let lastIso: string | null = null;
  for (const line of read.text.split('\n')) {
    if (!line.trim()) continue;
    let row: Record<string, unknown>;
    try {
      row = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    const stamp = iso(row.ts);
    if (!stamp) continue;
    const ts = Date.parse(stamp);
    if (ts >= last) {
      last = ts;
      lastIso = stamp;
    }
    if (mtDate(ts) !== today) continue;
    passesToday += 1;
    const cost = usd(row.cost_usd) ?? usd(row.usd);
    if (cost !== null) usdToday += cost;
  }
  const data = { passesToday, usdToday, lastPassAt: lastIso };
  if (lastIso && env.now - last > NOTION_LOOP_STALE_MS) {
    return { id, state: 'stale', ageSec: Math.round((env.now - last) / 1000), data };
  }
  return { id, state: 'ok', data };
}

export const ADAPTERS: OpsAdapter[] = [
  { id: 'grok.usage', run: readUsage },
  { id: 'projects', run: readProjects },
  { id: 'crew', run: readCrew },
  { id: 'deepseek', run: readDeepseek },
  { id: 'router.board', run: readRouter },
  { id: 'okkin', run: readOkkin },
  { id: 'proart.host', run: async (env) => readHost(env) },
  { id: 'proart.gpu', run: async () => notWired('proart.gpu', 'GPU util not exposed (no nvidia-smi adapter)') },
  { id: 'notion.loop', run: readNotion },
  { id: 'cloud.agents', run: async () => notWired('cloud.agents', 'no local cloud-agent ledger') },
];

export async function tileById(id: string, env: OpsEnv): Promise<OpsTile> {
  const adapter = ADAPTERS.find((item) => item.id === id);
  if (!adapter) return notWired(id, 'missing');
  try {
    const tile = await adapter.run(env);
    return { ...tile, id };
  } catch {
    return notWired(id, 'failed');
  }
}
