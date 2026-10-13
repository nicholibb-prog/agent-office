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

/** Ask Okkin: a chat box only. Text nodes only (escaped), 500-char cap, memory only on the server. */
function askBox(on: boolean, lines: { who: string; text: string }[], ask?: (text: string) => void): HTMLElement {
  const log = h('div.okl-log', { role: 'log', 'aria-live': 'polite', 'aria-label': 'Ask Okkin replies' }, ...lines.slice(-6).map((l) => h('p', {}, h('strong', {}, `${l.who} `), l.text)));
  const input = h('input.okl-input', { type: 'text', maxlength: 500, 'aria-label': 'Ask Okkin', placeholder: on ? 'Ask Okkin' : 'Okkin is off', disabled: !on }) as HTMLInputElement;
  const form = h('form.okl-ask', {}, input, h('button.okl-btn', { type: 'submit', disabled: !on }, 'Ask'));
  form.addEventListener('submit', (e) => { e.preventDefault(); const t = input.value.trim().slice(0, 500); if (t && ask) { input.value = ''; ask(t); } });
  return h('section', {}, h('h3', {}, 'Ask'), log, form);
}

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

const SWEEP = 270;
/** Angle (deg, 0 = up) of stop i of n on a 270° sweep. */
export function dialAngle(i: number, n: number): number {
  return n <= 1 ? 0 : -SWEEP / 2 + (SWEEP * i) / (n - 1);
}

/** A rotary knob: role=slider, arrows/Home/End move it, Enter or Space selects. Disabled while power is off. */
export function buildDial(stops: Loft['dial'], active: string, on: boolean, pick: (tag: string) => void): HTMLElement {
  const wrap = h('div.okl-dialwrap');
  if (!stops.length) {
    wrap.append(h('p.okl-muted', {}, on ? 'No configured model is installed.' : 'Dial is off while the power is off.'));
    return wrap;
  }
  let i = Math.max(0, stops.findIndex((s) => s.tag === active));
  const face = h('div.okl-face');
  const knob = h('div.okl-knob', { role: 'slider', tabindex: on ? '0' : '-1', 'aria-label': 'Model dial', 'aria-valuemin': '0', 'aria-valuemax': String(stops.length - 1), 'aria-disabled': on ? 'false' : 'true' }, h('span.okl-pointer'));
  const readout = h('p.okl-readout', { 'aria-live': 'polite' });
  stops.forEach((s, k) => {
    const ang = dialAngle(k, stops.length);
    const lab = h('button.okl-tick', { type: 'button', tabindex: '-1', 'aria-hidden': 'true', disabled: !on || !s.ramOk, style: `--a:${ang}deg` }, s.role || String(k + 1));
    lab.addEventListener('click', () => { i = k; sync(); pick(s.tag); });
    face.append(lab);
  });
  const sync = () => {
    const s = stops[i]!;
    knob.style.setProperty('--a', `${dialAngle(i, stops.length)}deg`);
    knob.setAttribute('aria-valuenow', String(i));
    knob.setAttribute('aria-valuetext', `${s.role || 'model'}: ${s.tag}${s.ramOk ? '' : ` (needs ${s.minFreeRamGB} GB free RAM)`}${s.tag === active ? ', active' : ''}`);
    readout.replaceChildren(h('span.okl-role', {}, s.role || 'model'), h('span.okl-tag', {}, s.tag), s.tag === active ? h('span.okl-active', {}, 'Active') : h('span.okl-muted', {}, s.ramOk ? 'Press Enter to switch' : `Needs ${s.minFreeRamGB} GB free RAM`));
  };
  knob.addEventListener('keydown', (e) => {
    if (!on) return;
    const n = stops.length;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') i = Math.min(n - 1, i + 1);
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') i = Math.max(0, i - 1);
    else if (e.key === 'Home') i = 0;
    else if (e.key === 'End') i = n - 1;
    else if (e.key === 'Enter' || e.key === ' ') { if (stops[i]!.ramOk) pick(stops[i]!.tag); }
    else return;
    e.preventDefault();
    sync();
  });
  face.append(knob);
  wrap.append(face, readout);
  sync();
  return wrap;
}

