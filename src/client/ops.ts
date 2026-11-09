// Read-only ops page. Text is set with textContent. No seasonal theme and no 3D office.
import { NOTION_URL, RAM_IDLE_PCT, RAM_STOP_PCT, RAM_WARN_PCT, mtStamp, ramBand, scaleY, sparkPath } from '../shared/ops';

const OPS_MS = 15_000;
const SLOW_MS = 60_000;
const HISTORY_MS = 5 * 60_000;
const NS = 'http://www.w3.org/2000/svg';

type Range = '24h' | '7d' | '30d';
type TileState = 'ok' | 'stale' | 'not-wired';

interface Tile {
  id: string;
  state: TileState;
  reason?: string;
  ageSec?: number;
  data?: unknown;
}

interface Reply {
  on: boolean;
  sampledAt?: number | null;
  samplerStale?: boolean;
  redacted?: string[];
  tiles?: Record<string, Tile>;
}

interface Series {
  name: string;
  color: string;
  points: [number, number][];
  private?: boolean;
}

const CHARTS: { title: string; metrics: { name: string; color: string }[]; marks?: { y: number; kind: 'warn' | 'stop' }[] }[] = [
  { title: 'Grok weekly %', metrics: [{ name: 'grokWeeklyPct', color: '#3fb950' }] },
  { title: 'DeepSeek turns / $', metrics: [{ name: 'dsTurnsToday', color: '#3fb950' }, { name: 'dsUsdToday', color: '#d29922' }] },
  { title: 'Okkin jobs / VRAM', metrics: [{ name: 'okkinJobs', color: '#3fb950' }, { name: 'okkinVramMB', color: '#d29922' }] },
  { title: 'RAM %', metrics: [{ name: 'ramPct', color: '#3fb950' }], marks: [{ y: RAM_WARN_PCT, kind: 'warn' }, { y: RAM_STOP_PCT, kind: 'stop' }] },
];

let range: Range = '7d';
let fails = 0;
let opsTimer = 0;
let histTimer = 0;
let reply: Reply = { on: false };

