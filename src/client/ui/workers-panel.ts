// The workers list in the sidebar: every worker on your floor, what it's on, and what it has spent.
// One that needs you goes to the top, in red, saying what it's asking and for how long.

import { needyFirst } from '../nextup';
import { store } from '../state';
import { DESK_BY_ID } from '../../shared/layout';
import { rosterMark } from '../../shared/huddle';
import { NEEDS_OWNER, OFFLINE, QUEUED_FOR_CREW } from '../../shared/seat-provider';
import { $, h, STATUS_LABEL, timeAgo } from './dom';
import { usageLabel, usageTitle } from './usage';
import { providerLabel, providerUsageState, providerWaitingLabel, resolvedProvider, modelBadge } from './provider';

/** Whether the Board agents row was left open, so a re-render keeps it that way. Collapsed by default. */
let boardAgentsOpen = false;

/**
 * The status pill: only for a status the office actually knows (see STATUS_LABEL), else no pill at
 * all. Never a made-up default.
 */
export function workerPill(status: string, asking: boolean, lost: boolean): { text: string; cls: string; lost: boolean } | null {
  if (lost) return { text: 'worktree deleted', cls: 'lost', lost: true };
  if (asking) return { text: 'NEEDS YOU', cls: status, lost: false };
  const text = Object.prototype.hasOwnProperty.call(STATUS_LABEL, status) ? STATUS_LABEL[status] : undefined;
  return text ? { text, cls: status, lost: false } : null;
}

export function renderWorkers(onOpen: (id: string) => void) {
  const ul = $('workers');
  ul.replaceChildren();
  const workers = needyFirst(store.workers.values());
  // Crew seats in the main list; the board agents at the Issues, PR and queue kiosks fold into one
  // collapsed row underneath, so they're still there but don't crowd the crew.
  const isBoard = (w: { deskId: string }) => !!DESK_BY_ID.get(w.deskId)?.station;
  const boardRows: HTMLElement[] = [];
  for (const w of workers) {
    const into = isBoard(w) ? boardRows : null;
    const asking = w.status === 'needs_input' && !w.lost;
    const provider = w.kind === 'agent' ? providerLabel(w.provider, store.project) : null;
    const providerKind = w.kind === 'agent' ? resolvedProvider(w.provider, store.project) : undefined;
    const usageState = w.kind === 'agent' ? providerUsageState(w.provider, store.project, w.usage) : undefined;
    const waiting = usageState === 'waiting' ? providerWaitingLabel(providerKind, store.project) : '';
    const usageNote = usageState === 'untracked' ? ' · usage untracked' : waiting ? ` · ${waiting}` : '';
    const badge = w.kind === 'agent' ? modelBadge(w.provider, w.model, w.effort, w.usage?.model) : undefined;
    const inMeeting = rosterMark(store.huddle.current, 'worker', w.id);
    const seat = store.huddle.seats.find((s) => s.id === w.deskId);
    const seatNote = seat && (seat.label === NEEDS_OWNER || seat.label === OFFLINE || seat.label === QUEUED_FOR_CREW) ? seat.label : undefined;
    const sub = [provider && `⚙️ ${provider}${badge ? ` · ${badge}` : ''}${usageNote}`, w.worktree && `🌿 ${w.worktree.branch}`, w.repos?.length && `🗂️ ${w.repos.length + 1} repos`, w.pr && `🔀 PR #${w.pr.number}`, inMeeting && `🤝 ${inMeeting}`, seatNote, w.activity || w.title || w.prompt].filter(Boolean).join(' · ');
    // What it's stopped on, and since when, on a line of its own under its name.
    const ask = asking ? h('span.ask', {}, `🙋 ${w.activity ?? 'Waiting on an answer'}${w.waitingSince ? ` · ${timeAgo(w.waitingSince)}` : ''}`) : null;
    const pill = workerPill(w.status, asking, !!w.lost);
    (into ? (el: HTMLElement) => into.push(el) : (el: HTMLElement) => ul.append(el))(
      h(
        'li',
        { class: asking ? 'needs-you-row' : '', onclick: () => onOpen(w.id), title: asking ? `${w.name} needs you: open its terminal to answer` : `Open ${w.name}'s terminal` },
        h('span.dot', { style: `background:${w.color}` }),
        h('span.name', {}, w.name, sub ? h('span.sub', {}, sub) : null,
          usageState === 'tracked' && w.usage ? h('span.cost', { title: usageTitle(w.usage, providerKind) }, usageLabel(w.usage, providerKind)) : null),
        pill ? h('span.pill', { class: pill.cls, title: pill.lost ? 'Its worktree was deleted outside agent-office: open it to fix it' : undefined }, pill.text) : null,
        ask,
      ),
    );
  }
  if (boardRows.length) {
    const open = boardAgentsOpen;
    const details = h('details.board-agents', open ? { open: '' } : {}, h('summary', {}, `Board agents · ${boardRows.length}`), h('ul', {}, ...boardRows)) as HTMLDetailsElement;
    details.addEventListener('toggle', () => (boardAgentsOpen = details.open));
    ul.append(h('li.board-agents-row', {}, details));
  }
  if (!workers.filter((w) => !isBoard(w)).length) ul.append(h('li.empty', {}, 'Walk up to a desk and press E to hire one'));
  // The count is the workers hired onto desks and bean bags (and a meeting's table): the board agents
  // standing at the Issues, PR and queue kiosks are listed but aren't counted.
  const hired = workers.filter((w) => !DESK_BY_ID.get(w.deskId)?.station).length;
  $('worker-count').textContent = hired ? String(hired) : '';
  $('workers-panel').classList.toggle('needs-you-panel', workers.some((w) => w.status === 'needs_input'));
}
