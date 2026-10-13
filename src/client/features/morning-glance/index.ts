/**
 * Boot-first since-close glance: once per open session, dismissible.
 * Read-only summary from /api/office/since-close. No approve/send/merge controls.
 */
import { closedSinceLabel, glanceHasLines, type SinceCloseGlance } from '../../../shared/since-close';
import type { Ctx } from '../../core/context';
import { $ } from '../../ui/dom';
import { mountClosedChip, SinceClosePanel } from './ui';

export function installMorningGlance(_ctx: Ctx) {
  const hud = $('hud');
  const projectMeta = document.getElementById('project-meta') ?? hud;
  const closedChip = mountClosedChip(projectMeta);

  let opened = false;
  const panel = new SinceClosePanel(hud, () => {
    void fetch('/api/office/since-close/dismiss', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    }).catch(() => undefined);
  });

  async function pull() {
    if (opened) return;
    opened = true;
    let glance: SinceCloseGlance | null = null;
    try {
      const res = await fetch('/api/office/since-close', { credentials: 'same-origin', cache: 'no-store' });
      if (res.ok) glance = (await res.json()) as SinceCloseGlance;
    } catch {
      /* office may still be wiring up */
    }
    try {
      const st = await fetch('/api/office/state', { credentials: 'same-origin', cache: 'no-store' });
      if (st.ok) {
        const body = (await st.json()) as { office?: string; closedAt?: string; closedSince?: string | null };
        if (body.office === 'closed') {
          closedChip.set(body.closedSince || closedSinceLabel(body.closedAt));
        } else {
          closedChip.set(null);
        }
      }
    } catch {
      /* ignore */
    }
    if (!glance || glance.dismissed) return;
    // Empty closed span → calm empty state (still show once so the ritual lands).
    if (!glance.since && !glanceHasLines(glance)) return;
    panel.show(glance);
  }

  // First paint after the office bundle is up: one shot, no schedule.
  window.setTimeout(() => void pull(), 600);
}
