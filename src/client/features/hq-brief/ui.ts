import './ui.css';
import { ageLabel, digestHasLines, type Digest, type DigestBucket, type Decision } from '../../../shared/hq-brief';
import { h, openModal } from '../../ui/dom';
import { UNBLOCK_LOCKED_NOTE } from '../../../shared/privacy-view';
import { unlockOwnerControl } from '../../ui/owner-unlock';

export type StripHooks = {
  yes(block: Decision): void;
  no(block: Decision): void;
  talk(block: Decision): void;
  /** After an Unlock owner from the strip. */
  unlocked?(): void;
};

/** The loud strip. Color lives only in `.unblock-strip`. Rows are title, seat, age, and one action. */
export class Strip {
  private readonly el: HTMLElement;
  private readonly list: HTMLElement;
  private readonly head: HTMLElement;
  private readonly lockRow: HTMLElement;
  /** Not the owner: Yes/No are greyed and disabled, and the strip offers Unlock owner. */
  locked = false;

  constructor(hud: HTMLElement, private readonly hooks: StripHooks) {
    this.head = h('div.unblock-head', {}, 'Needs a decision');
    this.list = h('div.unblock-list');
    this.lockRow = h('div.unblock-lock', { hidden: true });
    this.el = h('div.unblock-strip.hidden', { role: 'status', 'aria-live': 'polite' }, this.head, this.list, this.lockRow);
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
    const needs = this.locked && blocks.some((b) => b.kind === 'yesno');
    this.lockRow.hidden = !needs;
    if (needs && !this.lockRow.childElementCount) this.lockRow.append(h('span.unblock-locknote', {}, UNBLOCK_LOCKED_NOTE), unlockOwnerControl(() => this.hooks.unlocked?.()));
    if (!needs) this.lockRow.replaceChildren();
    const hpx = this.el.offsetHeight;
    document.getElementById('hud')?.style.setProperty('--unblock-h', `${hpx + 8}px`);
  }

  private row(b: Decision, now: number): HTMLElement {
    const actions =
      b.kind === 'yesno'
        ? [
            h('button.unblock-yes', { type: 'button', disabled: this.locked || undefined, title: this.locked ? UNBLOCK_LOCKED_NOTE : undefined, onclick: () => this.hooks.yes(b) }, 'Yes'),
            h('button.unblock-no', { type: 'button', disabled: this.locked || undefined, title: this.locked ? UNBLOCK_LOCKED_NOTE : undefined, onclick: () => this.hooks.no(b) }, 'No'),
          ]
        : [h('button.unblock-talk', { type: 'button', onclick: () => this.hooks.talk(b) }, 'Open talk')];
    return h(
      'div.unblock-row',
      {},
      h('span.unblock-title', { title: b.title }, b.title),
      h('span.unblock-seat', { title: b.seat }, b.seatName || b.seat),
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
