// Roster, talk thread, and the desk card. Every window has a ✕; Esc is the modal's own.
import { h, openModal } from '../../ui/dom.js';
import { TALK_LOCKED_NOTE, outboxView } from '../../../shared/hq.js';
import './ui.css';

export type SeatRow = {
  seat: string;
  /** From the server. Missing means the public seat id, never a name invented here. */
  name?: string;
  index: number;
  deskId: string | null;
  chip: string;
  age: string;
  task: string;
  live: boolean;
  model?: string | null;
  state?: string;
  options?: string[];
  configured?: string;
};

export type TalkLine = { id: string; role: string; text: string; at: number };

export type DeskCardView = {
  task: string;
  milestone: string;
  link: string;
  condition: string;
  actions: string[];
  needs: string;
};

const CHIP: Record<string, string> = {
  working: 'working',
  blocked: 'blocked',
  idle: 'idle',
  done: 'done',
  stale: 'stale',
  offline: 'offline',
  switching: 'switching',
};

function chipLabel(chip: string) {
  return CHIP[chip] ?? chip;
}

/** Roster and talk titles. A missing name stays the generic seat id. */
export function seatLabel(row: { seat: string; name?: string }): string {
  const name = row.name?.trim();
  if (name) return name;
  return row.seat === 'okkin' ? 'Okkin' : row.seat;
}

export async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(await res.text());
  return (await res.json()) as T;
}

export async function postJson<T>(url: string, body: unknown): Promise<{ status: number; body: T }> {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const parsed = (await res.json().catch(() => ({}))) as T;
  return { status: res.status, body: parsed };
}

export function openRoster(rows: SeatRow[], actions: { go: (row: SeatRow) => void; talk: (row: SeatRow) => void; desk: (row: SeatRow) => void; switchModel: (name: string) => void; outbox?: () => void }, onClose?: () => void) {
  const list = h('div.hq-list');
  const paint = (next: SeatRow[]) => {
    list.replaceChildren(
      ...next.map((row) => {
        const name = seatLabel(row);
        const model = row.seat === 'okkin' ? h('p.hq-model', {}, `model ${row.model ?? 'unknown'} · ${row.state ?? 'unknown'}`) : null;
        const pick = row.seat === 'okkin' && row.options && row.options.length ? modelPick(row, actions.switchModel) : null;
        return h(
          'article.hq-row',
          {},
          h('div.hq-who', {}, h('strong', {}, name), h('span.hq-chip', { 'data-chip': row.chip }, chipLabel(row.chip)), h('span.hq-age', {}, row.age)),
          h('p.hq-task', {}, row.task || 'No task yet'),
          model,
          pick,
          h(
            'div.hq-actions',
            {},
            h('button.btn', { type: 'button', disabled: row.deskId ? undefined : true, onclick: () => actions.go(row) }, 'Go'),
            h('button.btn', { type: 'button', onclick: () => actions.talk(row) }, 'Talk'),
            h('button.btn', { type: 'button', onclick: () => actions.desk(row) }, 'Desk'),
          ),
        );
      }),
    );
  };
  paint(rows);
  const form = h('form.modal.hq-roster', { role: 'dialog', 'aria-label': 'Crew roster' }, h('header', {}, h('h2', {}, 'Crew'), actions.outbox ? h('button.btn', { type: 'button', onclick: () => actions.outbox?.() }, 'Kavi outbox') : null), h('div.body', {}, list)) as HTMLFormElement;
  const modal = openModal(form, { doing: '📋 the crew roster', onClose: () => onClose?.() });
  return { close: () => modal.close(), paint };
}

function modelPick(row: SeatRow, onSwitch: (name: string) => void) {
  const select = h('select', { 'aria-label': 'Okkin model' }) as HTMLSelectElement;
  for (const name of row.options ?? []) select.append(h('option', { value: name }, name));
  if (row.configured && [...select.options].some((o) => o.value === row.configured)) select.value = row.configured;
  const button = h('button.btn', { type: 'button' }, row.chip === 'switching' ? 'switching…' : 'Switch');
  button.addEventListener('click', () => onSwitch(select.value));
  return h('div.hq-switch', {}, select, button);
}

