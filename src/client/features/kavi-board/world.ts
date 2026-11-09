import * as THREE from 'three';
import { mesh, roundedBox, toon } from '../../world/toon';
import type { Collider } from '../../world/types';
import type { Fixture } from '../../world/office/fixture';
import { KAVI_BOARD } from '../../../shared/kavi-office';

/** Kavi's Bridge title board, on the west wall (see KAVI_BOARD). Titles only, from the live feed. */
const POS = KAVI_BOARD;
const FRAME = '#1d3557';
const LEG = '#8d99ae';
const PX = 420;
const FONT = 'Nunito, ui-rounded, system-ui, sans-serif';

/** A wall board's floor footprint, turned with it (a quarter turn swaps its x and z extents). */
export function boardFootprint(b: { x: number; z: number; rotY: number; width: number; height: number; bottom: number }): Collider {
  const across = Math.abs(Math.cos(b.rotY)) > 0.5;
  const hw = b.width / 2 + 0.1;
  const hd = 0.2;
  return across
    ? { minX: b.x - hw, maxX: b.x + hw, minZ: b.z - hd, maxZ: b.z + hd, top: b.bottom + b.height + 0.1 }
    : { minX: b.x - hd, maxX: b.x + hd, minZ: b.z - hw, maxZ: b.z + hw, top: b.bottom + b.height + 0.1 };
}

export interface KaviBridgeBoard {
  group: THREE.Group;
  colliders: Collider[];
  show(titles: string[]): void;
}

export function buildKaviBridgeBoard(): KaviBridgeBoard {
  const { x, z, rotY, width, height, bottom } = POS;
  const group = new THREE.Group();
  group.position.set(x, 0, z);
  group.rotation.y = rotY;
  const frame = toon(FRAME);
  const leg = toon(LEG);
  const mid = bottom + height / 2;

  const board = mesh(roundedBox(width + 0.12, 0.06, height + 0.12, 0.04), frame, 0, mid, 0);
  board.rotation.x = Math.PI / 2;
  group.add(board);

  for (const sx of [-1, 1] as const) {
    group.add(mesh(roundedBox(0.06, mid - 0.05, 0.06, 0.02), leg, sx * (width / 2 - 0.1), (mid - 0.05) / 2, -0.07));
  }

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * PX);
  canvas.height = Math.round(height * PX);
  const g = canvas.getContext('2d')!;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  const face = new THREE.Mesh(
    new THREE.PlaneGeometry(width, height),
    new THREE.MeshBasicMaterial({ map: texture, toneMapped: false }),
  );
  face.position.set(0, mid, 0.04);
  group.add(face);

  const show = (titles: string[]) => {
    const W = canvas.width;
    const H = canvas.height;
    g.fillStyle = '#0b132b';
    g.fillRect(0, 0, W, H);
    g.fillStyle = '#5bc0eb';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = `800 ${Math.round(H * 0.08)}px ${FONT}`;
    g.fillText('Bridge board', W / 2, H * 0.1);
    const rows = titles.slice(0, 6);
    if (!rows.length) {
      g.fillStyle = '#8d99ae';
      g.font = `700 ${Math.round(H * 0.055)}px ${FONT}`;
      g.fillText('No Bridge files yet', W / 2, H * 0.5);
    } else {
      rows.forEach((title, i) => {
        const y = H * (0.26 + i * 0.12);
        g.textAlign = 'left';
        g.fillStyle = '#edf2f4';
        g.font = `700 ${Math.round(H * 0.07)}px ${FONT}`;
        const cut = title.length > 22 ? title.slice(0, 21) + '…' : title;
        g.fillText(`• ${cut}`, W * 0.06, y);
      });
    }
    texture.needsUpdate = true;
  };
  // Empty until the real Bridge feed arrives (index.ts): no sample titles painted.
  show([]);

  const colliders: Collider[] = [
    boardFootprint(POS),
  ];

  return { group, colliders, show };
}

declare module '../../world/types' {
  interface OfficeHandles {
    kaviBoard: KaviBridgeBoard;
  }
}

export const kaviBoard: Fixture<'kaviBoard'> = () => {
  const built = buildKaviBridgeBoard();
  return {
    group: built.group,
    colliders: built.colliders,
    interactables: [],
    handle: { kaviBoard: built },
  };
};



