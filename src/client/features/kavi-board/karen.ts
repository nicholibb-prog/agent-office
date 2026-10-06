import * as THREE from 'three';
import { mesh, roundedBox, toon } from '../../world/toon';
import type { Collider } from '../../world/types';
import type { Fixture } from '../../world/office/fixture';
import { blockerAt, stepTo, type Body } from '../../player/collide';

/** Face-computer NPC. No desk. Patrols the office. */
const HOME = { x: -8.9, z: 5.55 } as const;
const PX = 256;
const FONT = 'Nunito, ui-rounded, system-ui, sans-serif';

/** Aisle-ish waypoints — each step still resolved against office colliders. */
const PATROL: { x: number; z: number }[] = [
  { x: -8.9, z: 5.55 },
  { x: -2.0, z: 5.0 },
  { x: 4.0, z: 2.0 },
  { x: 2.0, z: -6.0 },
  { x: -10.0, z: -6.0 },
  { x: -12.0, z: 1.0 },
];

export interface KaviKarenNpc {
  group: THREE.Group;
  colliders: Collider[];
  tick(dt: number): void;
  setFeedTitles(titles: string[]): void;
}

export function buildKaviKaren(officeColliders: Collider[]): KaviKarenNpc {
  const group = new THREE.Group();
  group.position.set(HOME.x, 0, HOME.z);
  group.rotation.y = Math.PI;

  const chassis = toon('#2b2d42');
  const accent = toon('#ef476f');
  const stand = toon('#8d99ae');

  group.add(mesh(roundedBox(0.22, 0.55, 0.22, 0.04), stand, 0, 0.28, 0));
  group.add(mesh(roundedBox(0.5, 0.06, 0.35, 0.03), stand, 0, 0.03, 0));
  group.add(mesh(roundedBox(0.85, 0.7, 0.12, 0.04), chassis, 0, 1.05, 0));
  group.add(mesh(roundedBox(0.5, 0.06, 0.04, 0.02), accent, 0, 0.78, 0.07));

  const canvas = document.createElement('canvas');
  canvas.width = PX;
  canvas.height = PX;
  const g = canvas.getContext('2d')!;
  let feedLine = 'Bridge feed';
  const paint = () => {
    g.fillStyle = '#118ab2';
    g.fillRect(0, 0, PX, PX);
    g.fillStyle = '#fff';
    g.beginPath(); g.arc(PX * 0.35, PX * 0.42, 28, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.arc(PX * 0.65, PX * 0.42, 28, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#2b2d42';
    g.beginPath(); g.arc(PX * 0.35, PX * 0.42, 12, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.arc(PX * 0.65, PX * 0.42, 12, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#ef476f';
    g.lineWidth = 6;
    g.beginPath();
    g.arc(PX * 0.5, PX * 0.55, 40, 0.15 * Math.PI, 0.85 * Math.PI);
    g.stroke();
    g.fillStyle = '#edf2f4';
    g.font = `800 20px ${FONT}`;
    g.textAlign = 'center';
    g.fillText('Bridge', PX / 2, PX * 0.82);
    g.font = `700 12px ${FONT}`;
    g.fillStyle = '#a8dadc';
    const line = feedLine.length > 28 ? feedLine.slice(0, 27) + '…' : feedLine;
    g.fillText(line, PX / 2, PX * 0.92);
  };
  paint();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const face = new THREE.Mesh(
    new THREE.PlaneGeometry(0.72, 0.55),
    new THREE.MeshBasicMaterial({ map: texture, toneMapped: false }),
  );
  face.position.set(0, 1.08, 0.07);
  group.add(face);

  group.add(mesh(roundedBox(0.04, 0.35, 0.04, 0.01), accent, 0, 1.55, 0));
  group.add(mesh(new THREE.SphereGeometry(0.07, 12, 12), accent, 0, 1.75, 0, false));

  let wp = 0;
  let pause = 1.5;
  const speed = 1.35;
  const body: Body = {
    pos: group.position,
    colliders: officeColliders,
    grounded: true,
    stepOffset: 0,
  };

  const tick = (dt: number) => {
    if (pause > 0) {
      pause -= dt;
      return;
    }
    const target = PATROL[wp]!;
    const dx = target.x - group.position.x;
    const dz = target.z - group.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.12) {
      wp = (wp + 1) % PATROL.length;
      pause = wp === 0 ? 2.5 : 0.8;
      return;
    }
    const step = Math.min(dist, speed * dt);
    const ox = group.position.x;
    const oz = group.position.z;
    const nx = ox + (dx / dist) * step;
    const nz = oz + (dz / dist) * step;
    // Resolve against office walls/desks each axis (same as player).
    stepTo(body, nx, oz);
    stepTo(body, group.position.x, nz);
    const moved = Math.hypot(group.position.x - ox, group.position.z - oz);
    if (moved < step * 0.15) {
      // Stuck on geometry — skip waypoint instead of walking through.
      wp = (wp + 1) % PATROL.length;
      pause = 0.25;
      return;
    }
    group.rotation.y = Math.atan2(group.position.x - ox || dx, group.position.z - oz || dz);
  };

  const setFeedTitles = (titles: string[]) => {
    feedLine = titles[0] || 'Bridge feed';
    paint();
    texture.needsUpdate = true;
  };

  // Own footprint collider moves with her (updated lightly via tick position — static home ok for hire blocking).
  const colliders: Collider[] = [
    { minX: HOME.x - 0.5, maxX: HOME.x + 0.5, minZ: HOME.z - 0.35, maxZ: HOME.z + 0.35, top: 1.9 },
  ];
  return { group, colliders, tick, setFeedTitles };
}

declare module '../../world/types' {
  interface OfficeHandles {
    kaviKaren: KaviKarenNpc;
  }
}

/** NPC fixture — no desk; collide+wander; face reads Bridge feed titles. */
export const kaviKaren: Fixture<'kaviKaren'> = (site) => {
  const built = buildKaviKaren(site.colliders);
  return {
    group: built.group,
    colliders: built.colliders,
    interactables: [],
    handle: { kaviKaren: built },
    update(_t, dt) {
      built.tick(dt);
    },
  };
};
