// Model use today (funnel #19): a read-only HUD card for the owner only. Spend vs cap, % free,
// caps left, failures and the queue; "Model routing is off" while the router is off; hidden for
// anyone not unlocked as owner. Refreshes every minute and when the owner state changes.
import './ui.css';
import type { RouterBoardReply } from '../../../shared/router-board';
import type { Ctx } from '../../core/context';
import { $ } from '../../ui/dom';
import { onOwner } from '../../ui/owner-state';
import { cardView } from './view';

const REFRESH_MS = 60_000;

export function installRouterBoard(_ctx: Ctx) {
  const card = document.createElement('div');
  card.className = 'router-board';
  card.hidden = true;
  card.setAttribute('aria-label', 'Model use today');
  $('hud').appendChild(card);
  async function refresh() {
    let status = 0;
    let body: RouterBoardReply | null = null;
    try {
      const res = await fetch('/api/router/board', { credentials: 'same-origin', cache: 'no-store' });
      status = res.status;
      if (res.ok) body = (await res.json()) as RouterBoardReply;
    } catch {
      status = 0;
    }
    const v = cardView(status, body);
    if (v.hidden) {
      card.hidden = true;
      card.replaceChildren();
      return;
    }
    const title = document.createElement('div');
    title.className = 'router-board__title';
    title.textContent = v.title;
    card.replaceChildren(title, ...v.lines.map((t) => {
      const d = document.createElement('div');
      if (v.note) d.className = 'router-board__note';
      d.textContent = t;
      return d;
    }));
    card.hidden = false;
  }
  void refresh();
  onOwner(() => void refresh());
  setInterval(() => void refresh(), REFRESH_MS);
}
