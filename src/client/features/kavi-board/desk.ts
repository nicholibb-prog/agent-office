import * as THREE from 'three';
import { mesh, roundedBox, toon } from '../../world/toon';
import { PALETTE, box } from '../../world/office/materials';
import type { Collider } from '../../world/types';
import type { Fixture } from '../../world/office/fixture';
import { KAVI_DESK, KAVI_DESK_BOX } from '../../../shared/kavi-office';
import { FACE_PX, FACE_SRC, paintFace } from './picture';

/** Kavi's desk and computer (see KAVI_DESK). Clicking the computer opens her screen. */
export interface KaviDeskView {
  group: THREE.Group;
  /** The monitor: what a click must hit to open her screen. */
  computer: THREE.Group;
  colliders: Collider[];
  dispose(): void;
}

export function buildKaviDesk(): KaviDeskView {
  const { width, depth, height } = KAVI_DESK;
  const group = new THREE.Group();
  group.name = 'kavi-desk';
  group.position.set(KAVI_DESK.x, 0, KAVI_DESK.z);
  group.rotation.y = KAVI_DESK.rotY;
  // Same top, legs and modesty panel as the office desks, sized down.
  group.add(mesh(roundedBox(width - 0.06, 0.08, depth - 0.04, 0.08), toon(PALETTE.desk), 0, height - 0.04, 0));
  const legMat = toon('#8d99ae');
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) group.add(mesh(new THREE.CylinderGeometry(0.035, 0.035, height - 0.08, 8), legMat, sx * (width / 2 - 0.12), (height - 0.08) / 2, sz * (depth / 2 - 0.1)));
  group.add(mesh(box(width - 0.3, 0.32, 0.03), toon(PALETTE.deskLeg), 0, height - 0.26, -depth / 2 + 0.06));

  // Her computer: a monitor on a stand at the back of the desk, facing the room, showing her picture.
  const computer = new THREE.Group();
  computer.name = 'kavi-computer';
  computer.position.set(0, height, -0.12);
  const chassis = toon('#2b2d42');
  computer.add(mesh(roundedBox(0.3, 0.03, 0.2, 0.01), chassis, 0, 0.015, 0));
  computer.add(mesh(box(0.05, 0.22, 0.05), chassis, 0, 0.13, 0));
  computer.add(mesh(roundedBox(0.72, 0.48, 0.05, 0.03), chassis, 0, 0.45, 0));
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
  const screenGeo = new THREE.PlaneGeometry(0.64, 0.4);
  const screenMat = new THREE.MeshBasicMaterial({ map: texture, toneMapped: false });
  const screen = new THREE.Mesh(screenGeo, screenMat);
  screen.position.set(0, 0.45, 0.027);
  computer.add(screen);
  // A keyboard in front of it.
  computer.add(mesh(roundedBox(0.42, 0.02, 0.14, 0.01), toon('#e9ecef'), 0, 0.01, 0.3));
  group.add(computer);

  const colliders: Collider[] = [{ ...KAVI_DESK_BOX }];
  const dispose = () => {
    picture.onload = null;
    picture.src = '';
    texture.dispose();
    screenMat.dispose();
    screenGeo.dispose();
  };
  return { group, computer, colliders, dispose };
}

declare module '../../world/types' {
  interface OfficeHandles {
    kaviDesk: KaviDeskView;
  }
}

export const kaviDesk: Fixture<'kaviDesk'> = () => {
  const built = buildKaviDesk();
  return { group: built.group, colliders: built.colliders, interactables: [], handle: { kaviDesk: built } };
};
