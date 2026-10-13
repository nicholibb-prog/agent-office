// Okkin's loft panel: one power control, a model dial, honest readouts. Text only (no innerHTML).
import type { Ctx } from '../../core/context';
import { h } from '../../ui/dom';
import { OKKIN_LOFT_SPOT } from '../../../shared/okkin-loft';
import './ui.css';

type Loft = {
  power: 'on' | 'off';
  powerControl: 'ready' | 'cooling' | 'no-rights' | 'not-set-up';
  powerReason: string | null;
  okkin: { chip: string; configured: string; model: string | null };
  dial: { tag: string; role: string; ramOk: boolean; minFreeRamGB: number | null }[];
  loaded: { name: string; vramMB: number | null }[];
  queue: number;
  speed: { tokensPerSec: number; model: string } | null;
  bench: Record<string, { tokensPerSec: number }>;
  gpu: { usedMB: number | null; totalMB: number | null; tempC: number | null; fan: string } | null;
  pick: string | null;
  mock?: boolean;
};

const NEAR = 3;

async function load(job = ''): Promise<Loft | null> {
  try {
    const r = await fetch(`/api/bridge/okkin/loft${job ? `?job=${encodeURIComponent(job)}` : ''}`, { cache: 'no-store', credentials: 'same-origin' });
    return r.ok ? ((await r.json()) as Loft) : null;
  } catch {
    return null;
  }
}
async function post(url: string, body: unknown) {
  const r = await fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, body: (await r.json().catch(() => ({}))) as { error?: string } };
}

export function renderPanel(root: HTMLElement, d: Loft | null, act: { power(a: 'start' | 'stop'): void; pick(tag: string): void; best(job: string): void; close(): void }, note = '') {
  const on = d?.power === 'on';
  const ctl = d?.powerControl ?? 'not-set-up';
  const ctlText = ctl === 'ready' ? (on ? 'Turn off' : 'Turn on') : ctl === 'cooling' ? 'Cooling down…' : ctl === 'no-rights' ? 'Power control needs rights' : 'Power control not set up';
  const power = h('button.okl-power', { type: 'button', 'aria-pressed': on ? 'true' : 'false', 'aria-label': `Power, currently ${on ? 'on' : 'off'}. ${ctlText}`, disabled: ctl !== 'ready' || !d }, h('span.okl-power-ring'), h('span.okl-power-label', {}, ctlText));
  power.addEventListener('click', () => act.power(on ? 'stop' : 'start'));
  const active = d?.okkin.model ?? d?.okkin.configured ?? '';
  const dial = h('div.okl-dial', { role: 'radiogroup', 'aria-label': 'Model dial' });
  for (const s of d?.dial ?? []) {
    const b = h('button.okl-stop', { type: 'button', role: 'radio', 'aria-checked': s.tag === active ? 'true' : 'false', disabled: !on || !s.ramOk, title: s.ramOk ? s.tag : `needs ${s.minFreeRamGB} GB free RAM` }, h('span.okl-role', {}, s.role || 'model'), h('span.okl-tag', {}, s.tag));
    b.addEventListener('click', () => act.pick(s.tag));
    dial.append(b);
  }
  if (!d?.dial.length) dial.append(h('p.okl-muted', {}, on ? 'No configured model is installed.' : 'Dial is off while the power is off.'));
  const stat = (k: string, v: string) => h('div.okl-stat', {}, h('span.okl-k', {}, k), h('span.okl-v', {}, v));
  const gpu = d?.gpu;
  const cards = h('div.okl-cards', {}, ...(d?.dial ?? []).map((s) => h('div.okl-card', {}, h('span.okl-tag', {}, s.tag), h('span.okl-v', {}, d?.bench[s.tag] ? `${d.bench[s.tag]!.tokensPerSec} tok/s` : 'not measured yet'))));
  const job = h('select.okl-job', { 'aria-label': 'Job type' }, ...['open', 'quick', 'chat', 'code', 'long'].map((j) => h('option', { value: j }, j)));
  const best = h('button.okl-btn', { type: 'button', disabled: !on }, 'Best model for this job');
  best.addEventListener('click', () => act.best((job as HTMLSelectElement).value));
  const close = h('button.okl-close', { type: 'button', 'aria-label': 'Close' }, '×');
  close.addEventListener('click', act.close);
  const parts: (HTMLElement | null)[] = [
    h('header.okl-head', {}, h('div', {}, h('h2', {}, 'Okkin'), h('p.okl-muted', {}, d ? (on ? `On · ${d.okkin.chip}` : 'Off') : 'Okkin offline')), d?.mock ? h('span.okl-mock', {}, 'mock') : null, close),
    h('section.okl-center', {}, power),
    h('section', {}, h('h3', {}, 'Model'), dial),
    h('section.okl-stats', {},
      stat('Queue', d ? String(d.queue) : '—'),
      stat('Speed', d?.speed ? `${d.speed.tokensPerSec} tok/s` : 'not measured yet'),
      stat('Loaded', d?.loaded.length ? d.loaded.map((m) => `${m.name}${m.vramMB !== null ? ` · ${m.vramMB} MB` : ''}`).join(', ') : 'none'),
      stat('GPU', gpu ? `${gpu.usedMB ?? '?'} / ${gpu.totalMB ?? '?'} MiB · ${gpu.tempC ?? '?'}°C · fan ${gpu.fan}` : 'no reading'),
    ),
    h('section', {}, h('h3', {}, 'Benchmarks'), cards),
    h('section.okl-row', {}, job, best, d?.pick ? h('span.okl-v', {}, `→ ${d.pick}`) : null),
    d?.powerReason ? h('p.okl-muted', {}, d.powerReason) : null,
    note ? h('p.okl-note', { role: 'status' }, note) : null,
  ];
  root.replaceChildren(...parts.filter((p): p is HTMLElement => !!p));
}

