// Roster, talk thread, and the desk card. Every window has a ✕; Esc is the modal's own.
import { h, openModal } from '../../ui/dom.js';
import './ui.css';

export type SeatRow = {
  seat: string;
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

export function openRoster(rows: SeatRow[], actions: { go: (row: SeatRow) => void; talk: (row: SeatRow) => void; desk: (row: SeatRow) => void; switchModel: (name: string) => void }, onClose?: () => void) {
  const list = h('div.hq-list');
  const paint = (next: SeatRow[]) => {
    list.replaceChildren(
      ...next.map((row) => {
        const name = row.seat === 'okkin' ? 'Okkin' : row.seat;
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
  const form = h('form.modal.hq-roster', { role: 'dialog', 'aria-label': 'Crew roster' }, h('header', {}, h('h2', {}, 'Crew')), h('div.body', {}, list)) as HTMLFormElement;
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

export function openTalk(seat: string, lines: TalkLine[], chip: string, send: (text: string) => void, onClose?: () => void) {
  const log = h('div.hq-log');
  const paint = (next: TalkLine[], nextChip: string) => {
    chipEl.textContent = chipLabel(nextChip);
    chipEl.dataset.chip = nextChip;
    log.replaceChildren(
      ...(next.length ? next : [{ id: 'empty', role: 'office', text: 'No messages yet.', at: 0 }]).map((line) =>
        h('p', { class: `hq-line hq-${line.role}` }, `${line.role === 'player' ? 'You' : line.role === 'bot' ? (seat === 'okkin' ? 'Okkin' : seat) : 'Office'}: ${line.text}`),
      ),
    );
    log.scrollTop = log.scrollHeight;
  };
  const chipEl = h('span.hq-chip', { 'data-chip': chip }, chipLabel(chip));
  const input = h('input', { type: 'text', maxlength: 500, placeholder: 'Say something', 'aria-label': 'Message' }) as HTMLInputElement;
  const form = h(
    'form.modal.hq-talk',
    { role: 'dialog', 'aria-label': `Talk to ${seat === 'okkin' ? 'Okkin' : seat}` },
    h('header', {}, h('h2', {}, seat === 'okkin' ? 'Talk to Okkin' : `Talk to ${seat}`), chipEl),
    h('div.body', {}, log),
    h('footer', {}, input, h('button.btn.primary', { type: 'submit' }, 'Send')),
  ) as HTMLFormElement;
  paint(lines, chip);
  const modal = openModal(form, { doing: `💬 talking to ${seat === 'okkin' ? 'Okkin' : seat}`, onClose: () => onClose?.() });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    send(text);
  });
  return { close: () => modal.close(), paint, focus: () => input.focus() };
}

export function openDesk(seat: string, card: DeskCardView) {
  const link = card.link ? h('a', { href: card.link, target: '_blank', rel: 'noreferrer' }, card.link) : h('span', {}, 'No link');
  const actions = card.actions.length ? h('ul', {}, ...card.actions.map((a) => h('li', {}, a))) : h('p', {}, 'No actions');
  const form = h(
    'form.modal.hq-desk',
    { role: 'dialog', 'aria-label': `${seat} desk` },
    h('header', {}, h('h2', {}, seat === 'okkin' ? 'Okkin’s desk' : `${seat} desk`)),
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
