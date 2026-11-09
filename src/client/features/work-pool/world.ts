import * as THREE from 'three';
import { LEVELS, levelInfo, type PoolBoard, type PoolCard } from '../../../shared/pool';
import { POOL_BOARD, POOL_POSTER } from '../../../shared/pool-place';
import { wallPose } from '../../../shared/decor';
import { mesh, roundedBox, toon } from '../../world/toon';
import type { Collider, Interactable } from '../../world/types';
import type { Fixture } from '../../world/office/fixture';
import { drawBadge } from './badges';

const FONT = 'Nunito, ui-rounded, system-ui, sans-serif';
const FRAME = '#1d3557';
const LEG = '#8d99ae';

export interface PoolBoardMesh {
  group: THREE.Group;
  colliders: Collider[];
  interactable: Interactable;
  show(board: PoolBoard): void;
}

export function buildPoolBoard(): PoolBoardMesh {
  const { x, z, width, height, bottom } = POOL_BOARD;
  const group = new THREE.Group();
  group.position.set(x, 0, z);
  const mid = bottom + height / 2;
  const board = mesh(roundedBox(width + 0.12, 0.06, height + 0.12, 0.04), toon(FRAME), 0, mid, 0);
  board.rotation.x = Math.PI / 2;
  group.add(board);
  for (const sx of [-width / 2 + 0.16, width / 2 - 0.16]) {
    group.add(mesh(new THREE.CylinderGeometry(0.035, 0.04, bottom, 8), toon(LEG), sx, bottom / 2, 0));
  }
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * 280);
  canvas.height = Math.round(height * 280);
  const g = canvas.getContext('2d')!;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const face = new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshBasicMaterial({ map: texture, toneMapped: false }));
  face.position.set(0, mid, 0.04);
  group.add(face);
  const show = (state: PoolBoard) => {
    paintBoard(g, canvas.width, canvas.height, state);
    texture.needsUpdate = true;
  };
  show({ columns: { open: [], claimed: [], needsApproval: [], done: [] }, credits: [] });
  const colliders: Collider[] = [{ minX: x - width / 2 - 0.08, maxX: x + width / 2 + 0.08, minZ: z - 0.2, maxZ: z + 0.2, top: bottom + height + 0.08 }];
  const interactable: Interactable = { kind: 'pool', x, z: z + 1.3, radius: 2.2 };
  return { group, colliders, interactable, show };
}

function paintBoard(g: CanvasRenderingContext2D, W: number, H: number, board: PoolBoard) {
  g.clearRect(0, 0, W, H);
  g.fillStyle = '#0d1b2a';
  g.fillRect(0, 0, W, H);
  g.fillStyle = '#e0e1dd';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `800 ${Math.round(H * 0.07)}px ${FONT}`;
  g.fillText('Work pool', W / 2, H * 0.06);
  const cols: { title: string; cards: PoolCard[] }[] = [
    { title: 'Open', cards: board.columns.open },
    { title: 'Claimed', cards: board.columns.claimed },
    { title: 'Needs approval', cards: board.columns.needsApproval },
    { title: 'Done', cards: board.columns.done },
  ];
  const gap = W * 0.015;
  const colW = (W - gap * 5) / 4;
  cols.forEach((col, i) => {
    const x = gap + i * (colW + gap);
    g.fillStyle = '#1b263b';
    g.fillRect(x, H * 0.12, colW, H * 0.72);
    g.fillStyle = '#8d99ae';
    g.font = `700 ${Math.round(H * 0.035)}px ${FONT}`;
    g.fillText(col.title, x + colW / 2, H * 0.155);
    col.cards.slice(0, 3).forEach((card, n) => paintCard(g, card, x + 4, H * (0.2 + n * 0.2), colW - 8, H * 0.18));
    if (!col.cards.length) {
      g.fillStyle = '#415a77';
      g.font = `600 ${Math.round(H * 0.03)}px ${FONT}`;
      g.fillText('—', x + colW / 2, H * 0.4);
    }
  });
  g.fillStyle = '#a8dadc';
  g.font = `700 ${Math.round(H * 0.032)}px ${FONT}`;
  const credit = board.credits.slice(0, 4).map((c) => `${c.bot} ${c.done}`).join('   ') || 'No done credit yet';
  g.fillText(credit, W / 2, H * 0.92);
}