export function installOkkinLoft(ctx: Ctx) {
  const view = ctx.office.okkinLoft;
  const pill = h('button.okl-pill', { type: 'button', hidden: true }, "Okkin's loft");
  const panel = h('div.okl-panel', { role: 'dialog', 'aria-label': "Okkin's loft", hidden: true });
  document.body.append(pill, panel);
  let data: Loft | null = null;
  let note = '';
  const paint = () =>
    renderPanel(panel, data, {
      power: (a) => void post('/api/bridge/okkin/power', { action: a }).then((r) => ((note = r.body.error ?? (a === 'start' ? 'On' : 'Off')), refresh())),
      pick: (tag) => void post('/api/bridge/okkin/model', { model: tag }).then((r) => ((note = r.body.error ?? `Switched to ${tag}`), refresh())),
      best: (job) => void load(job).then((d) => { data = d; if (d?.pick) void post('/api/bridge/okkin/model', { model: d.pick }).then(() => refresh()); else paint(); }),
      close: () => (panel.hidden = true),
    }, note);
  const refresh = async () => {
    data = await load();
    view.setState({ power: data?.power ?? 'off', busy: data?.okkin.chip === 'working' });
    if (!panel.hidden) paint();
  };
  pill.addEventListener('click', () => {
    panel.hidden = false;
    paint();
    void refresh();
  });
  let age = 99;
  ctx.ticks.add('world', ({ dt }) => {
    const p = ctx.player.pos;
    const near = ctx.inOffice() && !ctx.upTop() && Math.hypot(p.x - OKKIN_LOFT_SPOT.x, p.z - OKKIN_LOFT_SPOT.z) < NEAR;
    pill.hidden = !near;
    age += dt;
    if (age < 5) return;
    age = 0;
    if (ctx.inOffice()) void refresh();
  });
  (window as unknown as { __okkinLoft?: unknown }).__okkinLoft = { open: () => pill.click(), render: (d: Loft) => { data = d; panel.hidden = false; paint(); view.setState({ power: d.power, busy: d.okkin.chip === 'working' }); } };
}