const $ = (id: string) => document.getElementById(id);

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function rec(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

function money(value: unknown): string {
  const n = num(value);
  if (n === null) return '';
  return `$${n.toFixed(n !== 0 && Math.abs(n) < 1 ? 4 : 2)}`;
}

function when(iso: unknown): string {
  const raw = str(iso);
  if (!raw) return '';
  const t = Date.parse(raw);
  if (!Number.isFinite(t)) return '';
  return `${new Intl.DateTimeFormat('en-US', { timeZone: 'America/Denver', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(t)} MT`;
}

function ago(sec: unknown): string {
  const n = num(sec);
  if (n === null) return '—';
  if (n < 90) return `${Math.round(n)}s`;
  if (n < 5400) return `${Math.round(n / 60)}m`;
  return `${Math.round(n / 3600)}h`;
}

function badge(tile: Tile | undefined): HTMLElement | null {
  if (tile?.state !== 'stale') return null;
  const hours = Math.max(1, Math.round((tile.ageSec ?? 0) / 3600));
  return el('span', 'badge', `stale · ${hours}h old`);
}

function offCard(title: string, reason: string): HTMLElement {
  const card = el('article', 'tile off');
  card.append(el('h2', '', title), el('p', 'mark', 'not wired'), el('p', 'why', reason || 'missing'));
  return card;
}

function card(title: string, tile: Tile | undefined, body: (data: Record<string, unknown>, node: HTMLElement) => void): HTMLElement {
  if (!tile || tile.state === 'not-wired') return offCard(title, tile?.reason ?? 'missing');
  const data = rec(tile.data);
  if (!data) return offCard(title, tile.reason ?? 'malformed');
  const node = el('article', 'tile');
  const head = el('h2', '', title);
  const mark = badge(tile);
  if (mark) head.append(mark);
  node.append(head);
  body(data, node);
  if (tile.reason) node.append(el('p', 'muted', tile.reason));
  return node;
}

function meter(pct: number, tone: 'ok' | 'warn' | 'stop' | 'over', marks: { at: number; kind: 'warn' | 'stop' }[] = []): HTMLElement {
  const track = el('div', marks.length ? 'meter marks' : 'meter');
  const fill = el('span');
  fill.style.width = `${Math.max(0, Math.min(100, pct))}%`;
  if (tone === 'stop' || tone === 'over') fill.className = 'over';
  else if (tone === 'warn') fill.className = 'warn';
  track.append(fill);
  for (const mark of marks) {
    const tick = el('i', `tick ${mark.kind}`);
    tick.style.left = `${mark.at}%`;
    track.append(tick);
  }
  return track;
}

function gauge(pct: number): SVGSVGElement {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 88 88');
  svg.setAttribute('class', 'gauge');
  const radius = 36;
  const circ = 2 * Math.PI * radius;
  const part = Math.max(0, Math.min(100, pct)) / 100;
  for (const [stroke, dash] of [
    ['#2a2f37', `${circ}`],
    ['#3fb950', `${(circ * part).toFixed(2)} ${circ.toFixed(2)}`],
  ] as const) {
    const ring = document.createElementNS(NS, 'circle');
    ring.setAttribute('cx', '44');
    ring.setAttribute('cy', '44');
    ring.setAttribute('r', String(radius));
    ring.setAttribute('fill', 'none');
    ring.setAttribute('stroke', stroke);
    ring.setAttribute('stroke-width', '8');
    ring.setAttribute('stroke-dasharray', dash);
    ring.setAttribute('transform', 'rotate(-90 44 44)');
    svg.append(ring);
  }
  return svg;
}

function usage(root: HTMLElement) {
  root.replaceChildren();
  const tiles = reply.tiles ?? {};
  const grok = tiles['grok.usage'];
  const deepseek = tiles.deepseek;
  const host = tiles['proart.host'];
  const gpu = tiles['proart.gpu'];
  root.append(
    card('Grok weekly', grok, (data, node) => {
      const pct = num(data.weeklyPct);
      if (pct === null) return;
      node.append(gauge(pct), el('p', '', `${pct}%`), el('p', 'muted', `resets ${when(data.weeklyResetsAt)}`));
    }),
    card('On-demand', grok, (data, node) => {
      const used = num(data.onDemandUsd);
      const limit = num(data.onDemandLimitUsd);
      if (used === null || limit === null) {
        node.append(el('p', 'muted', reply.redacted?.includes('usd') ? 'private' : 'not wired'));
        return;
      }
      const line = el('p', '', `${money(used)} / ${money(limit)}`);
      if (data.over === true) line.append(el('span', 'pill', 'over limit'));
      node.append(line, meter(limit > 0 ? (used / limit) * 100 : 0, data.over === true ? 'over' : 'ok'), el('p', 'muted', `resets ${when(data.onDemandResetsAt)}`));
    }),
    card('DeepSeek', deepseek, (data, node) => {
      const turns = num(data.turnsToday);
      node.append(el('p', '', turns === null ? '' : `${turns} turns today`));
      const today = money(data.usdToday);
      const month = num(data.usdMonth);
      if (today) node.append(el('p', '', `${today} today`));
      if (month !== null) node.append(el('p', '', `${money(month)} month`));
      else if (reply.redacted?.includes('usd')) node.append(el('p', 'muted', 'private'));
      const last = when(data.lastTurnAt);
      if (last) node.append(el('p', 'muted', `last ${last}`));
    }),
    card('ProArt', host, (data, node) => {
      const ram = num(data.ramPct);
      const rss = num(data.officeRssMB);
      if (ram !== null) {
        const band = ramBand(ram);
        node.append(el('p', '', `RAM ${ram}%`), meter(ram, band, [{ at: RAM_WARN_PCT, kind: 'warn' }, { at: RAM_STOP_PCT, kind: 'stop' }]));
        node.append(el('p', 'muted', `idle target ${RAM_IDLE_PCT} · warn ${RAM_WARN_PCT} · stop ${RAM_STOP_PCT}`));
      }
      if (rss !== null) node.append(el('p', '', `office RSS ${rss} / 150 MB`));
      node.append(el('p', 'muted', gpu?.state === 'not-wired' ? `GPU: not wired` : 'GPU'));
      if (gpu?.state === 'not-wired' && gpu.reason) node.append(el('p', 'why', gpu.reason));
    }),
  );
}

function dot(kind: 'ok' | 'warn' | 'bad' | 'off'): HTMLElement {
  return el('span', `dot ${kind}`);
}

function crew(root: HTMLElement) {
  root.replaceChildren();
  const tile = reply.tiles?.crew;
  root.append(el('h2', '', 'Crew'));
  if (!tile || tile.state === 'not-wired') {
    root.append(offCard('Crew', tile?.reason ?? 'missing'));
    return;
  }
  const data = rec(tile.data);
  const seats = Array.isArray(data?.seats) ? data.seats : [];
  const table = el('table');
  const head = el('tr');
  for (const label of ['Seat', 'State', 'Model', 'Now', 'Seen']) head.append(el('th', '', label));
  table.append(el('thead').appendChild(head).parentElement!);
  const body = el('tbody');
  const okkin = rec(reply.tiles?.okkin?.data);
  for (const item of seats) {
    const seat = rec(item);
    if (!seat) continue;
    const row = el('tr');
    const name = el('td');
    const quiet = seat.quiet === true;
    const working = seat.working === true;
    name.append(dot(working ? 'ok' : quiet ? 'warn' : 'off'), document.createTextNode(str(seat.label) ?? str(seat.seat) ?? ''));
    const model = [str(seat.provider), str(seat.model)].filter(Boolean).join(' / ');
    const extra = seat.seat === 'okkin' ? okkinLine(okkin) : '';
    row.append(name, el('td', '', working ? 'working' : quiet ? 'quiet' : 'seen'), el('td', '', extra || model || '—'), el('td', '', str(seat.beat) || '—'), el('td', '', ago(seat.seenAgoSec)));
    body.append(row);
  }
  const cloud = reply.tiles?.['cloud.agents'];
  const cloudRow = el('tr');
  const cloudName = el('td');
  cloudName.append(dot('off'), document.createTextNode('Cloud agents'));
  cloudRow.append(cloudName, el('td', '', 'not wired'), el('td', '', cloud?.reason ?? ''), el('td'), el('td'));
  body.append(cloudRow);
  table.append(body);
  root.append(table);
  const queue = rec(data?.queue);
  if (queue) {
    root.append(el('p', 'muted', `queue waiting ${num(queue.waiting) ?? 0} · running ${num(queue.running) ?? 0} · done today ${num(queue.doneToday) ?? 0}`));
  }
}

function okkinLine(data: Record<string, unknown> | null): string {
  if (!data) return '';
  const loaded = Array.isArray(data.loaded) ? rec(data.loaded[0]) : null;
  const name = loaded ? str(loaded.name) : null;
  const vram = loaded ? num(loaded.vramMB) : null;
  const bits = [name ? (vram !== null ? `${name} ${vram} MB` : name) : '', data.resting === true ? `resting until ${when(data.restUntil)}` : ''];
  return bits.filter(Boolean).join(' · ');
}

function projects(root: HTMLElement) {
  root.replaceChildren();
  const tile = reply.tiles?.projects;
  root.append(el('h2', '', 'Projects'));
  if (!tile || tile.state === 'not-wired') {
    root.append(offCard('Projects', tile?.reason ?? 'missing'));
    return;
  }
  const mark = badge(tile);
  if (mark) root.append(mark);
  const list = el('ul');
  for (const item of (rec(tile.data)?.projects as unknown[] | undefined) ?? []) {
    const row = rec(item);
    if (!row) continue;
    const li = el('li');
    li.append(dot(str(row.status) === 'Active' ? 'ok' : 'off'), document.createTextNode(` ${str(row.name) ?? ''} `), el('span', 'muted', str(row.status) ?? ''));
    const url = str(row.url);
    if (url && NOTION_URL.test(url)) {
      const link = el('a', '', 'open');
      link.href = url;
      link.rel = 'noreferrer';
      li.append(document.createTextNode(' '), link);
    }
    list.append(li);
  }
  root.append(list);
}

function issues(root: HTMLElement) {
  root.replaceChildren();
  const tile = reply.tiles?.projects;
  root.append(el('h2', '', 'Issues'));
  if (!tile || tile.state === 'not-wired') {
    root.append(offCard('Issues', tile?.reason ?? 'missing'));
    return;
  }
  const data = rec(tile.data);
  const counts = rec(rec(data?.counts)?.byStatus) ?? {};
  const entries = Object.entries(counts).filter((entry): entry is [string, number] => typeof entry[1] === 'number');
  const max = Math.max(1, ...entries.map((entry) => entry[1]));
  const bars = el('div');
  for (const [status, count] of entries) {
    const row = el('div', 'bar-row');
    const track = el('div', 'track');
    const fill = el('span');
    fill.style.width = `${Math.round((count / max) * 100)}%`;
    track.append(fill);
    row.append(el('span', '', status), track, el('span', '', String(count)));
    bars.append(row);
  }
  root.append(bars);
  const open = ((data?.issues as unknown[] | undefined) ?? []).map(rec).filter((row) => row && /^open$/i.test(str(row.status) ?? '')).slice(0, 5);
  const list = el('ul');
  for (const row of open) {
    if (!row) continue;
    const li = el('li');
    li.append(document.createTextNode(`${str(row.id) ?? ''} ${str(row.title) ?? ''}`));
    const url = str(row.url);
    if (url && NOTION_URL.test(url)) {
      const link = el('a', '', 'link');
      link.href = url;
      link.rel = 'noreferrer';
      li.append(document.createTextNode(' '), link);
    }
    list.append(li);
  }
  root.append(list);
}

function chart(title: string, series: Series[], marks: { y: number; kind: 'warn' | 'stop' }[] = []): HTMLElement {
  const node = el('article', 'chart');
  node.append(el('h2', '', title));
  const usable = series.filter((item) => !item.private && item.points.length);
  if (series.some((item) => item.private) && !usable.length) {
    node.append(el('p', 'muted', 'private'));
    return node;
  }
  if (!usable.length) {
    node.append(el('p', 'muted', 'no history yet'));
    return node;
  }
  const values = usable.flatMap((item) => item.points.map((point) => point[1]));
  let min = Math.min(...values);
  let max = Math.max(...values);
  for (const mark of marks) {
    min = Math.min(min, mark.y);
    max = Math.max(max, mark.y);
  }
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 320 80');
  for (const item of usable) {
    const path = document.createElementNS(NS, 'path');
    const last = item.points[item.points.length - 1]?.[1];
    const band = item.name === 'ramPct' && typeof last === 'number' ? ramBand(last) : 'ok';
    path.setAttribute('d', sparkPath(item.points.map((point) => point[1]), 320, 80, min, max));
    path.setAttribute('stroke', band === 'stop' ? '#f85149' : band === 'warn' ? '#d29922' : item.color);
    const titleNode = document.createElementNS(NS, 'title');
    titleNode.textContent = item.name;
    path.append(titleNode);
    svg.append(path);
  }
  for (const mark of marks) {
    const y = scaleY(mark.y, min, max, 80);
    const line = document.createElementNS(NS, 'line');
    line.setAttribute('x1', '0');
    line.setAttribute('x2', '320');
    line.setAttribute('y1', String(Math.round(y * 100) / 100));
    line.setAttribute('y2', String(Math.round(y * 100) / 100));
    line.setAttribute('class', mark.kind === 'stop' ? 'mark-line stop' : 'mark-line warn');
    svg.append(line);
  }
  node.append(svg, el('p', 'muted', `${min} – ${max}`));
  return node;
}

async function history() {
  const root = $('charts');
  if (!root || !reply.on) return;
  const now = Date.now();
  const hours = range === '24h' ? 24 : range === '30d' ? 30 * 24 : 7 * 24;
  const since = new Date(now - hours * 3600_000).toISOString();
  const charts = await Promise.all(CHARTS.map(async (item) => {
    const series: Series[] = [];
    for (const metric of item.metrics) {
      try {
        const res = await fetch(`/api/ops/history?metric=${encodeURIComponent(metric.name)}&since=${encodeURIComponent(since)}`, { cache: 'no-store' });
        const body = (await res.json()) as { points?: [number, number][]; private?: boolean };
        series.push({ name: metric.name, color: metric.color, points: Array.isArray(body.points) ? body.points : [], private: body.private === true });
      } catch {
        series.push({ name: metric.name, color: metric.color, points: [] });
      }
    }
    return chart(item.title, series, item.marks ?? []);
  }));
  root.replaceChildren(...charts);
}

function sources(root: HTMLElement) {
  root.replaceChildren();
  for (const tile of Object.values(reply.tiles ?? {})) {
    const bit = el('span');
    const kind = tile.state === 'ok' ? 'ok' : tile.state === 'stale' ? 'warn' : 'off';
    bit.append(dot(kind), document.createTextNode(`${tile.id} ${tile.state === 'not-wired' ? 'not wired' : tile.state}`));
    if (typeof tile.ageSec === 'number') bit.append(document.createTextNode(` ${ago(tile.ageSec)}`));
    if (tile.reason && tile.state !== 'ok') bit.append(document.createTextNode(` ${tile.reason}`));
    root.append(bit);
  }
}

function render(next: Reply) {
  reply = next;
  const banner = $('banner');
  const sampled = $('sampled');
  const live = $('live');
  if (sampled) sampled.textContent = typeof next.sampledAt === 'number' ? `sampled ${mtStamp(next.sampledAt)}` : '';
  if (live) {
    live.textContent = next.on ? (next.samplerStale ? 'stale' : 'live') : 'off';
    live.className = `live ${next.on ? (next.samplerStale ? 'warn' : 'on') : ''}`;
  }
  if (!next.on) {
    if (banner) {
      banner.hidden = false;
      banner.textContent = 'Ops is off';
    }
    for (const id of ['usage', 'crew', 'projects', 'issues', 'charts', 'sources']) $(id)?.replaceChildren();
    return;
  }
  if (banner) banner.hidden = true;
  const usageRoot = $('usage');
  const crewRoot = $('crew');
  const projectsRoot = $('projects');
  const issuesRoot = $('issues');
  const footer = $('sources');
  if (usageRoot) usage(usageRoot);
  if (crewRoot) crew(crewRoot);
  if (projectsRoot) projects(projectsRoot);
  if (issuesRoot) issues(issuesRoot);
  if (footer) sources(footer);
}

function scheduleOps(ms: number) {
  window.clearTimeout(opsTimer);
  opsTimer = window.setTimeout(() => void poll(), ms);
}

function scheduleHistory() {
  window.clearTimeout(histTimer);
  histTimer = window.setTimeout(() => void pollHistory(), HISTORY_MS);
}

async function poll() {
  if (document.hidden) {
    scheduleOps(OPS_MS);
    return;
  }
  try {
    const res = await fetch('/api/ops', { cache: 'no-store' });
    if (res.status === 401 || res.status === 403) {
      const banner = $('banner');
      if (banner) {
        banner.hidden = false;
        banner.textContent = res.status === 401 ? 'Sign in required' : 'Owner only';
      }
      fails = 0;
      scheduleOps(OPS_MS);
      return;
    }
    if (!res.ok) throw new Error('bad status');
    fails = 0;
    render((await res.json()) as Reply);
    scheduleOps(OPS_MS);
  } catch {
    fails += 1;
    scheduleOps(fails >= 3 ? SLOW_MS : OPS_MS);
  }
}

async function pollHistory() {
  if (!document.hidden && reply.on) await history();
  scheduleHistory();
}

function boot() {
  document.querySelectorAll<HTMLButtonElement>('[data-range]').forEach((button) => {
    button.addEventListener('click', () => {
      const next = button.dataset.range;
      if (next !== '24h' && next !== '7d' && next !== '30d') return;
      range = next;
      document.querySelectorAll<HTMLButtonElement>('[data-range]').forEach((item) => item.classList.toggle('on', item === button));
      void history();
    });
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) void poll();
  });
  void poll();
  void pollHistory();
}

boot();
