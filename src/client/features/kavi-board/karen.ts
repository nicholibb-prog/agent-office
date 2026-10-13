import * as THREE from 'three';
import { mesh, roundedBox, toon } from '../../world/toon';
import type { Collider } from '../../world/types';
import type { Fixture } from '../../world/office/fixture';
import { stepToward, type Body } from '../../player/collide';
import { FACE_PX, FACE_SRC, paintFace } from './picture';

/** Face-computer NPC. No desk. Patrols the office. */
const HOME = { x: -8.9, z: 5.55 } as const;

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
  /** Her screen, showing Kavi's picture (see picture.ts). */
  face: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  /** Lets go of the face's picture, texture, material and geometry. */
  dispose(): void;
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

  // The face: a still picture of Kavi framed like a video-call view (see picture.ts). The picture is
  // loaded once and painted into the screen's canvas when it arrives; nothing is redrawn per frame.
  const canvas = document.createElement('canvas');
  canvas.width = FACE_PX.w;
  canvas.height = FACE_PX.h;
  const g = canvas.getContext('2d')!;
  paintFace(g, null);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const picture = new Image();
  picture.decoding = 'async';
  picture.onload = () => {
    paintFace(g, picture);
    texture.needsUpdate = true;
  };
  picture.src = FACE_SRC;
  const faceGeo = new THREE.PlaneGeometry(0.72, 0.55);
  const faceMat = new THREE.MeshBasicMaterial({ map: texture, toneMapped: false });
  const face = new THREE.Mesh(faceGeo, faceMat);
  face.name = 'kavi-face';
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
    // Resolve against office walls/desks each axis (same as player).
    const moved = stepToward(body, target.x, target.z, step);
    if (moved < step * 0.15) {
      // Stuck on geometry — skip waypoint instead of walking through.
      wp = (wp + 1) % PATROL.length;
      pause = 0.25;
      return;
    }
    group.rotation.y = Math.atan2(group.position.x - ox || dx, group.position.z - oz || dz);
  };

  const dispose = () => {
    picture.onload = null;
    picture.src = '';
    texture.dispose();
    faceMat.dispose();
    faceGeo.dispose();
  };

  // Own footprint collider moves with her (updated lightly via tick position — static home ok for hire blocking).
  const colliders: Collider[] = [
    { minX: HOME.x - 0.5, maxX: HOME.x + 0.5, minZ: HOME.z - 0.35, maxZ: HOME.z + 0.35, top: 1.9 },
  ];
  return { group, colliders, tick, face, dispose };
}

declare module '../../world/types' {
  interface OfficeHandles {
    kaviKaren: KaviKarenNpc;
  }
}

/** NPC fixture — no desk; collide+wander; face shows Kavi's picture (not a live call). */
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