function paintCard(g: CanvasRenderingContext2D, card: PoolCard, x: number, y: number, w: number, h: number) {
  g.fillStyle = '#edf2f4';
  g.fillRect(x, y, w, h);
  const info = levelInfo(card.level);
  drawBadge(g, info, x + h * 0.38, y + h * 0.38, h * 0.7);
  g.fillStyle = '#1d3557';
  g.textAlign = 'left';
  g.font = `800 ${Math.round(h * 0.22)}px ${FONT}`;
  const title = card.title.length > 18 ? card.title.slice(0, 17) + '…' : card.title;
  g.fillText(title, x + h * 0.75, y + h * 0.28);
  g.font = `600 ${Math.round(h * 0.16)}px ${FONT}`;
  g.fillStyle = '#415a77';
  const lease = card.leaseLeftMs !== undefined ? ` · ${Math.ceil(card.leaseLeftMs / 1000)}s` : '';
  const who = card.claimer ? card.claimer : card.doneBy ? `by ${card.doneBy}` : '';
  const hash = card.hash ? ` · ${card.hash.slice(0, 8)}` : '';
  const line = `L${card.level} ${card.status}${who ? ' · ' + who : ''}${lease}${hash}`;
  g.fillText(line.length > 32 ? line.slice(0, 31) + '…' : line, x + h * 0.75, y + h * 0.62);
}

export interface PoolPosterMesh {
  group: THREE.Group;
  colliders: Collider[];
  show(): void;
}

export function buildPoolPoster(): PoolPosterMesh {
  const { wall, u, y, w, h } = POOL_POSTER;
  const pose = wallPose(wall, u, y, 0.03);
  const group = new THREE.Group();
  group.position.set(pose.x, pose.y, pose.z);
  group.rotation.y = pose.rotY;
  const frame = mesh(roundedBox(w + 0.08, h + 0.08, 0.04, 0.02), toon('#6b3a2a'), 0, 0, 0);
  group.add(frame);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * 420);
  canvas.height = Math.round(h * 420);
  const g = canvas.getContext('2d')!;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const face = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: texture, toneMapped: false }));
  face.position.z = 0.03;
  group.add(face);
  const show = () => {
    paintPoster(g, canvas.width, canvas.height);
    texture.needsUpdate = true;
  };
  show();
  const hw = w / 2;
  const colliders: Collider[] = [{ minX: u - hw, maxX: u + hw, minZ: pose.z - 0.02, maxZ: pose.z + 0.06, top: y + h / 2, bottom: y - h / 2 }];
  return { group, colliders, show };
}

function paintPoster(g: CanvasRenderingContext2D, W: number, H: number) {
  g.fillStyle = '#f6f1e7';
  g.fillRect(0, 0, W, H);
  g.strokeStyle = '#6b3a2a';
  g.lineWidth = 12;
  g.strokeRect(16, 16, W - 32, H - 32);
  g.fillStyle = '#1d3557';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `800 ${Math.round(H * 0.045)}px ${FONT}`;
  g.fillText('Work pool levels', W / 2, H * 0.07);
  LEVELS.forEach((level, i) => {
    const y = H * (0.16 + i * 0.115);
    drawBadge(g, level, W * 0.16, y, H * 0.08);
    g.textAlign = 'left';
    g.fillStyle = '#1d3557';
    g.font = `800 ${Math.round(H * 0.032)}px ${FONT}`;
    g.fillText(`${level.level}  ${level.name}`, W * 0.28, y - H * 0.018);
    g.fillStyle = '#415a77';
    g.font = `600 ${Math.round(H * 0.024)}px ${FONT}`;
    g.fillText(level.line, W * 0.28, y + H * 0.022);
  });
}

declare module '../../world/types' {
  interface OfficeHandles {
    poolBoard: PoolBoardMesh;
    poolPoster: PoolPosterMesh;
  }
}

export const poolBoard: Fixture<'poolBoard'> = () => {
  const built = buildPoolBoard();
  return { group: built.group, colliders: built.colliders, interactables: [built.interactable], handle: { poolBoard: built } };
};

export const poolPoster: Fixture<'poolPoster'> = (site) => {
  const built = buildPoolPoster();
  site.wall(POOL_POSTER.wall, POOL_POSTER.u, POOL_POSTER.y, POOL_POSTER.w, POOL_POSTER.h);
  return { group: built.group, colliders: built.colliders, handle: { poolPoster: built } };
};
