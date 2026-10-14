// Okkin's loft panel: one power control, a model dial, honest readouts. Text only (no innerHTML).
import { askPrivateNote } from '../../../shared/hq.js';
import type { Ctx } from '../../core/context';
import { h } from '../../ui/dom';
import { aside, hintTitle, key, onE } from '../../core/hint';
import { OKKIN_LOFT_SPOT, modelShortName } from '../../../shared/okkin-loft';
import { askView, crtView, holoData, type CrtSource, benchText, chosenIndex, stopsView, switchView, type StopView } from './model';

/** A model's short name, with the full tag on hover and for screen readers. */
const tagEl = (sel: 'span.okl-tag', tag: string, extra = '') => h(sel, { title: tag, 'aria-label': `${tag}${extra}` }, `${modelShortName(tag)}${extra}`);
import './ui.css';

type Loft = {
  power: 'on' | 'off';
  powerControl: 'ready' | 'cooling' | 'no-rights' | 'not-set-up';
  powerReason: string | null;
  okkin: { chip: string; configured: string; model: string | null };
  dial: { tag: string; role: string; installed?: boolean | null; allowed?: boolean; ramOk: boolean; minFreeRamGB: number | null }[];
  loaded: { name: string; vramMB: number | null }[];
  queue: number;
  speed: { tokensPerSec: number; model: string } | null;
  bench: Record<string, { tokensPerSec: number }>;
  gpu: { usedMB: number | null; totalMB: number | null; tempC: number | null; fan: string } | null;
  pick: string | null;
  pickReason?: string | null;
  pickMeasured?: boolean | null;
  mock?: boolean;
  owner?: boolean;
  /** Okkin's latest output (the Ask thread), for the CRT. */
  crt?: CrtSource;
  ownerState?: 'not-set-up' | 'locked' | 'unlocked' | 'changed';
};

const NEAR = 3.8;

/** Ask Okkin: a chat box only. Text nodes only (escaped), 500-char cap, memory only on the server. */
function askBox(on: boolean, owner: boolean, lines: { who: string; text: string }[], ask?: (text: string) => void, say?: (text: string) => void): HTMLElement {
  const note = askPrivateNote({ messages: lines, private: !owner });
  const log = h('div.okl-log', { role: 'log', 'aria-live': 'polite', 'aria-label': 'Ask Okkin replies' }, note ? h('p.okl-muted.okl-private', { role: 'note' }, note) : null, ...lines.slice(-6).map((l) => h('p', {}, h('strong', {}, `${l.who} `), l.text)));
  const v = askView(on, owner);
  const input = h('input.okl-input', { type: 'text', maxlength: 500, 'aria-label': 'Ask Okkin', placeholder: v.placeholder, ...(v.hint ? { 'aria-describedby': 'okl-ask-hint' } : {}) }) as HTMLInputElement;
  // Off, Ask stays focusable and clickable and says why it can't go (never a silent grey).
  const form = h('form.okl-ask', { 'data-off': on && owner ? 'no' : 'yes' }, input, h('button.okl-btn', { type: 'submit', 'aria-disabled': on && owner ? 'false' : 'true', 'data-off': on ? 'no' : 'yes' }, 'Ask'));
  // The hint is already on screen once (below the box); a refused submit just keeps focus there.
  form.addEventListener('submit', (e) => { e.preventDefault(); if (v.hint) { input.focus(); return; } const t = input.value.trim().slice(0, 500); if (t && ask) { input.value = ''; ask(t); } });
  void say;
  return h('section', {}, h('h3', {}, 'Ask'), log, form, v.hint ? h('p.okl-muted.okl-ask-hint', { id: 'okl-ask-hint' }, v.hint) : null);
}

