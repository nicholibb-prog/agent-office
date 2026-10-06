import * as THREE from 'three';
import { JEV_BOARD, type JevBoard } from '../../../shared/jev';
import { mesh, roundedBox, toon } from '../../world/toon';
import type { Collider, Interactable } from '../../world/types';
import type { Fixture } from '../../world/office/fixture';

// The Jev leaderboard: a standing board in the middle of the room. Its face is a canvas
// texture (the office has no react-three-fiber RenderTexture) repainted whenever rankings change.

const FRAME = '#2b2d42';
const LEG = '#8d99ae';
const PX = 420;
const FONT = 'Nunito, ui-rounded, system-ui, sans-serif';

export interface JevLeaderboardWhiteboard {
  group: THREE.Group;
  colliders: Collider[];
  interactable: Interactable;
  /** Paints the current rankings on the face. Names and counts only. */
  show(board: JevBoard): void;
}

export function buildJevLeaderboard(): JevLeaderboardWhiteboard {
  const { x, z, width, height, bottom } = JEV_BOARD;
  const group = new THREE.Group();
  group.position.set(x, 0, z);
  const frame = toon(FRAME);
  const leg = toon(LEG);
  const mid = bottom + height / 2;

  const board = mesh(roundedBox(width + 0.12, 0.06, height + 0.12, 0.04), frame, 0, mid, 0);
  board.rotation.x = Math.PI / 2;
  group.add(board);

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * PX);
  canvas.height = Math.round(height * PX);
  const g = canvas.getContext('2d')!;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  const face = new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshBasicMaterial({ map: texture, toneMapped: false }));
  face.position.set(0, mid, 0.04);
  group.add(face);

  for (const sx of [-width / 2 + 0.15, width / 2 - 0.15]) {
    group.add(mesh(new THREE.CylinderGeometry(0.035, 0.04, bottom, 8), leg, sx, bottom / 2, 0, false));
    group.add(mesh(new THREE.BoxGeometry(0.16, 0.04, 0.28), frame, sx, 0.02, 0, false));
  }

  const colliders: Collider[] = [{ minX: x - width / 2 - 0.1, maxX: x + width / 2 + 0.1, minZ: z - 0.2, maxZ: z + 0.2, top: bottom + height + 0.1 }];
  const interactable: Interactable = { kind: 'jev', x, z: z + 1.4, radius: 2.2 };

  const show = (board: JevBoard) => {
    const W = canvas.width;
    const H = canvas.height;
    g.fillStyle = '#f4f1ea';
    g.fillRect(0, 0, W, H);
    g.fillStyle = '#2b2d42';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = `800 ${Math.round(H * 0.09)}px ${FONT}`;
    g.fillText('Jev', W / 2, H * 0.1);
    g.font = `700 ${Math.round(H * 0.045)}px ${FONT}`;
    g.fillStyle = '#5c677d';
    g.fillText('local rankings', W / 2, H * 0.18);
    const rows = board.rows.slice(0, 6);
    if (!rows.length) {
      g.fillStyle = '#8d99ae';
      g.font = `700 ${Math.round(H * 0.06)}px ${FONT}`;
      g.fillText('No scores yet', W / 2, H * 0.5);
    } else {
      rows.forEach((row, i) => {
        const y = H * (0.32 + i * 0.1);
        g.textAlign = 'left';
        g.fillStyle = i === 0 ? '#ef476f' : '#2b2d42';
        g.font = `800 ${Math.round(H * 0.055)}px ${FONT}`;
        g.fillText(`${row.rank}. ${row.name}`, W * 0.08, y);
        g.textAlign = 'right';
        g.fillStyle = '#118ab2';
        g.fillText(String(row.score), W * 0.92, y);
      });
    }
    texture.needsUpdate = true;
  };
  show({ rows: [], trophies: [] });

  return { group, colliders, interactable, show };
}

declare module '../../world/types' {
  interface OfficeHandles {
    /** The Jev leaderboard in the middle of the room. */
    jevBoard: JevLeaderboardWhiteboard;
  }
}

/** The Jev board, standing in the central aisle. */
export const jevBoard: Fixture<'jevBoard'> = () => {
  const built = buildJevLeaderboard();
  return { group: built.group, colliders: built.colliders, interactables: [built.interactable], handle: { jevBoard: built } };
};
