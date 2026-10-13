import { FLOOR } from './layout.js';

/**
 * Okkin's loft: a small server nook against the east wall, north of the TV and south of the back
 * office bay, facing into the room (-x). Racks along the wall, a raised dais, a nameplate above.
 */
export const OKKIN_LOFT = { minX: FLOOR.maxX - 1.5, maxX: FLOOR.maxX, minZ: -10.2, maxZ: -6.2, rackDepth: 0.8, rackHeight: 2.2 } as const;
/** Where you stand to use the panel: in front of the racks, on open floor. */
export const OKKIN_LOFT_SPOT = { x: FLOOR.maxX - 2.4, z: -8.2 } as const;
