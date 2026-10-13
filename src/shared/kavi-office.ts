import { FLOOR } from './layout.js';

/**
 * Kavi's Bridge board: on the west wall between the window at z 1 and the exit door (z 6.5), facing
 * into the room (+x). It used to stand inside the west desk pod.
 */
export const KAVI_BOARD = { x: FLOOR.minX + 0.25, z: 4.15, rotY: Math.PI / 2, width: 2.2, height: 1.55, bottom: 1 } as const;
/** Where Kavi's robot rests: in front of her board, clear of the desks, facing into the room. */
export const KAVI_HOME = { x: FLOOR.minX + 1.6, z: 4.15, rotY: Math.PI / 2 } as const;
/** Her walk round the office: open floor only, never through a desk pod or its chairs. */
export const KAVI_PATROL: readonly { x: number; z: number }[] = [
  { x: KAVI_HOME.x, z: KAVI_HOME.z },
  { x: -14.5, z: 6.6 },
  { x: 2.5, z: 6.8 },
  { x: 4, z: 2 },
  { x: 2, z: -7.2 },
  { x: -14.5, z: -7.2 },
  { x: -14.5, z: 1 },
];
