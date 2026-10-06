import './ui.css';
import { ageLabel, digestHasLines, type Digest, type DigestBucket, type Decision } from '../../../shared/hq-brief';
import { h, openModal } from '../../ui/dom';

export type StripHooks = {
  yes(block: Decision): void;
  no(block: Decision): void;
  talk(block: Decision): void;
};

/** The loud strip. Color lives only in `.unblock-strip`. Rows are title, seat, age, and one action. */
export class Strip {
  private readonly el: HTMLElement;
  private readonly list: HTMLElement;
  private readonly head: HTMLElement;

  constructor(hud: HTMLElement, private readonly hooks: StripHooks) {
    this.head = h('div.unblock-head', {}, 'Needs a decision');
    this.list = h('div.unblock-list');
    this.el = h('div.unblock-strip.hidden', { role: 'status', 'aria-live': 'polite' }, this.head, this.list);
    hud.append(this.el);
  }

  show(headline: string, blocks: readonly Decision[], now: number) {
    this.el.classList.toggle('hidden', blocks.length === 0);
    if (!blocks.length) {
      document.getElementById('hud')?.style.removeProperty('--unblock-h');
      return;
    }
    this.head.textContent = headline;
    this.list.replaceChildren(...blocks.map((b) => this.row(b, now)));
    const hpx = this.el.offsetHeight;
    document.getElementById('hud')?.style.setProperty('--unblock-h', `${hpx + 8}px`);
  }

  private row(b: Decision, now: number): HTMLElement {
    const actions =
      b.kind === 'yesno'
        ? [
            h('button.unblock-yes', { type: 'button', onclick: () => this.hooks.yes(b) }, 'Yes'),
            h('button.unblock-no', { type: 'button', onclick: () => this.hooks.no(b) }, 'No'),
          ]
        : [h('button.unblock-talk', { type: 'button', onclick: () => this.hooks.talk(b) }, 'Open talk')];
    return h(
      'div.unblock-row',
      {},
      h('span.unblock-title', { title: b.title }, b.title),
      h('span.unblock-seat', {}, b.seat),
      h('span.unblock-age', {}, ageLabel(b.at, now)),
      ...actions,
    );
  }
}

const BUCKETS: { key: keyof Pick<Digest, 'done' | 'progress' | 'blocked'>; label: string }[] = [
  { key: 'done', label: 'Done' },
  { key: 'progress', label: 'In progress' },
  { key: 'blocked', label: 'Blocked' },
];

function bucketEl(label: string, bucket: DigestBucket): HTMLElement | null {
  if (!bucket.seats.length) return null;
  const seats = bucket.seats.map((s) =>
    h(
      'div.hq-seat',
      {},
      h('div.hq-seat-name', {}, s.seat),
      h(
        'ul',
        {},
        ...s.lines.map((line) => h('li', {}, line.title)),
      ),
    ),
  );
  return h(
    'section.hq-bucket',
    {},
    h('h3', {}, label),
    ...seats,
    bucket.capped ? h('p.hq-cap', {}, '6 newest') : null,
  );
}

/** Since last visit. Ordinary panel colors. ✕ and Esc close it (the office puts the mouse back). */
export function openDigest(digest: Digest, onClose: () => void) {
  if (!digestHasLines(digest)) return;
  const body = h('div.hq-digest-body', {}, ...BUCKETS.map((b) => bucketEl(b.label, digest[b.key])));
  const el = h('div.modal.hq-digest', {}, h('header', {}, h('h2', {}, 'Since last visit')), body);
  openModal(el, { doing: '📋 since last visit', onClose });
}
