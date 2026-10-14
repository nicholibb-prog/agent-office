// Router board HUD card (funnel #19): spend vs cap, % free, caps left, failures and the queue.
// Read-only; refreshes every minute; hidden when the board is unavailable.
import { boardLines, type RouterBoard } from '../../../shared/router-board';
import type { Ctx } from '../../core/context';
import { $ } from '../../ui/dom';

const REFRESH_MS = 60_000;

export function installRouterBoard(_ctx: Ctx) {
  const card = document.createElement('div');
  card.className = 'router-board';
  card.setAttribute('aria-label', 'Router board');
  card.style.cssText = 'position:fixed;right:12px;bottom:12px;max-width:340px;padding:8px 10px;border-radius:8px;background:rgba(14,22,44,.86);color:#f3e7c4;font:12px/1.4 system-ui,sans-serif;display:none;z-index:5;pointer-events:none';
  $('hud').appendChild(card);
  async function refresh() {
    try {
      const res = await fetch('/api/router/board', { credentials: 'same-origin', cache: 'no-store' });
      if (!res.ok) { card.style.display = 'none'; return; }
      const b = (await res.json()) as RouterBoard;
      card.replaceChildren(...['Router', ...boardLines(b)].map((t, i) => {
        const d = document.createElement('div');
        d.textContent = t;
        if (i === 0) d.style.fontWeight = '600';
        return d;
      }));
      card.style.display = '';
    } catch {
      card.style.display = 'none';
    }
  }
  void refresh();
  setInterval(() => void refresh(), REFRESH_MS);
}
