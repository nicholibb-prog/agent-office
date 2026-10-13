/** Karen (the face-computer, whose screen shows Kavi's picture) and the Bridge title board. Both are fixtures on the office floor. */
import * as THREE from 'three';
import type { Ctx } from '../../core/context';
import { mountKaviSendPanel } from './send-panel';

/** How often the Bridge feed repaints the title board, while the office world is running. */
const FEED_EVERY = 5;

/**
 * Wires the Bridge title board `build.ts` already places (`kaviBoard`) to the Bridge title feed.
 * Karen's walking and her face (Kavi's picture, see picture.ts) stay on her fixture.
 */
export function installKaviBoard(ctx: Ctx) {
  const pcScreen = mountKaviSendPanel();
  // Clicking Kavi's computer on her desk opens her screen. Aim with the mouse, or the crosshair when locked.
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  ctx.canvas.addEventListener('click', (e) => {
    if (!ctx.inOffice()) return;
    const r = ctx.canvas.getBoundingClientRect();
    if (document.pointerLockElement) ndc.set(0, 0);
    else ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, ctx.camera);
    const hit = ray.intersectObject(ctx.office.kaviDesk.computer, true)[0];
    if (hit && hit.distance < 6) pcScreen.open();
  });
  const board = ctx.office.kaviBoard;
  let feedAge = 0;
  ctx.ticks.add('world', ({ dt }) => {
    // The feed only advances while the office world is running.
    if (!ctx.inOffice() || ctx.upTop()) return;
    feedAge += dt;
    if (feedAge < FEED_EVERY) return;
    feedAge = 0;
    void fetch('/api/bridge/kavi-feed', { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { titles?: { name?: string }[] } | null) => {
        const names = (j?.titles || []).map((t) => String(t.name || '').trim()).filter(Boolean);
        if (!names.length) return;
        board.show(names);
      })
      .catch(() => {});
  });
}
