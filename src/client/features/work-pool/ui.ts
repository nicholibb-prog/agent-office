import './ui.css';
import type { PoolCard } from '../../../shared/pool';
import { store } from '../../state';
import { h, openModal, toast } from '../../ui/dom';
import { visiblePoolText } from './bidi';

interface JobText {
  id: string;
  title: string;
  body: string;
  hash: string;
  state: string;
  updatedAt: number;
  level: number;
  approval?: string;
  targetBot?: string;
}

function onFloor(url: string): string {
  return store.floor ? `${url}${url.includes('?') ? '&' : '?'}floor=${encodeURIComponent(store.floor)}` : url;
}

/** Read jobs that need approval. Owner approval stays disabled until the full text and its hash load. */
export function openPoolApproval() {
  const close = h('button.btn.close', { type: 'button', 'aria-label': 'Close', title: 'Close (Esc)' }, '✕');
  const list = h('div.pool-jobs');
  const target = h('p.pool-target');
  const body = h('pre.pool-body');
  const hashLine = h('p.pool-hash');
  const note = h('p.setting-note', {}, 'Owner approval stays off until this window has loaded the full text and its hash.');
  const approve = h('button.btn.primary', { type: 'button', disabled: true }, 'Record owner approval') as HTMLButtonElement;
  const el = h(
    'div.modal.pool-approval',
    { role: 'dialog', 'aria-label': 'Work pool' },
    h('header', {}, h('h2', {}, 'Work pool'), close),
    h('div.body', {}, list, target, body, hashLine, note),
    h('footer', {}, h('span.grow'), approve),
  );

  let loaded: JobText | undefined;
  let shown = '';

  const waiting = () => store.pool.columns.needsApproval;

  function arm(job: JobText | undefined) {
    loaded = job;
    approve.disabled = !job || job.approval !== 'owner-yes';
  }

  async function load(card: PoolCard) {
    shown = card.id;
    arm(undefined);
    body.textContent = 'Loading…';
    hashLine.textContent = '';
    target.textContent = '';
    let job: JobText;
    try {
      const res = await fetch(onFloor(`/api/pool/jobs/${encodeURIComponent(card.id)}`), { credentials: 'same-origin' });
      if (!res.ok) throw new Error('load failed');
      job = (await res.json()) as JobText;
    } catch {
      if (shown !== card.id) return;
      body.textContent = 'The full text could not be loaded.';
      hashLine.textContent = '';
      target.textContent = '';
      return;
    }
    if (shown !== card.id) return;
    if (job.id !== card.id || typeof job.body !== 'string' || typeof job.hash !== 'string' || !/^[a-f0-9]{64}$/.test(job.hash)) {
      body.textContent = 'The full text could not be loaded.';
      hashLine.textContent = '';
      target.textContent = '';
      return;
    }
    body.textContent = visiblePoolText(job.body);
    hashLine.textContent = job.hash;
    target.textContent = `Target: ${job.targetBot || '—'}`;
    arm(job);
  }

  function render() {
    const cards = waiting();
    if (!cards.length) {
      list.replaceChildren(h('p', {}, 'Nothing is waiting on approval.'));
      body.textContent = '';
      hashLine.textContent = '';
      target.textContent = '';
      arm(undefined);
      return;
    }
    list.replaceChildren(
      ...cards.map((card) => {
        const btn = h('button.btn', { type: 'button' }, `${card.title} · L${card.level}`);
        btn.addEventListener('click', () => void load(card));
        return btn;
      }),
    );
  }

  approve.addEventListener('click', async () => {
    const job = loaded;
    if (!job || approve.disabled) return;
    approve.disabled = true;
    try {
      const res = await fetch(onFloor('/api/pool/owner-yes'), {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: job.id, state: job.state, updatedAt: job.updatedAt, hash: job.hash }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => null)) as { error?: string } | null;
        toast(err?.error ?? 'Could not record approval', 'warn');
        arm(job);
        return;
      }
    } catch {
      toast('Could not record approval', 'warn');
      arm(job);
      return;
    }
    toast('Owner approval recorded');
    modal.close();
  });

  const modal = openModal(el, { doing: '📋 reading the work pool' });
  close.addEventListener('click', () => modal.close());
  render();
  const first = waiting()[0];
  if (first) void load(first);
}