/** Unlock owner: the owner passphrase (never stored in the page), or Lock when unlocked. */
function ownerBox(d: Loft | null, act: { unlock?(p: string): void; lock?(): void }): HTMLElement | null {
  if (!d?.ownerState || d.ownerState === 'not-set-up' || d.ownerState === 'changed') return null;
  if (d.ownerState === 'unlocked') {
    const lock = h('button.okl-btn.okl-lock', { type: 'button' }, 'Lock');
    lock.addEventListener('click', () => act.lock?.());
    return h('section.okl-owner', {}, h('p.okl-muted', {}, 'Owner unlocked on this browser.'), lock);
  }
  const input = h('input.okl-input.okl-pass', { type: 'password', autocomplete: 'off', 'aria-label': 'Owner passphrase', placeholder: 'Owner passphrase', maxlength: 1024 }) as HTMLInputElement;
  const form = h('form.okl-ask.okl-unlock', {}, input, h('button.okl-btn', { type: 'submit' }, 'Unlock owner'));
  form.addEventListener('submit', (e) => { e.preventDefault(); const p = input.value; input.value = ''; if (p) act.unlock?.(p); });
  return h('section.okl-owner', {}, h('h3', {}, 'Owner'), form);
}

/** Why the last load failed (shown under the switch), or null. */
let loadError: string | null = null;
let loadStatus: number | null = null;
async function load(job = ''): Promise<Loft | null> {
  try {
    const r = await fetch(`/api/bridge/okkin/loft${job ? `?job=${encodeURIComponent(job)}` : ''}`, { cache: 'no-store', credentials: 'same-origin' });
    loadStatus = r.status;
    if (r.ok) { loadError = null; return (await r.json()) as Loft; }
    const err = ((await r.json().catch(() => ({}))) as { error?: string }).error;
    loadError = `The loft API refused (${r.status}${err ? `: ${err}` : ''}).`;
    return null;
  } catch {
    loadStatus = null;
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
    // Never silently grey: an unusable Load says why when pressed (Turn power on first, Owner only, Not installed…).
    const hint = active ? 'Loaded' : s.usable ? 'Load this model' : s.note;
    const load = h('button.okl-btn.okl-load', { type: 'button', 'aria-disabled': !s.usable || active ? 'true' : 'false', title: hint, 'aria-label': `Load: ${hint}` }, active ? 'Loaded' : 'Load');
    load.addEventListener('click', choose);
    readout.replaceChildren(
      h('span.okl-role', {}, s.role || 'model'),
      tagEl('span.okl-tag', s.tag),
      active ? h('span.okl-active', {}, 'Active') : h('span.okl-muted', {}, s.note),
      load,
      ...(!active && !s.usable ? [h('span.okl-load-hint', {}, hint)] : []),
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

export function renderPanel(root: HTMLElement, d: Loft | null, act: { unlock?(passphrase: string): void; lock?(): void; toggle(): void; power(a: 'start' | 'stop'): void; pick(tag: string): void; best(job: string): void; close(): void; ask?(text: string): void; say?(text: string): void }, note = '', asked: { who: string; text: string }[] = []) {
  const on = d?.power === 'on';
  // The power switch is always there; it only works once the real power config passed. Static icons, never a spinner.
  const sw = switchView(d, loadError, loadStatus);
  // Always focusable and clickable. Locked, a press says why (the reason is also shown under it).
  const power = h('button.okl-power', { type: 'button', 'data-works': sw.works ? 'yes' : 'no', 'data-locked': sw.locked ? 'yes' : 'no', 'aria-pressed': on ? 'true' : 'false', 'aria-disabled': sw.works ? 'false' : 'true', 'aria-label': `Power switch, Okkin ${sw.power}. ${sw.label}${sw.reason ? `. ${sw.reason}` : ''}` }, h('span.okl-power-ring', { 'data-icon': sw.icon, 'aria-hidden': 'true' }, sw.icon === 'setup' ? '🔧' : '⏻'), h('span.okl-power-label', {}, h('span.okl-light', { 'data-light': sw.light, title: sw.tip, 'aria-hidden': 'true' }), sw.label));
  power.title = sw.tip;
  power.addEventListener('click', () => act.toggle());
  const stops = stopsView(d);
  const dial = buildDial(stops, chosenIndex(d, stops), on, act.pick, act.say ?? (() => undefined));
  const stat = (k: string, v: string) => h('div.okl-stat', {}, h('span.okl-k', {}, k), h('span.okl-v', {}, v));
  const gpu = d?.gpu;
  const cards = h('div.okl-cards', {}, ...stops.map((s) => h('div.okl-card', {}, tagEl('span.okl-tag', s.tag), h('span.okl-v', {}, benchText(d, s)))));
  const job = h('select.okl-job', { 'aria-label': 'Job type' }, ...['open', 'quick', 'chat', 'code', 'long'].map((j) => h('option', { value: j }, j)));
  const best = h('button.okl-btn', { type: 'button' }, 'Best model for this job');
  best.addEventListener('click', () => act.best((job as HTMLSelectElement).value));
  const close = h('button.okl-close', { type: 'button', 'aria-label': 'Close' }, '×');
  close.addEventListener('click', act.close);
  const parts: (HTMLElement | null)[] = [
    h('header.okl-head', {}, h('div', {}, h('h2', {}, 'Okkin'), h('p.okl-muted', {}, d ? (on ? `On · ${d.okkin.chip}` : 'Off') : sw.label)), d?.mock ? h('span.okl-mock', {}, 'mock') : null, close),
    h('section.okl-center', {}, h('h3', {}, 'Power'), power, sw.reason ? h('p.okl-muted.okl-power-reason', { 'data-locked': sw.works ? 'no' : 'yes', ...(sw.detail ? { tabindex: '0', title: sw.detail } : {}) }, sw.reason, ...(sw.detail ? [h('span.okl-raw', {}, ` (${sw.detail})`)] : [])) : null, sw.signIn ? h('a.okl-btn.okl-signin', { href: '/' }, 'Sign in again') : null),
    ownerBox(d, act),
    h('section', {}, h('h3', {}, `Model switch · ${stops.length} models`), dial),
    h('section.okl-stats', {},
      stat('Queue', d ? String(d.queue) : '—'),
      stat('Speed', d?.speed ? `${d.speed.tokensPerSec} tok/s` : 'not measured yet'),
      stat('Loaded', d?.loaded.length ? d.loaded.map((m) => `${modelShortName(m.name)}${m.vramMB !== null ? ` · ${m.vramMB} MB` : ''}`).join(', ') : 'none'),
      stat('GPU', gpu ? `${gpu.usedMB ?? '?'} / ${gpu.totalMB ?? '?'} MiB · ${gpu.tempC ?? '?'}°C · fan ${gpu.fan}` : 'no reading'),
    ),
    h('section', {}, h('h3', {}, 'Benchmarks'), cards),
    on ? h('section.okl-row', {}, job, best, d?.pick ? h('span.okl-pick', {}, h('span.okl-v', { title: d.pick, 'aria-label': `Best pick: ${d.pick}` }, `→ ${modelShortName(d.pick)}`), d.pickReason ? h('span.okl-muted', {}, d.pickReason) : null) : null) : h('p.okl-muted.okl-best-hint', {}, 'Best model pick needs the power on.'),
    askBox(on, d?.owner !== false, asked, act.ask, act.say),
    h('p.okl-note', { role: 'status', 'aria-live': 'polite' }, note),
  ];
  root.replaceChildren(...parts.filter((p): p is HTMLElement => !!p));
}

/** What the switch and dial in the room show: the same view the panel uses. */
function sceneState(d: Loft | null) {
  const stops = stopsView(d);
  const sw = switchView(d, loadError, loadStatus);
  const idx = chosenIndex(d, stops);
  const holo = holoData(d);
  const crt = crtView(d);
  return { power: d?.power ?? 'off', busy: d?.okkin.chip === 'working', loading: d?.okkin.chip === 'switching', switchWorks: sw.works, switchLabel: sw.label, light: sw.light, dial: stops.map((s) => ({ role: s.role, status: s.status })), dialIndex: idx, dialRole: stops[idx]?.role, holo, crt } as const;
}

export function installOkkinLoft(ctx: Ctx) {
  const view = ctx.office.okkinLoft;
  const pillLight = h('span.okl-light', { 'data-light': 'setup', 'aria-hidden': 'true' });
  const pill = h('button.okl-pill', { type: 'button', hidden: true }, pillLight, "Okkin's loft");
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
  /** The one power path: the panel button, E at the switch and a click on it in the room all come here. */
  const power = (a: 'start' | 'stop') => {
    note = a === 'start' ? 'Turning on…' : 'Turning off…';
    if (!panel.hidden) paint();
    return post('/api/bridge/okkin/power', { action: a }).then((r) => {
      // Power needs an unlock from the last 5 minutes: show the unlock form again.
      if (r.body.error === 'unlock again') { note = 'Unlock again to switch the power (needs an unlock in the last 5 minutes).'; return post('/api/bridge/okkin/owner/lock', {}).then(() => refresh()); }
      note = r.body.error ? `Power: ${r.body.error}` : a === 'start' ? 'On' : 'Off';
      return refresh();
    });
  };
  const unlock = (passphrase: string) => void post('/api/bridge/okkin/owner/unlock', { passphrase }).then((r) => { // Unlocked shows in the Owner section itself; only a refusal needs a note.
      note = r.status === 200 ? '' : `Unlock: ${r.body.error ?? 'refused'}`; return refresh(); });
  const lock = () => void post('/api/bridge/okkin/owner/lock', {}).then(() => { note = ''; return refresh(); });
  const toggle = () => {
    const sw = switchView(data, loadError, loadStatus);
    if (!sw.works) {
      // Locked: say why, out loud (status line) and in the panel.
      note = sw.reason ?? sw.label;
      openPanel(false);
      return;
    }
    void power(data?.power === 'on' ? 'stop' : 'start');
  };
  const paint = () => {
    // A repaint replaces the panel's DOM: keep keyboard focus on the same control.
    const was = document.activeElement instanceof HTMLElement && panel.contains(document.activeElement) ? document.activeElement.className.split(' ')[0] : null;
    renderPanel(panel, data, {
      unlock,
      lock,
      toggle,
      power: (a) => void power(a),
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
    if (was) panel.querySelector<HTMLElement>(`.${was}`)?.focus();
  };
  let frozen = false;
  // A background repaint mid-press would swap the button under the pointer and lose the click: wait.
  let pressing = false;
  panel.addEventListener('pointerdown', () => { pressing = true; });
  window.addEventListener('pointerup', () => { pressing = false; }, true);
  const refresh = async () => {
    if (frozen) return;
    data = await load();
    view.setState(sceneState(data));
    { const sw = switchView(data, loadError, loadStatus); pillLight.dataset.light = sw.light; pill.title = sw.tip; pill.setAttribute('aria-label', `Okkin's loft. ${sw.tip}`); }
    if (!panel.hidden && !pressing) paint();
  };
  function openPanel(focusClose = true) {
    const was = panel.hidden;
    panel.hidden = false;
    paint();
    if (focusClose || was) panel.querySelector<HTMLElement>(focusClose ? '.okl-close' : '.okl-power')?.focus();
    if (was) void refresh();
  }
  pill.addEventListener('click', () => openPanel());
  // In the room: E at (or a click on) the power switch flips it through the same path as the panel;
  // E at the dial opens the panel on the dial.
  ctx.interactions.define('okkinswitch', {
    reach: 3,
    hint: () => { const sw = switchView(data, loadError, loadStatus); return { k: `${sw.label}|${sw.works}`, parts: [hintTitle('⏻ Okkin power'), sw.works ? '' : aside(sw.label), key('E', sw.works ? sw.label : 'Why locked?')] }; },
    use: onE(() => toggle()),
  });
  ctx.interactions.define('okkindial', {
    reach: 3,
    hint: () => ({ k: '', parts: [hintTitle('🎛 Model switch'), key('E', 'Turn')] }),
    use: onE(() => { openPanel(false); panel.querySelector<HTMLElement>('.okl-knob')?.focus(); }),
  });
  let age = 99;
  ctx.ticks.add('world', ({ dt }) => {
    const p = ctx.player.pos;
    const near = ctx.inOffice() && !ctx.upTop() && Math.hypot(p.x - OKKIN_LOFT_SPOT.x, p.z - OKKIN_LOFT_SPOT.z) < NEAR;
    pill.hidden = !near;
    view.setNear(ctx.inOffice() && Math.hypot(p.x - OKKIN_LOFT_SPOT.x, p.z - OKKIN_LOFT_SPOT.z) < 16);
    age += dt;
    if (age < 5) return;
    age = 0;
    if (ctx.inOffice()) void refresh();
  });
  (window as unknown as { __okkinLoft?: unknown }).__okkinLoft = { open: () => pill.click(), toggle, render: (d: Loft) => { frozen = true; data = d; { const sw = switchView(d, null, 200); pillLight.dataset.light = sw.light; pill.title = sw.tip; } panel.hidden = false; paint(); panel.querySelector<HTMLElement>('.okl-close')?.focus(); view.setState(sceneState(d)); } };
}

declare module '../../world/types' {
  interface InteractKinds {
    okkinswitch: true;
    okkindial: true;
  }
}
