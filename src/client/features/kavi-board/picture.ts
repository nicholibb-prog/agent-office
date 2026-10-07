/**
 * Kavi's picture window: a still picture in a small rounded, video-call-shaped frame that floats over
 * the Bridge NPC when you're near enough to see it. It is a picture, not a call: it says so in plain
 * words, and it has no call timer, no "connected" state and no mic or camera buttons.
 */
import './picture.css';
import * as THREE from 'three';
import type { Ctx } from '../../core/context';
import type { Collider } from '../../world/types';
import { $, h, modalOpen } from '../../ui/dom';

/** The picture, from the client's static assets (src/client/public). 256 px square. */
export const PICTURE_SRC = '/kavi-picture.png';
export const PICTURE_ALT = 'Kavi picture (not a live call)';
export const PICTURE_NAME = 'Kavi';
/** What the frame says under the picture, always in view while the window is. */
export const PICTURE_LABEL = 'Picture · not a live call · Kavi replies async';

/** How near the NPC you have to be for the window to show (m). */
export const SHOW_WITHIN = 9;
/** How far above the NPC's feet the window's bottom edge floats: just over the antenna (m). */
const ABOVE = 2.05;
/** About how tall the window is drawn at full size, picture and label (px; see picture.css). */
const WINDOW_TALL = 180;

export interface PictureSpot {
  /** Where the window's bottom middle goes on the screen (px). */
  x: number;
  y: number;
  /** How big it's drawn, smaller further off. */
  scale: number;
}

/**
 * Where the window goes on a `width`×`height` screen, given how far the NPC is from you (m) and where
 * the point above it lands in normalized device coordinates; null when it shouldn't show (too far,
 * behind you, or off the screen).
 */
export function pictureSpot(dist: number, ndc: { x: number; y: number; z: number }, width: number, height: number): PictureSpot | null {
  if (!Number.isFinite(dist) || dist > SHOW_WITHIN) return null;
  // Behind the camera, or past the far plane.
  if (ndc.z < -1 || ndc.z > 1) return null;
  if (Math.abs(ndc.x) > 1.05 || ndc.y < -1 || ndc.y > 1.6) return null;
  const scale = Math.min(1, Math.max(0.75, 3.5 / Math.max(dist, 0.01)));
  // Up close the point over her head can be above the top of the screen: keep the whole window in view.
  const y = Math.max(((1 - ndc.y) / 2) * height, WINDOW_TALL * scale + 8);
  return { x: ((ndc.x + 1) / 2) * width, y, scale };
}

/** Things at least this tall (m) hide her from you: walls, boards, shelves. Desks and chairs don't. */
const HIDES_ABOVE = 1.5;
/** How often whether something stands between you and her is looked at again (s). */
const SIGHT_EVERY = 0.15;

/**
 * Whether something tall stands between `from` and `to` on the floor plan, so the window (drawn over
 * the page, not in the scene) doesn't show through walls. Footprints either end is inside (hers, or
 * one you're standing in) don't count.
 */
export function sightBlocked(from: { x: number; z: number }, to: { x: number; z: number }, colliders: readonly Collider[]): boolean {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const inside = (c: Collider, p: { x: number; z: number }) => p.x >= c.minX && p.x <= c.maxX && p.z >= c.minZ && p.z <= c.maxZ;
  for (const c of colliders) {
    if (c.top < HIDES_ABOVE || (c.bottom ?? 0) > HIDES_ABOVE || inside(c, from) || inside(c, to)) continue;
    // Where the segment crosses the box, along it from 0 to 1 (slabs, one axis at a time).
    let t0 = 0;
    let t1 = 1;
    for (const [o, d, lo, hi] of [[from.x, dx, c.minX, c.maxX], [from.z, dz, c.minZ, c.maxZ]] as const) {
      if (Math.abs(d) < 1e-9) {
        if (o < lo || o > hi) t0 = 2;
        continue;
      }
      const a = (lo - o) / d;
      const b = (hi - o) / d;
      t0 = Math.max(t0, Math.min(a, b));
      t1 = Math.min(t1, Math.max(a, b));
    }
    if (t0 <= t1) return true;
  }
  return false;
}

/** The window itself: the picture, the name over it, and the plain label under it. */
export function pictureWindow(): HTMLElement {
  const img = h('img.kavi-picture-img', { src: PICTURE_SRC, alt: PICTURE_ALT, width: 128, height: 128, draggable: 'false', decoding: 'async' });
  const name = h('span.kavi-picture-name', {}, PICTURE_NAME);
  const label = h('figcaption.kavi-picture-label', {}, PICTURE_LABEL);
  return h('figure.kavi-picture.hidden', {}, h('div.kavi-picture-frame', {}, img, name), label);
}

/** Puts the window on the HUD and keeps it over the NPC, after each frame is drawn. */
export function mountKaviPicture(ctx: Ctx) {
  const el = pictureWindow();
  $('hud').append(el);
  const at = new THREE.Vector3();
  const ndc = new THREE.Vector3();
  let shown = false;
  let hidden = false;
  let sightAge = SIGHT_EVERY;
  const show = (on: boolean) => {
    if (on === shown) return;
    shown = on;
    el.classList.toggle('hidden', !on);
  };
  // Over the frame once it's drawn (the camera's where it's drawn from), as the compass is.
  ctx.ticks.add('render', ({ dt }) => {
    if (!ctx.inOffice() || ctx.upTop() || ctx.trip() || modalOpen()) return show(false);
    const npc = ctx.office.kaviKaren.group;
    npc.getWorldPosition(at);
    const dist = at.distanceTo(ctx.camera.position);
    sightAge += dt;
    if (sightAge >= SIGHT_EVERY && dist <= SHOW_WITHIN) {
      sightAge = 0;
      hidden = sightBlocked(ctx.camera.position, at, ctx.office.colliders);
    }
    if (hidden) return show(false);
    at.y += ABOVE;
    ndc.copy(at).project(ctx.camera);
    const spot = pictureSpot(dist, ndc, window.innerWidth, window.innerHeight);
    if (!spot) return show(false);
    el.style.transform = `translate(${Math.round(spot.x)}px, ${Math.round(spot.y)}px) translate(-50%, -100%) scale(${spot.scale.toFixed(2)})`;
    show(true);
  });
}