export function openTalk(seat: string, lines: TalkLine[], chip: string, send: (text: string) => void, onClose?: () => void, name?: string, note?: string | null, locked = false) {
  const log = h('div.hq-log');
  const paint = (next: TalkLine[], nextChip: string) => {
    chipEl.textContent = chipLabel(nextChip);
    chipEl.dataset.chip = nextChip;
    log.replaceChildren(
      ...(!next.length && note ? [h('p', { class: 'hq-line hq-private', role: 'note' }, note)] : (next.length ? next : [{ id: 'empty', role: 'office', text: 'No messages yet.', at: 0 }]).map((line) =>
        h('p', { class: `hq-line hq-${line.role}` }, `${line.role === 'player' ? 'You' : line.role === 'guest' ? 'Guest' : line.role === 'bot' ? seatLabel({ seat, name }) : 'Office'}: ${line.text}`),
      )),
    );
    log.scrollTop = log.scrollHeight;
  };
  const chipEl = h('span.hq-chip', { 'data-chip': chip }, chipLabel(chip));
  const input = h('input', { type: 'text', maxlength: 500, placeholder: 'Say something', 'aria-label': 'Message' }) as HTMLInputElement;
  const sendBtn = h('button.btn.primary', { type: 'submit' }, 'Send') as HTMLButtonElement;
  const status = h('p.hq-private.hq-lock', { role: 'note', hidden: true }) as HTMLParagraphElement;
  const form = h(
    'form.modal.hq-talk',
    { role: 'dialog', 'aria-label': `Talk to ${seat === 'okkin' ? 'Okkin' : seat}` },
    h('header', {}, h('h2', {}, `Talk to ${seatLabel({ seat, name })}`), chipEl),
    h('div.body', {}, log, status),
    h('footer', {}, input, sendBtn),
  ) as HTMLFormElement;
  // Not the owner: the input is locked with a plain note, so a send never ends in a bare 403.
  const lock = (text = TALK_LOCKED_NOTE) => {
    input.disabled = true;
    sendBtn.disabled = true;
    input.placeholder = text;
    input.title = text;
  };
  if (locked) lock();
  paint(lines, chip);
  const modal = openModal(form, { doing: `💬 talking to ${seatLabel({ seat, name })}`, onClose: () => onClose?.() });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (input.disabled) return;
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    send(text);
  });
  const say = (text: string) => {
    status.textContent = text;
    status.hidden = false;
  };
  return { close: () => modal.close(), paint, lock, say, focus: () => input.focus() };
}

/** The Kavi outbox board: owner sees every item (unmapped ones say so); others see a neutral note. */
export function openOutbox(data: Parameters<typeof outboxView>[0], failed = false) {
  const view = failed ? { note: 'Could not load the outbox.', rows: [] } : outboxView(data);
  const body = view.note
    ? [h('p', { class: 'hq-line hq-private', role: 'note' }, view.note)]
    : view.rows.map((r) =>
        h('article.hq-row', {}, h('div.hq-who', {}, h('strong', {}, r.title), h('span', { class: r.mapped ? 'hq-chip' : 'hq-chip hq-unmapped' }, r.seat)), h('p.hq-task', {}, r.text)),
      );
  const form = h('form.modal.hq-outbox', { role: 'dialog', 'aria-label': 'Kavi outbox' }, h('header', {}, h('h2', {}, 'Kavi outbox')), h('div.body', {}, ...body)) as HTMLFormElement;
  const modal = openModal(form, { doing: '📤 the Kavi outbox', reading: true });
  return { close: () => modal.close() };
}

export function openDesk(seat: string, card: DeskCardView, name?: string) {
  const link = card.link ? h('a', { href: card.link, target: '_blank', rel: 'noreferrer' }, card.link) : h('span', {}, 'No link');
  const actions = card.actions.length ? h('ul', {}, ...card.actions.map((a) => h('li', {}, a))) : h('p', {}, 'No actions');
  const form = h(
    'form.modal.hq-desk',
    { role: 'dialog', 'aria-label': `${seatLabel({ seat, name })} desk` },
    h('header', {}, h('h2', {}, `${seatLabel({ seat, name })} desk`)),
    h(
      'div.body',
      {},
      h('p', {}, h('strong', {}, 'Condition '), card.condition),
      h('p', {}, h('strong', {}, 'Needs '), card.needs),
      h('p', {}, h('strong', {}, 'Task '), card.task),
      h('p', {}, h('strong', {}, 'Milestone '), card.milestone),
      h('p', {}, h('strong', {}, 'Link '), link),
      h('p', {}, h('strong', {}, 'Actions')),
      actions,
    ),
  ) as HTMLFormElement;
  const modal = openModal(form, { doing: '🗂️ a desk card', reading: true });
  return { close: () => modal.close() };
}
