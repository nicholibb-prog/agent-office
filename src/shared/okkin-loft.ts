import { FLOOR } from './layout.js';

/**
 * Okkin's loft: a freestanding server island on the open floor south-east of the desk pods, west of
 * the meeting room and north of the loft stairs, its racks facing the desks (-x). It backs onto no
 * wall, so it covers no board, sign or window.
 */
export const OKKIN_LOFT = { minX: 5, maxX: 6.2, minZ: 7, maxZ: 10, rackDepth: 0.8, rackHeight: 2.2 } as const;
/** Where you stand to use the panel: in front of the racks, on open floor. */
export const OKKIN_LOFT_SPOT = { x: 3.3, z: 8.5 } as const;
void FLOOR;
