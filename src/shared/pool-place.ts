// Where the work-pool board and the level poster stand, checked against the floor plan.
// The poster is a portrait on the north wall, west of the issues kiosk, clear of boards and doors.

import { overlaps, wallFacing, type WallRect } from './decor.js';
import { HOOP } from './hoop.js';
import { JEV_BOARD } from './jev.js';
import {
  BALCONY_DOOR,
  BOARDS,
  DESKS,
  DESK_SIZE,
  ELEVATOR,
  EXIT_DOOR,
  FLOOR,
  GONG,
  MACHINE_MONITOR,
  MEETING_BOARD,
  STATIONS,
  TV,
  WALL_HEIGHT,
  WHITEBOARD,
  WINDOWS,
  WING_DESKS,
} from './layout.js';

export interface Footprint {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/** North wall, in the corner tile west of the issues kiosk. Portrait, so seven badges fit in a column. */
export const POOL_POSTER = { wall: 'north' as const, u: -17.22, y: 2.35, w: 1.1, h: 2.55 };

/** Standing board in the aisle between the desk pods, north of the center plant and clear of the Jev board. */
export const POOL_BOARD = { x: -6, z: -1.55, width: 2.7, height: 1.5, bottom: 0.95, depth: 0.28 };

/** The Bridge title board (features/kavi-board/world.ts). Kept here so the pool board can stay clear of it. */
const KAVI_BOARD = { x: -8.9, z: 4.35, width: 2.2, depth: 0.35 };

function wallRect(wall: WallRect['wall'], u: number, y: number, w: number, h: number): WallRect {
  return { wall, u0: u - w / 2, u1: u + w / 2, y0: y - h / 2, y1: y + h / 2 };
}

export function posterWallRect(): WallRect {
  return wallRect(POOL_POSTER.wall, POOL_POSTER.u, POOL_POSTER.y, POOL_POSTER.w, POOL_POSTER.h);
}

/** Wall rectangles the office already marks taken (boards, windows, doors, kiosks, hoop, gong, elevator). */
export function officeWallBlocks(): WallRect[] {
  const out: WallRect[] = [];
  for (const b of Object.values(BOARDS)) {
    const wall = wallFacing(b.rotY);
    const bottom = b.y - (b.height + 0.3) / 2;
    const u = wall === 'north' || wall === 'south' ? b.x : b.z;
    out.push(wallRect(wall, u, (bottom + WALL_HEIGHT) / 2, b.width + 0.3, WALL_HEIGHT - bottom));
  }
  out.push(wallRect('east', TV.z, TV.y, TV.width + 0.3, TV.height + 0.3));
  out.push(wallRect('west', MACHINE_MONITOR.z, MACHINE_MONITOR.y, MACHINE_MONITOR.width + 0.2, MACHINE_MONITOR.height + 0.2));
  for (const def of STATIONS) out.push(wallRect('north', def.x, 1.45, 1.4, 2.9));
  for (const o of WINDOWS) out.push(wallRect(o.wall, o.u, (o.y0 + o.y1) / 2 - 0.03, o.width + 0.2, o.y1 - o.y0 + 0.12));
  out.push(wallRect(EXIT_DOOR.wall, EXIT_DOOR.u, (EXIT_DOOR.y1 + 0.7) / 2, EXIT_DOOR.width + 0.3, EXIT_DOOR.y1 + 0.7));
  out.push(wallRect(BALCONY_DOOR.wall, BALCONY_DOOR.u, (BALCONY_DOOR.y1 + 0.1) / 2, BALCONY_DOOR.width + 0.2, BALCONY_DOOR.y1 + 0.1));
  out.push(wallRect('south', MEETING_BOARD.x, MEETING_BOARD.y, MEETING_BOARD.width + 0.4, MEETING_BOARD.height + 0.4));
  out.push(wallRect('north', ELEVATOR.x, ELEVATOR.doorHeight / 2, ELEVATOR.width, ELEVATOR.doorHeight));
  out.push(wallRect('west', HOOP.z, (HOOP.board.bottom + HOOP.board.top) / 2, HOOP.board.width, HOOP.board.top - HOOP.board.bottom));
  out.push(wallRect('north', GONG.x, GONG.height / 2, GONG.width, GONG.height));
  return out;
}

function deskBox(d: { x: number; z: number; rotY: number }): Footprint {
  const c = Math.abs(Math.cos(d.rotY));
  const s = Math.abs(Math.sin(d.rotY));
  const hw = (DESK_SIZE.width * c + DESK_SIZE.depth * s) / 2;
  const hd = (DESK_SIZE.width * s + DESK_SIZE.depth * c) / 2;
  return { minX: d.x - hw, maxX: d.x + hw, minZ: d.z - hd, maxZ: d.z + hd };
}

/** How far the poster sticks into the room. It stays on the wall tile, short of the walkway. */
export function posterFootprint(): Footprint {
  const hw = POOL_POSTER.w / 2;
  return { minX: POOL_POSTER.u - hw, maxX: POOL_POSTER.u + hw, minZ: FLOOR.minZ, maxZ: FLOOR.minZ + 0.08 };
}

export function boardFootprint(): Footprint {
  const hw = POOL_BOARD.width / 2;
  const hd = POOL_BOARD.depth / 2;
  return { minX: POOL_BOARD.x - hw, maxX: POOL_BOARD.x + hw, minZ: POOL_BOARD.z - hd, maxZ: POOL_BOARD.z + hd };
}

/** Desks, doors, the whiteboard, the other boards, and the walkway along the north wall. */
export function floorObstacles(): Footprint[] {
  const desks = [...DESKS, ...WING_DESKS, ...STATIONS].map(deskBox);
  const extras: Footprint[] = [
    { minX: WHITEBOARD.x - WHITEBOARD.width / 2, maxX: WHITEBOARD.x + WHITEBOARD.width / 2, minZ: WHITEBOARD.z - 0.45, maxZ: WHITEBOARD.z + 0.45 },
    { minX: JEV_BOARD.x - JEV_BOARD.width / 2, maxX: JEV_BOARD.x + JEV_BOARD.width / 2, minZ: JEV_BOARD.z - 0.4, maxZ: JEV_BOARD.z + 0.4 },
    { minX: KAVI_BOARD.x - KAVI_BOARD.width / 2, maxX: KAVI_BOARD.x + KAVI_BOARD.width / 2, minZ: KAVI_BOARD.z - KAVI_BOARD.depth, maxZ: KAVI_BOARD.z + KAVI_BOARD.depth },
    { minX: FLOOR.minX, maxX: FLOOR.minX + 0.9, minZ: EXIT_DOOR.u - EXIT_DOOR.width / 2, maxZ: EXIT_DOOR.u + EXIT_DOOR.width / 2 },
    { minX: BALCONY_DOOR.u - BALCONY_DOOR.width / 2, maxX: BALCONY_DOOR.u + BALCONY_DOOR.width / 2, minZ: FLOOR.maxZ - 0.9, maxZ: FLOOR.maxZ },
    { minX: ELEVATOR.x - ELEVATOR.width / 2, maxX: ELEVATOR.x + ELEVATOR.width / 2, minZ: FLOOR.minZ, maxZ: FLOOR.minZ + ELEVATOR.depth },
    { minX: -16.4, maxX: 12.6, minZ: FLOOR.minZ + 0.4, maxZ: FLOOR.minZ + 2.5 },
  ];
  return [...desks, ...extras];
}

function boxesOverlap(a: Footprint, b: Footprint, gap: number): boolean {
  return a.minX < b.maxX + gap && b.minX < a.maxX + gap && a.minZ < b.maxZ + gap && b.minZ < a.maxZ + gap;
}

/** Empty when the poster and the board sit clear of the floor plan. */
export function placementProblems(): string[] {
  const problems: string[] = [];
  const poster = posterWallRect();
  for (const block of officeWallBlocks()) {
    if (overlaps(poster, block, 0.08)) problems.push(`poster overlaps ${block.wall} ${block.u0.toFixed(2)}..${block.u1.toFixed(2)} y ${block.y0.toFixed(2)}..${block.y1.toFixed(2)}`);
  }
  if (poster.u0 < FLOOR.minX + 0.15 || poster.u1 > FLOOR.maxX - 0.15) problems.push('poster runs off the wall');
  if (poster.y0 < 0.4 || poster.y1 > WALL_HEIGHT - 0.2) problems.push('poster is not on the wall tile');
  const foot = posterFootprint();
  const board = boardFootprint();
  for (const box of floorObstacles()) {
    if (boxesOverlap(foot, box, 0)) problems.push(`poster footprint hits ${box.minX.toFixed(1)},${box.minZ.toFixed(1)}`);
    if (boxesOverlap(board, box, 0.2)) problems.push(`board hits ${box.minX.toFixed(1)},${box.minZ.toFixed(1)}`);
  }
  if (boxesOverlap(board, foot, 0)) problems.push('board hits the poster');
  return problems;
}
