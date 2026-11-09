// Ops dashboard types and pure helpers. No filesystem, no secrets, no seasonal theme.

export const METRICS = [
  'grokWeeklyPct',
  'onDemandUsd',
  'dsTurnsToday',
  'dsUsdToday',
  'dsUsdMonth',
  'okkinJobs',
  'okkinVramMB',
  'ramPct',
  'officeRssMB',
] as const;

export type Metric = (typeof METRICS)[number];

export const USD_METRICS: readonly Metric[] = ['onDemandUsd', 'dsUsdToday', 'dsUsdMonth'];

/** Grok usage snapshot is stale after this many hours (Gauge's midday + nightly check). */
export const USAGE_STALE_H = 14;

export const USAGE_STALE_MS = USAGE_STALE_H * 3600_000;
export const PROJECTS_STALE_MS = 24 * 3600_000;
export const NOTION_LOOP_STALE_MS = 2 * 3600_000;
export const SEAT_QUIET_MS = 15 * 60_000;

export const PROJECT_STATUSES = ['Active', 'Parked', 'Blocked', 'Done'] as const;
export const NOTION_URL = /^https:\/\/(app\.)?notion\.(so|com)\//;

const SECRET = /(sk-|ntn_|secret_|xox[abp]-|ghp_|Bearer\s)/i;
const DIGITS = /\d{13,19}/;

export type TileState = 'ok' | 'stale' | 'not-wired';

export interface OpsTile<T = unknown> {
  id: string;
  state: TileState;
  reason?: string;
  ageSec?: number;
  data?: T;
}

export interface HistoryPoint {
  t: number;
  values: Partial<Record<Metric, number>>;
}

export interface OpsReply {
  on: boolean;
  sampledAt?: number | null;
  samplerStale?: boolean;
  periodSec?: number;
  tiles?: Record<string, OpsTile>;
  redacted?: string[];
}

export interface GrokUsage {
  weeklyPct: number;
  weeklyResetsAt: string;
  onDemandUsd: number;
  onDemandLimitUsd: number;
  onDemandResetsAt: string;
  over: boolean;
}

export interface ProjectRow {
  name: string;
  status: string;
  owner?: string;
  url?: string;
}

export interface IssueRow {
  id: string;
  title: string;
  status: string;
  project?: string;
  url?: string;
}

export interface ProjectsData {
  projects: ProjectRow[];
  issues: IssueRow[];
  counts: { byStatus: Record<string, number> };
}

export interface SeatRow {
  seat: string;
  label: string;
  beat: string;
  seenAgoSec: number | null;
  working: boolean;
  quiet: boolean;
  provider?: string;
  model?: string;
}

export interface CrewData {
  seats: SeatRow[];
  queue: { waiting: number; running: number; doneToday: number };
}

export interface DeepseekData {
  turnsToday: number;
  turns7d: number;
  usdToday: number;
  usdMonth: number | null;
  lastTurnAt: string | null;
  estimatedShare: number | null;
}

export interface OkkinData {
  resting: boolean;
  restUntil: string | null;
  jobs: number | null;
  batches: number | null;
  rests: number | null;
  avgJobMs: number | null;
  maxJobMs: number | null;
  loaded: { name: string; vramMB: number | null }[];
}

export interface HostData {
  ramPct: number;
  ramLimitPct: 70;
  officeRssMB: number;
  rssBudgetMB: 150;
  /** Omitted when every sample is 0 (Windows). */
  loadavg?: [number, number, number];
}

/** Cap at 80, flatten whitespace, and replace a secret or a 13–19 digit run with [redacted]. */
export function sanitize(value: string, max = 80): string {
  if (SECRET.test(value) || DIGITS.test(value)) return '[redacted]';
  return value.replace(/[\r\n\t]/g, ' ').slice(0, max);
}

export function notWired<T = unknown>(id: string, reason: string): OpsTile<T> {
  return { id, state: 'not-wired', reason: sanitize(reason, 80) };
}

export function staleness(capturedAtMs: number, now: number, limitMs: number): { state: 'ok' | 'stale'; ageSec: number } {
  const ageSec = Math.max(0, Math.round((now - capturedAtMs) / 1000));
  return { state: now - capturedAtMs > limitMs ? 'stale' : 'ok', ageSec };
}

function round(n: number): string {
  return String(Math.round(n * 100) / 100);
}

/** Y position in an SVG box. Equal min and max sit on the midline. */
export function scaleY(value: number, min: number, max: number, h: number): number {
  if (!(h > 0) || !Number.isFinite(value)) return h / 2;
  if (!Number.isFinite(min) || !Number.isFinite(max) || max === min) return h / 2;
  return h - ((value - min) / (max - min)) * h;
}

/**
 * SVG path for a sparkline or line chart. Empty input is ''.
 * One point is a flat line across the box. Values are scaled into 0..h (y grows downward).
 */
