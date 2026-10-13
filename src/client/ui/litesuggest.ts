import './litesuggest.css';
// Offering the 2D view (/lite) where the 3D office is hard going: on a phone, with no keys to walk
// with, or on a computer where frames come slowly (see framerate.ts).

import { h } from './dom';

/** Said to stay in 3D: this browser isn't offered the 2D view again (it's in the ☰ menu). */
const DECLINED_KEY = 'agent-office.lite-declined';

/** A touch screen and no mouse: a phone or a tablet, which can't walk around the office anyway. */
export function touchOnly(): boolean {
  return matchMedia('(pointer: coarse)').matches && !matchMedia('(any-pointer: fine)').matches;
}

function declined(): boolean {
  try {
    return localStorage.getItem(DECLINED_KEY) === '1';
  } catch {
    return false;
  }
}

let offered = false;

/** A modal on screen (not just in the page, hidden). */
export function modalShowing(doc: Pick<Document, 'querySelectorAll'> = document): boolean {
  return [...doc.querySelectorAll<HTMLElement>('.modal, [aria-modal="true"], dialog[open]')].some((m) => !m.classList.contains('lite-offer') && m.getClientRects().length > 0);
}

/** How long the slow-3D note stays up before it tucks itself away (ms). Gone that way, it comes back next time: only a choice is remembered. */
export const SLOW_NOTE_MS = 15_000;

function remember() {
  try {
    localStorage.setItem(DECLINED_KEY, '1');
  } catch {
    // storage blocked: it's only this page then
  }
}

/** Offers the 2D view, at most once a page, unless this browser said to stay in 3D before. */
export function offerLite(why: 'touch' | 'slow') {
  if (offered || declined()) return;
  offered = true;
  const say =
    why === 'touch'
      ? '📱 On a phone? The 2D view is made for it: every worker and how it’s doing, its terminal, and the boards.'
      : '🐢 The 3D office is running slowly on this computer. The 2D view has the workers, their terminals and the boards, without the 3D.';
  const slow = why === 'slow';
  const stay = h('button.btn', { type: 'button' }, 'Stay in 3D');
  const close = h('button.lite-offer-x', { type: 'button', 'aria-label': 'Dismiss, and don’t offer again' }, '×');
  const el = h(
    `div.lite-offer.panel${slow ? '.lite-offer-corner' : ''}`,
    { role: slow ? 'status' : 'dialog', 'aria-label': 'Try the 2D view' },
    close,
    h('p', {}, say),
    h('div.lite-offer-btns', {}, h('a.btn.primary', { href: '/lite' }, 'Open the 2D view'), stay),
  );
  for (const b of [stay, close])
    b.addEventListener('click', () => {
      remember();
      el.remove();
    });
  // A real slowdown still gets said, then gets out of the way; it isn't remembered, so it's said again next load.
  if (slow) setTimeout(() => el.remove(), SLOW_NOTE_MS);
  // Never over a modal: while one is showing the note steps aside, and it's back when it closes.
  if (slow) {
    const tick = setInterval(() => {
      if (!el.isConnected) return clearInterval(tick);
      el.classList.toggle('under-modal', modalShowing());
    }, 300);
  }
  document.body.append(el);
}
