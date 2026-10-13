import './ui.css';
import { glanceHasLines, timeLabel, type GlanceBucket, type SinceCloseGlance } from '../../../shared/since-close';
import { h } from '../../ui/dom';

const BUCKETS: { key: keyof Pick<SinceCloseGlance, 'finished' | 'blocked' | 'needsOwner' | 'inProgress' | 'offline'>; label: string }[] = [
  { key: 'finished', label: 'Finished' },
  { key: 'blocked', label: 'Blocked' },
  { key: 'needsOwner', label: 'Needs owner' },
  { key: 'inProgress', label: 'In progress' },
  { key: 'offline', label: 'Offline' },
];

function bucketEl(label: string, bucket: GlanceBucket, offlineNeutral: boolean): HTMLElement | null {
  if (!bucket.lines.length) return null;
  const items = bucket.lines.map((line) => {
    const seat = line.seat ? ` · ${line.seat}` : '';
    const title = offlineNeutral && line.kind === 'offline' ? `Offline · since close${seat}` : line.title;
    return h(
      'li',
      {},
      h('span.src', {}, line.source),
      h('span.title', { title: line.title }, title),
      h('span.when', {}, timeLabel(line.at)),
    );
  });
  return h(
    'section',
    {},
    h('h3', {}, label),
    h('ul', {}, ...items),
    bucket.capped ? h('p.cap', {}, 'Newest 6') : null,
  );
}

/** Since-close panel. Ordinary colors. ✕ dismisses for this open session. Read-only — no action buttons. */
export class SinceClosePanel {
  private readonly el: HTMLElement;
  private readonly body: HTMLElement;
  private readonly meta: HTMLElement;

  constructor(hud: HTMLElement, onDismiss: () => void) {
    this.meta = h('p.since-close-meta', {});
    this.body = h('div');
    const close = h('button.since-close-x', { type: 'button', 'aria-label': 'Dismiss' }, '✕');
    close.addEventListener('click', () => {
      this.hide();
      onDismiss();
    });
    this.el = h(
      'div.since-close.hidden',
      { role: 'dialog', 'aria-label': 'Since close' },
      h('header', {}, h('h2', {}, 'Since close'), close),
      this.meta,
      this.body,
    );
    hud.append(this.el);
  }

  show(glance: SinceCloseGlance) {
    const reason =
      glance.closeReason === 'unexpected' ? 'Office was closed' : glance.closeReason === 'owner' ? 'Closed by owner' : '';
    const since = glance.since ? timeLabel(glance.since) : '';
    this.meta.textContent = [reason, since ? `from ${since}` : ''].filter(Boolean).join(' · ');

    if (!glanceHasLines(glance)) {
      this.body.replaceChildren(h('p.since-close-empty', {}, 'Nothing new since close.'));
    } else {
      const sections = BUCKETS.map((b) => bucketEl(b.label, glance[b.key], b.key === 'offline')).filter(Boolean);
      this.body.replaceChildren(...(sections as HTMLElement[]));
    }
    this.el.classList.remove('hidden');
  }

  hide() {
    this.el.classList.add('hidden');
  }

  get visible() {
    return !this.el.classList.contains('hidden');
  }
}

/** Calm closed chip — never alarm styling. */
export function mountClosedChip(host: HTMLElement): { set(label: string | null): void } {
  const chip = h('span.office-closed-chip.hidden', { role: 'status' });
  host.append(chip);
  return {
    set(label: string | null) {
      if (!label) {
        chip.classList.add('hidden');
        chip.textContent = '';
        return;
      }
      chip.textContent = label;
      chip.classList.remove('hidden');
    },
  };
}
