// A click on a desk laptop opens that worker's desktop large. It is the same paintDesk picture as
// the lid, redrawn while the window is open so a working worker keeps scrolling. Esc and the ✕
// close it (see openModal) and the office puts you back into mouse-look. E at the desk is untouched.
import './screenview.css';
import type { Ctx } from '../../core/context';
import { store } from '../../state';
import { h, openModal, type Modal } from '../../ui/dom';
import { paintDesk, workerDesktop } from './desktop';

/** Opens the enlarged desktop for a worker when something clicks their laptop. */
export function installDeskScreen(ctx: Ctx) {
  let modal: Modal | null = null;
  let current: string | null = null;
  let off: (() => void) | null = null;

  function open(workerId: string) {
    const worker = store.workers.get(workerId);
    if (!worker) return;
    if (current === workerId && modal) return;
    modal?.close();

    const canvas = h('canvas');
    canvas.width = 1600;
    canvas.height = 900;
    const title = h('h2', {}, `${worker.name}'s desktop`);
    const closeBtn = h('button.btn.close', { type: 'button', 'aria-label': 'Close', title: 'Close (Esc)' }, '✕');
    const el = h(
      'div.modal.desk-screen',
      { role: 'dialog', 'aria-label': `${worker.name}'s desktop` },
      h('header', {}, title, closeBtn),
      h('div.desk-screen-stage', {}, canvas),
      h('footer', {}, h('span.grow', {}, 'Live desk view, same as the laptop. E at the desk still opens the terminal.')),
    );

    const paint = () => {
      const w = store.workers.get(workerId);
      if (!w) return false;
      title.textContent = `${w.name}'s desktop`;
      el.setAttribute('aria-label', `${w.name}'s desktop`);
      const wall = Date.now();
      const ctx2d = canvas.getContext('2d');
      if (!ctx2d) return false;
      paintDesk(ctx2d, canvas.width, canvas.height, workerDesktop(w, store.screens.get(workerId), wall, wall, ctx.reduceMotion.matches));
      return true;
    };
    paint();

    current = workerId;
    const m = openModal(el, {
      doing: `🖥️ ${worker.name}'s desktop`,
      onClose: () => {
        if (modal !== m) return;
        current = null;
        off?.();
        off = null;
        modal = null;
      },
    });
    modal = m;
    closeBtn.addEventListener('click', () => m.close());
    off = ctx.ticks.add('hud', () => {
      if (!paint()) m.close();
    });
  }

  return { open };
}