export function renderPanel(root: HTMLElement, d: Loft | null, act: { power(a: 'start' | 'stop'): void; pick(tag: string): void; best(job: string): void; close(): void; ask?(text: string): void }, note = '', asked: { who: string; text: string }[] = []) {
  const on = d?.power === 'on';
  const ctl = d?.powerControl ?? 'not-set-up';
  const ctlText = ctl === 'ready' ? (on ? 'Turn off' : 'Turn on') : ctl === 'cooling' ? 'Cooling down…' : ctl === 'no-rights' ? 'Power control needs rights' : 'Power control not set up';
  const power = h('button.okl-power', { type: 'button', 'aria-pressed': on ? 'true' : 'false', 'aria-label': `Power, currently ${on ? 'on' : 'off'}. ${ctlText}`, disabled: ctl !== 'ready' || !d }, h('span.okl-power-ring'), h('span.okl-power-label', {}, ctlText));
  power.addEventListener('click', () => act.power(on ? 'stop' : 'start'));
  const active = d?.okkin.model ?? d?.okkin.configured ?? '';
  const dial = buildDial(d?.dial ?? [], active, on, act.pick);
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
    askBox(on, asked, act.ask),
    d?.powerReason ? h('p.okl-muted', {}, d.powerReason) : null,
    h('p.okl-note', { role: 'status', 'aria-live': 'polite' }, note),
  ];
  root.replaceChildren(...parts.filter((p): p is HTMLElement => !!p));
}

export function installOkkinLoft(ctx: Ctx) {
  const view = ctx.office.okkinLoft;
  const pill = h('button.okl-pill', { type: 'button', hidden: true }, "Okkin's loft");
  const panel = h('div.okl-panel', { role: 'dialog', 'aria-modal': 'true', 'aria-label': "Okkin's loft", hidden: true });
  document.body.append(pill, panel);
  let data: Loft | null = null;
  let note = '';
  const asked: { who: string; text: string }[] = [];
  const close = () => { panel.hidden = true; pill.focus(); };
  document.addEventListener('keydown', (e) => {
    if (panel.hidden) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
    if (e.key !== 'Tab') return;
    const f = [...panel.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex="0"]')].filter((x) => !x.hasAttribute('aria-hidden'));
    if (!f.length) return;
    if (!panel.contains(document.activeElement)) { e.preventDefault(); f[0]!.focus(); return; }
    const first = f[0]!, last = f[f.length - 1]!;
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }, true);
  const paint = () =>
    renderPanel(panel, data, {
      power: (a) => void post('/api/bridge/okkin/power', { action: a }).then((r) => ((note = r.body.error ?? (a === 'start' ? 'On' : 'Off')), refresh())),
      pick: (tag) => void post('/api/bridge/okkin/model', { model: tag }).then((r) => ((note = r.body.error ?? `Switched to ${tag}`), refresh())),
      best: (job) => void load(job).then((d) => { data = d; if (d?.pick) void post('/api/bridge/okkin/model', { model: d.pick }).then(() => refresh()); else paint(); }),
      close,
      ask: (text) => {
        asked.push({ who: 'You', text });
        paint();
        void post('/api/bridge/talk', { seat: 'okkin', text }).then((r) => {
          const msgs = (r.body as { messages?: { role: string; text: string }[] }).messages ?? [];
          const bot = [...msgs].reverse().find((m) => m.role === 'bot' || m.role === 'office');
          asked.push({ who: 'Okkin', text: r.status === 200 && bot ? bot.text : r.body.error ?? 'No reply' });
          paint();
        });
      },
    }, note, asked);
  let frozen = false;
  const refresh = async () => {
    if (frozen) return;
    data = await load();
    view.setState({ power: data?.power ?? 'off', busy: data?.okkin.chip === 'working' });
    if (!panel.hidden) paint();
  };
  pill.addEventListener('click', () => {
    panel.hidden = false;
    paint();
    panel.querySelector<HTMLElement>('.okl-close')?.focus();
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
  (window as unknown as { __okkinLoft?: unknown }).__okkinLoft = { open: () => pill.click(), render: (d: Loft) => { frozen = true; data = d; panel.hidden = false; paint(); panel.querySelector<HTMLElement>('.okl-close')?.focus(); view.setState({ power: d.power, busy: d.okkin.chip === 'working' }); } };
}
