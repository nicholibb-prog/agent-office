// The Jev leaderboard: a standing whiteboard the office (and a map) can place. The office scene is
// three.js, so this is a three.js mesh with the rankings painted onto a canvas texture, which is
// the same trick the drawing whiteboard uses. React Three Fiber isn't how this office is built.
import * as THREE from 'three';
import { JEV_FOOTPRINT, rankBoard, seedAgents, type JevBoard } from '../../../shared/jev';
import { boxFootprint } from '../../../shared/maps/props';
import { mesh, roundedBox, toon } from '../../world/toon';
import type { Collider, Interactable } from '../../world/types';
import type { Fixture } from '../../world/office/fixture';
import { paintJevBoard } from './paint';
import { buildTrophy } from './trophy';

const ALU = '#c5ced6';
const INK = '#2b2d42';
const WIDTH = 2.4;
const HEIGHT = 1.5;
const BOTTOM = 1.02;
/** Pixels of the face. The texture stretches onto the board. */
const FACE = { width: 1024, height: 640 } as const;

export interface JevPlacement {
  x: number;
  z: number;
  /** Floor the feet stand on. The office floor is 0; a dais passes its top. */
  y?: number;
  /** 0 faces +z, the same way the drawing whiteboard faces. */
  rotY?: number;
}

/**
 * Default spot: the aisle between the two desk pods, south of the plant at (-6, 0), facing the
 * south of the room. Maps that want it somewhere else call JevLeaderboardWhiteboard with their own place.
 */
export const JEV_BOARD_AT: JevPlacement = { x: -6, z: 1.65, rotY: 0 };

export interface JevLeaderboard {
  group: THREE.Group;
  colliders: Collider[];
  interactable: Interactable;
  /** Paints `board` onto the face. Seed rankings are up before the first fetch returns. */
  show(board: JevBoard): void;
}

/**
 * The physical board. `at` defaults to the office aisle. A map mounts the group this returns
 * (see mountJevLeaderboard).
 */
export function JevLeaderboardWhiteboard(at: JevPlacement = JEV_BOARD_AT): JevLeaderboard {
  const x = at.x;
  const z = at.z;
  const y = at.y ?? 0;
  const rotY = at.rotY ?? 0;
  const group = new THREE.Group();
  group.name = 'jev-leaderboard';
  group.position.set(x, y, z);
  group.rotation.y = rotY;

  const alu = toon(ALU);
  const ink = toon(INK);
  const mid = BOTTOM + HEIGHT / 2;
  const post = WIDTH / 2 + 0.08;

  const frame = mesh(roundedBox(WIDTH + 0.16, 0.08, HEIGHT + 0.16, 0.04), alu, 0, mid, 0);
  frame.rotation.x = Math.PI / 2;
  group.add(frame);

  const canvas = document.createElement('canvas');
  canvas.width = FACE.width;
  canvas.height = FACE.height;
  const painter = canvas.getContext('2d')!;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  const face = new THREE.Mesh(new THREE.PlaneGeometry(WIDTH, HEIGHT), new THREE.MeshBasicMaterial({ map: texture, toneMapped: false }));
  face.position.set(0, mid, 0.05);
  group.add(face);
  const back = mesh(new THREE.PlaneGeometry(WIDTH, HEIGHT), toon('#d8dee6'), 0, mid, -0.05);
  back.rotation.y = Math.PI;
  group.add(back);

  for (const sx of [-post, post]) {
    group.add(mesh(new THREE.CylinderGeometry(0.035, 0.04, BOTTOM + HEIGHT * 0.15, 8), alu, sx, (BOTTOM + HEIGHT * 0.15) / 2, 0));
    group.add(mesh(roundedBox(0.1, 0.06, 0.55, 0.02), ink, sx, 0.04, 0));
  }
  group.add(mesh(new THREE.CylinderGeometry(0.02, 0.02, post * 2, 8).rotateZ(Math.PI / 2), alu, 0, 0.28, 0, false));

  // The house cup, always beside the board. A desk trophy is separate, and only when a milestone names a desk.
  const cup = buildTrophy();
  cup.position.set(post + 0.28, 0, 0.2);
  cup.scale.setScalar(1.15);
  group.add(cup);

  const [minX, maxX, minZ, maxZ] = boxFootprint(x, z, JEV_FOOTPRINT.width, JEV_FOOTPRINT.depth, rotY);
  const colliders: Collider[] = [{ minX, maxX, minZ, maxZ, top: y + BOTTOM + HEIGHT + 0.2, ...(y ? { bottom: y } : {}) }];
  const ahead = { x: Math.sin(rotY), z: Math.cos(rotY) };
  const interactable: Interactable = { kind: 'jev', x: x + ahead.x * 1.7, ...(y ? { y } : {}), z: z + ahead.z * 1.7, radius: 2.2 };
  group.userData.interact = interactable;

  const show = (board: JevBoard) => {
    paintJevBoard(painter, canvas.width, canvas.height, board);
    texture.needsUpdate = true;
  };
  show(rankBoard(seedAgents(), '2026-01-15T12:00:00.000Z'));

  return { group, colliders, interactable, show };
}

/** What a castle or station builder needs in order to stand the board in the hall. */
export interface JevMount {
  group: THREE.Group;
  colliders: Collider[];
  interactables: Interactable[];
  floorAt(x: number, z: number): number;
  jev?: JevLeaderboard;
}

/** Maps mount the board with `{ "kind": "jev", "x", "z", "rotY" }`. One per map. */
export function mountJevLeaderboard(kit: JevMount, at: { x: number; z: number; rotY?: number }): JevLeaderboard {
  const board = JevLeaderboardWhiteboard({ x: at.x, y: kit.floorAt(at.x, at.z), z: at.z, rotY: at.rotY ?? 0 });
  kit.group.add(board.group);
  kit.colliders.push(...board.colliders);
  kit.interactables.push(board.interactable);
  kit.jev = board;
  return board;
}

declare module '../../world/types' {
  interface OfficeHandles {
    /** The local Jev leaderboard in the aisle between the desk pods. */
    jev: JevLeaderboard;
  }
}

/** The board in the office, between the desk pods. */
export const jevBoard: Fixture<'jev'> = () => {
  const built = JevLeaderboardWhiteboard();
  return { group: built.group, colliders: built.colliders, interactables: [built.interactable], handle: { jev: built } };
};
