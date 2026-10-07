import * as THREE from 'three';
import { mesh, roundedBox, toon } from '../../world/toon';
import type { Collider } from '../../world/types';
import type { Fixture } from '../../world/office/fixture';

/** Standing bridge title board beside/behind Jev. Titles only — no file bodies. */
const POS = { x: -8.9, z: 4.35, width: 2.2, height: 1.55, bottom: 1 } as const;
const FRAME = '#1d3557';
const LEG = '#8d99ae';
const PX = 420;
const FONT = 'Nunito, ui-rounded, system-ui, sans-serif';

const TITLES: string[] = [
  'office-access-options',
  'open-item-answer',
  'dolby-routed',
  'agent-office-access',
  'open-item-question',
  'dolby-atmos-speakers',
  'bridge-1000-check',
  'archive-drill-done',
  'daily-changes',
  'status-sample-MOVED',
];

export interface KaviBridgeBoard {
  group: THREE.Group;
  colliders: Collider[];
  show(titles: string[]): void;
}

export function buildKaviBridgeBoard(): KaviBridgeBoard {
  const { x, z, width, height, bottom } = POS;
  const group = new THREE.Group();
  group.position.set(x, 0, z);
  const frame = toon(FRAME);
  const leg = toon(LEG);
  const mid = bottom + height / 2;

  const board = mesh(roundedBox(width + 0.12, 0.06, height + 0.12, 0.04), frame, 0, mid, 0);
  board.rotation.x = Math.PI / 2;
  group.add(board);

  for (const sx of [-1, 1] as const) {
    group.add(mesh(roundedBox(0.06, mid - 0.05, 0.06, 0.02), leg, sx * (width / 2 - 0.1), (mid - 0.05) / 2, 0.02));
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
    g.font = `700 ${Math.round(H * 0.04)}px ${FONT}`;
    g.fillStyle = '#a8dadc';
    g.fillText('titles only · Drive list', W / 2, H * 0.18);
    const rows = titles.slice(0, 8);
    if (!rows.length) {
      g.fillStyle = '#8d99ae';
      g.font = `700 ${Math.round(H * 0.055)}px ${FONT}`;
      g.fillText('No Bridge files yet', W / 2, H * 0.5);
    } else {
      rows.forEach((title, i) => {
        const y = H * (0.28 + i * 0.08);
        g.textAlign = 'left';
        g.fillStyle = '#edf2f4';
        g.font = `700 ${Math.round(H * 0.045)}px ${FONT}`;
        const cut = title.length > 28 ? title.slice(0, 27) + '…' : title;
        g.fillText(`• ${cut}`, W * 0.06, y);
      });
    }
    texture.needsUpdate = true;
  };
  show(TITLES);

  const colliders: Collider[] = [
    { minX: x - width / 2 - 0.1, maxX: x + width / 2 + 0.1, minZ: z - 0.15, maxZ: z + 0.15, top: bottom + height + 0.1 },
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



