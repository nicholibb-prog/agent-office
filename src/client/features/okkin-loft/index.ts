// Okkin's loft panel: one power control, a model dial, honest readouts. Text only (no innerHTML).
import type { Ctx } from '../../core/context';
import { h } from '../../ui/dom';
import { OKKIN_LOFT_SPOT, modelShortName } from '../../../shared/okkin-loft';
import { chosenIndex, stopsView, switchView, type StopView } from './model';

/** A model's short name, with the full tag on hover and for screen readers. */
const tagEl = (sel: 'span.okl-tag', tag: string, extra = '') => h(sel, { title: tag, 'aria-label': `${tag}${extra}` }, `${modelShortName(tag)}${extra}`);
import './ui.css';

type Loft = {
  power: 'on' | 'off';
  powerControl: 'ready' | 'cooling' | 'no-rights' | 'not-set-up';
  powerReason: string | null;
  okkin: { chip: string; configured: string; model: string | null };
  dial: { tag: string; role: string; installed?: boolean; ramOk: boolean; minFreeRamGB: number | null }[];
  loaded: { name: string; vramMB: number | null }[];
  queue: number;
  speed: { tokensPerSec: number; model: string } | null;
  bench: Record<string, { tokensPerSec: number }>;
  gpu: { usedMB: number | null; totalMB: number | null; tempC: number | null; fan: string } | null;
  pick: string | null;
  pickReason?: string | null;
  pickMeasured?: boolean | null;
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

/** Why the last load failed (shown under the switch), or null. */
let loadError: string | null = null;
async function load(job = ''): Promise<Loft | null> {
  try {
    const r = await fetch(`/api/bridge/okkin/loft${job ? `?job=${encodeURIComponent(job)}` : ''}`, { cache: 'no-store', credentials: 'same-origin' });
    if (r.ok) { loadError = null; return (await r.json()) as Loft; }
    const err = ((await r.json().catch(() => ({}))) as { error?: string }).error;
    loadError = `The loft API refused (${r.status}${err ? `: ${err}` : ''}).`;
    return null;
  } catch {
    loadError = 'The loft API could not be reached.';
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

/**
 * The model switch: a rotary knob over every stop (never hidden; 'Not installed' ones stay on it).
 * role=slider; arrows/Home/End turn it, Enter or Space loads the stop when power is on and it's installed.
 */
export function buildDial(stops: StopView[], start: number, on: boolean, pick: (tag: string) => void, say: (text: string) => void): HTMLElement {
  const wrap = h('div.okl-dialwrap');
  let i = Math.min(Math.max(0, start), stops.length - 1);
  const face = h('div.okl-face');
  const knob = h('div.okl-knob', { role: 'slider', tabindex: '0', 'aria-label': 'Model switch', 'aria-valuemin': '0', 'aria-valuemax': String(stops.length - 1) }, h('span.okl-pointer'));
  const readout = h('p.okl-readout', { 'aria-live': 'polite' });
  const choose = () => {
    const s = stops[i]!;
    if (s.usable) pick(s.tag);
    else say(`${modelShortName(s.tag)}: ${s.note}`);
  };
  stops.forEach((s, k) => {
    const ang = dialAngle(k, stops.length);
    const lab = h('button.okl-tick', { type: 'button', tabindex: '-1', 'aria-hidden': 'true', 'data-status': s.status, style: `--a:${ang}deg`, title: `${s.tag} · ${s.note}` }, s.role || String(k + 1));
    lab.addEventListener('click', () => { i = k; sync(); });
    face.append(lab);
  });
  const sync = () => {
    const s = stops[i]!;
    const active = k0 === i && on;
    knob.style.setProperty('--a', `${dialAngle(i, stops.length)}deg`);
    knob.setAttribute('aria-valuenow', String(i));
    knob.setAttribute('aria-valuetext', `${s.role || 'model'}: ${modelShortName(s.tag)} (${s.tag}), ${active ? 'active' : s.note.toLowerCase()}`);
    const load = h('button.okl-btn.okl-load', { type: 'button', disabled: !s.usable || active }, active ? 'Loaded' : 'Load');
    load.addEventListener('click', choose);
    readout.replaceChildren(
      h('span.okl-role', {}, s.role || 'model'),
      tagEl('span.okl-tag', s.tag),
      active ? h('span.okl-active', {}, 'Active') : h(s.status === 'not installed' ? 'span.okl-missing' : 'span.okl-muted', {}, on ? s.note : `Off · ${s.note}`),
      load,
    );
  };
  const k0 = i;
  knob.addEventListener('keydown', (e) => {
    const n = stops.length;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') i = (i + 1) % n;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') i = (i - 1 + n) % n;
    else if (e.key === 'Home') i = 0;
    else if (e.key === 'End') i = n - 1;
    else if (e.key === 'Enter' || e.key === ' ') choose();
    else return;
    e.preventDefault();
    sync();
  });
  knob.addEventListener('click', () => { i = (i + 1) % stops.length; sync(); });
  face.append(knob);
  wrap.append(face, readout);
  sync();
  return wrap;
}

export function renderPanel(root: HTMLElement, d: Loft | null, act: { power(a: 'start' | 'stop'): void; pick(tag: string): void; best(job: string): void; close(): void; ask?(text: string): void; say?(text: string): void }, note = '', asked: { who: string; text: string }[] = []) {
  const on = d?.power === 'on';
  // The power switch is always there; it only works once the real power config passed. Static icons, never a spinner.
  const sw = switchView(d, loadError);
  const power = h('button.okl-power', { type: 'button', 'data-works': sw.works ? 'yes' : 'no', 'aria-pressed': on ? 'true' : 'false', 'aria-label': `Power switch, Okkin ${sw.power}. ${sw.label}`, disabled: !sw.works }, h('span.okl-power-ring', { 'data-icon': sw.icon, 'aria-hidden': 'true' }, sw.icon === 'setup' ? '🔧' : '⏻'), h('span.okl-power-label', {}, sw.label));
  power.addEventListener('click', () => act.power(on ? 'stop' : 'start'));
  const stops = stopsView(d);
  const dial = buildDial(stops, chosenIndex(d, stops), on, act.pick, act.say ?? (() => undefined));
  const stat = (k: string, v: string) => h('div.okl-stat', {}, h('span.okl-k', {}, k), h('span.okl-v', {}, v));
  const gpu = d?.gpu;
  const cards = h('div.okl-cards', {}, ...stops.map((s) => h('div.okl-card', {}, tagEl('span.okl-tag', s.tag), h('span.okl-v', {}, s.status === 'not installed' ? 'not installed' : d?.bench[s.tag] ? `${d.bench[s.tag]!.tokensPerSec} tok/s` : 'not measured yet'))));
  const job = h('select.okl-job', { 'aria-label': 'Job type' }, ...['open', 'quick', 'chat', 'code', 'long'].map((j) => h('option', { value: j }, j)));
  const best = h('button.okl-btn', { type: 'button' }, 'Best model for this job');
  best.addEventListener('click', () => act.best((job as HTMLSelectElement).value));
  const close = h('button.okl-close', { type: 'button', 'aria-label': 'Close' }, '×');
  close.addEventListener('click', act.close);
  const parts: (HTMLElement | null)[] = [
    h('header.okl-head', {}, h('div', {}, h('h2', {}, 'Okkin'), h('p.okl-muted', {}, d ? (on ? `On · ${d.okkin.chip}` : 'Off') : 'Okkin offline')), d?.mock ? h('span.okl-mock', {}, 'mock') : null, close),
    h('section.okl-center', {}, h('h3', {}, 'Power'), power, sw.reason ? h('p.okl-muted.okl-power-reason', {}, sw.reason) : null),
    h('section', {}, h('h3', {}, `Model switch · ${stops.length} models`), dial),
    h('section.okl-stats', {},
      stat('Queue', d ? String(d.queue) : '—'),
      stat('Speed', d?.speed ? `${d.speed.tokensPerSec} tok/s` : 'not measured yet'),
      stat('Loaded', d?.loaded.length ? d.loaded.map((m) => `${modelShortName(m.name)}${m.vramMB !== null ? ` · ${m.vramMB} MB` : ''}`).join(', ') : 'none'),
      stat('GPU', gpu ? `${gpu.usedMB ?? '?'} / ${gpu.totalMB ?? '?'} MiB · ${gpu.tempC ?? '?'}°C · fan ${gpu.fan}` : 'no reading'),
    ),
    h('section', {}, h('h3', {}, 'Benchmarks'), cards),
    on ? h('section.okl-row', {}, job, best, d?.pick ? h('span.okl-pick', {}, h('span.okl-v', { title: d.pick, 'aria-label': `Best pick: ${d.pick}` }, `→ ${modelShortName(d.pick)}`), d.pickReason ? h('span.okl-muted', {}, d.pickReason) : null) : null) : h('p.okl-muted.okl-best-hint', {}, 'Best model pick needs the power on.'),
    askBox(on, asked, act.ask),
    h('p.okl-note', { role: 'status', 'aria-live': 'polite' }, note),
  ];
  root.replaceChildren(...parts.filter((p): p is HTMLElement => !!p));
}

/** What the switch and dial in the room show: the same view the panel uses. */
function sceneState(d: Loft | null) {
  const stops = stopsView(d);
  const sw = switchView(d, loadError);
  return { power: d?.power ?? 'off', busy: d?.okkin.chip === 'working', switchWorks: sw.works, switchLabel: sw.label, dial: stops.map((s) => ({ role: s.role, status: s.status })), dialIndex: chosenIndex(d, stops) } as const;
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
      say: (t) => { note = t; paint(); },
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
    view.setState(sceneState(data));
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
  (window as unknown as { __okkinLoft?: unknown }).__okkinLoft = { open: () => pill.click(), render: (d: Loft) => { frozen = true; data = d; panel.hidden = false; paint(); panel.querySelector<HTMLElement>('.okl-close')?.focus(); view.setState(sceneState(d)); } };
}