export function sparkPath(points: readonly number[], w: number, h: number, min?: number, max?: number): string {
  if (!points.length || !(w > 0) || !(h > 0) || points.some((n) => !Number.isFinite(n))) return '';
  const lo = min ?? Math.min(...points);
  const hi = max ?? Math.max(...points);
  const yOf = (v: number) => round(scaleY(v, lo, hi, h));
  if (points.length === 1) return `M 0 ${yOf(points[0]!)} L ${round(w)} ${yOf(points[0]!)}`;
  return points
    .map((v, i) => `${i === 0 ? 'M' : 'L'} ${round((i / (points.length - 1)) * w)} ${yOf(v)}`)
    .join(' ');
}

/** YYYY-MM-DD in America/Denver. */
export function mtDate(ms: number): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Denver',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(ms));
}

/** Clock time in America/Denver, `HH:mm:ss MT`. */
export function mtStamp(ms: number): string {
  const clock = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/Denver',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(ms));
  return `${clock} MT`;
}

export function isMetric(value: string): value is Metric {
  return (METRICS as readonly string[]).includes(value);
}

export function isUsdMetric(value: string): boolean {
  return (USD_METRICS as readonly string[]).includes(value);
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Not-wired tile markup. The chrome has no digits; the reason is escaped. */
export function notWiredHtml(reason: string): string {
  return `<article class="tile off"><p class="mark">not wired</p><p class="why">${escapeHtml(sanitize(reason, 80))}</p></article>`;
}

/** Drop every key whose name contains "usd", at any depth. */
export function stripUsd(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripUsd);
  if (!value || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
    if (key.toLowerCase().includes('usd')) continue;
    out[key] = stripUsd(inner);
  }
  return out;
}

/** Bucket-average down to at most `max` points, in time order. */
export function downsample(points: [number, number][], max = 500): [number, number][] {
  if (points.length <= max) return points;
  const bucket = Math.ceil(points.length / max);
  const out: [number, number][] = [];
  for (let i = 0; i < points.length; i += bucket) {
    const slice = points.slice(i, i + bucket);
    let sum = 0;
    for (const point of slice) sum += point[1];
    out.push([slice[Math.floor((slice.length - 1) / 2)]![0], sum / slice.length]);
  }
  return out;
}

/** Numbers for one history line. Stale and not-wired metrics are omitted, never filled with 0. */
export function historyNumbers(tiles: Record<string, OpsTile>): Partial<Record<Metric, number>> {
  const out: Partial<Record<Metric, number>> = {};
  const grok = tiles['grok.usage'];
  if (grok?.state === 'ok' && grok.data && typeof grok.data === 'object') {
    const data = grok.data as GrokUsage;
    if (typeof data.weeklyPct === 'number' && Number.isFinite(data.weeklyPct)) out.grokWeeklyPct = data.weeklyPct;
    if (typeof data.onDemandUsd === 'number' && Number.isFinite(data.onDemandUsd)) out.onDemandUsd = data.onDemandUsd;
  }
  const deepseek = tiles.deepseek;
  if (deepseek?.state === 'ok' && deepseek.data && typeof deepseek.data === 'object') {
    const data = deepseek.data as DeepseekData;
    if (typeof data.turnsToday === 'number' && Number.isFinite(data.turnsToday)) out.dsTurnsToday = data.turnsToday;
    if (typeof data.usdToday === 'number' && Number.isFinite(data.usdToday)) out.dsUsdToday = data.usdToday;
    if (typeof data.usdMonth === 'number' && Number.isFinite(data.usdMonth)) out.dsUsdMonth = data.usdMonth;
  }
  const okkin = tiles.okkin;
  if (okkin?.state === 'ok' && okkin.data && typeof okkin.data === 'object') {
    const data = okkin.data as OkkinData;
    if (typeof data.jobs === 'number' && Number.isFinite(data.jobs)) out.okkinJobs = data.jobs;
    const known = (data.loaded ?? []).filter((row) => typeof row.vramMB === 'number');
    if (known.length) out.okkinVramMB = known.reduce((sum, row) => sum + (row.vramMB ?? 0), 0);
  }
  const host = tiles['proart.host'];
  if (host?.state === 'ok' && host.data && typeof host.data === 'object') {
    const data = host.data as HostData;
    if (typeof data.ramPct === 'number' && Number.isFinite(data.ramPct)) out.ramPct = data.ramPct;
    if (typeof data.officeRssMB === 'number' && Number.isFinite(data.officeRssMB)) out.officeRssMB = data.officeRssMB;
  }
  return out;
}

export function shiftDay(day: string, days: number): string {
  const [year, month, date] = day.split('-').map(Number);
  const t = Date.UTC(year ?? 1970, (month ?? 1) - 1, date ?? 1) + days * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}
