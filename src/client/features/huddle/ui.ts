import './ui.css';
import { canHuddle, rosterMark, workerQuorum, SHARE_STUB, TALK_STUB } from '../../../shared/huddle';
import { NEEDS_OWNER, OFFLINE, QUEUED_FOR_CREW } from '../../../shared/seat-provider';
import type { Net } from '../../net';
import { store } from '../../state';
import { h, openModal, toast } from '../../ui/dom';

/** The huddle window: who is in, the shared notes, and the decision log. */
export function openHuddleWindow(net: Net): void {
  const body = h('div.body');
  const title = h('h2', {}, 'Huddle');
  const el = h('div.modal.huddle-window', { role: 'dialog', 'aria-label': 'Huddle' }, h('header', {}, title), body);
  const draw = () => {
    const active = document.activeElement;
    if (body.contains(active) && (active instanceof HTMLTextAreaElement || active instanceof HTMLInputElement)) return;
    const state = store.huddle;
    const current = state.current;
    const room = state.seats.find((s) => s.id === 'meeting-room');
    const youIn = !!current && !!rosterMark(current, 'peer', store.you);
    title.textContent = current ? 'Huddle' : 'Huddle';
    const occupants = current?.occupants ?? [];
    const agenda = h('textarea', { rows: '3' }, current?.agenda ?? '') as HTMLTextAreaElement;
    const context = h('textarea', { rows: '4' }, current?.context ?? '') as HTMLTextAreaElement;
    const decision = h('input', { type: 'text', placeholder: 'What was decided' }) as HTMLInputElement;
    const owner = h('select') as HTMLSelectElement;
    for (const o of occupants) owner.append(h('option', { value: o.name }, o.name));
    const needs = h('input', { type: 'checkbox' }) as HTMLInputElement;
    const warn = room?.label === NEEDS_OWNER || room?.label === OFFLINE ? h('p.warn', {}, room.label) : undefined;
    const leave = youIn ? h('button.btn', { type: 'button', onclick: () => net.send({ t: 'huddle.leave' }) }, 'Leave') : undefined;
    const close = youIn ? h('button.btn', { type: 'button', onclick: () => net.send({ t: 'huddle.close' }) }, 'Close huddle') : undefined;
    body.replaceChildren(
      h('p.seat-line', {}, room ? `Meeting room · ${room.provider} · ${room.label}` : 'Meeting room'),
      h('p.seat-line', {}, `Local model · ${state.ollama.model ?? 'unset'} · ${state.ollama.state}`),
      ...(warn ? [warn] : []),
      room?.reply ? h('p', {}, `Reply: ${room.reply}`) : h('p.muted', {}, 'No reply yet.'),
      h('p', {}, current ? (workerQuorum(current) ? 'Two or more workers are in.' : 'Needs another idle worker before the room is full.') : 'Walk into the meeting room to join.'),
      h('h3', {}, 'In the room'),
      occupants.length
        ? h('ul', {}, ...occupants.map((o) => h('li', {}, `${o.name} · ${rosterMark(current, o.kind, o.id)}`)))
        : h('p.muted', {}, 'Nobody yet.'),
      h('h3', {}, 'Front desks'),
      h(
        'ul',
        {},
        ...state.seats
          .filter((s) => s.id !== 'meeting-room')
          .map((s) => h('li', {}, `${s.id} · ${s.provider} · ${s.label}${s.reply ? ` · ${s.reply}` : ''}`)),
      ),
      h('h3', {}, 'Agenda'),
      agenda,
      h('h3', {}, 'Context'),
      context,
      h('button.btn', {
        type: 'button',
        onclick: () => net.send({ t: 'huddle.agenda', agenda: agenda.value, context: context.value }),
      }, 'Save agenda'),
      h('button.btn.primary', {
        type: 'button',
        onclick: () => net.send({ t: 'huddle.send' }),
      }, room?.label === QUEUED_FOR_CREW ? 'Queued for crew' : 'Send agenda'),
      h('h3', {}, 'Invite an idle worker'),
      h(
        'ul',
        {},
        ...[...store.workers.values()]
          .filter((w) => canHuddle(w))
          .map((w) =>
            h('li', {}, w.name, ' ', h('button.btn', { type: 'button', onclick: () => net.send({ t: 'huddle.invite', workerId: w.id }) }, 'Invite')),
          ),
      ),
      h('h3', {}, 'Decision log'),
      current?.decisions.length
        ? h('ul', {}, ...current.decisions.map((d) => h('li', {}, `${d.owner}${d.needsOwner ? ' · Needs owner' : ''}: ${d.text}`)))
        : h('p.muted', {}, 'Nothing logged yet.'),
      h('label', {}, 'Owner ', owner),
      decision,
      h('label', {}, needs, ' Needs owner'),
      h('button.btn', {
        type: 'button',
        onclick: () => net.send({ t: 'huddle.decide', text: decision.value, owner: owner.value, needsOwner: needs.checked }),
      }, 'Log decision'),
      h('p.stubs', {}, h('button.btn', { type: 'button', onclick: () => toast(TALK_STUB) }, 'Talk'), ' ', h('button.btn', { type: 'button', onclick: () => toast(SHARE_STUB) }, 'Shared view')),
      ...(leave ? [leave] : []),
      ...(close ? [close] : []),
    );
  };
  draw();
  const off = store.on('huddle', draw);
  const workersOff = store.on('workers', draw);
  openModal(el, { doing: '🤝 in a huddle', onClose: () => { off(); workersOff(); } });
}
