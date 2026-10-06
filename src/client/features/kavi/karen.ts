// Kavi's patrol. She walks the aisles and goes round the furniture. She is not a worker and has no desk.
import { officeNav, type NavGrid, type Pt } from '../../../shared/nav';

/**
 * Aisle corners on the office floor, clear of the desk pods. The plant in the middle of the
 * north–south aisle is not one of them: the route between the north and south corners goes round it.
 */
export const KAVI_PATROL: readonly Pt[] = [
  [-6, -8],
  [-6, 7],
  [1, 7],
  [1, -8],
];

export interface PatrolCursor {
  corners: readonly Pt[];
  /** The corner she is walking toward. */
  next: number;
}

/**
 * Move up to `meters` along the patrol. Each bit of the move is a straight line the office's
 * walkable grid says is clear (desks, chairs, plants, walls). A line that would cut through
 * furniture is replaced by a route around it. She never stays standing inside something.
 */
export function advancePatrol(at: Pt, cursor: PatrolCursor, meters: number, nav: NavGrid = officeNav()): { at: Pt; cursor: PatrolCursor } {
  const corners = cursor.corners;
  if (corners.length < 2 || meters <= 0) return { at, cursor };
  let pos: Pt = nav.walkable(at[0], at[1]) ? at : nav.nearestWalkable(at);
  let next = ((cursor.next % corners.length) + corners.length) % corners.length;
  let left = meters;
  for (let hops = 0; hops < 8 && left > 1e-4; hops++) {
    const goal = corners[next];
    const dx = goal[0] - pos[0];
    const dz = goal[1] - pos[1];
    const len = Math.hypot(dx, dz);
    if (len <= 0.05) {
      next = (next + 1) % corners.length;
      continue;
    }
    if (nav.clearLine(pos, goal)) {
      const step = Math.min(left, len);
      const candidate: Pt = [pos[0] + (dx * step) / len, pos[1] + (dz * step) / len];
      if (!nav.clearLine(pos, candidate) || !nav.walkable(candidate[0], candidate[1])) break;
      pos = candidate;
      left -= step;
      if (step >= len - 1e-4) next = (next + 1) % corners.length;
      continue;
    }
    const way = nav.route(pos, goal);
    const hop = way[1];
    if (!hop || !nav.clearLine(pos, hop)) break;
    const hx = hop[0] - pos[0];
    const hz = hop[1] - pos[1];
    const hlen = Math.hypot(hx, hz);
    if (hlen <= 1e-4) {
      pos = hop;
      continue;
    }
    const step = Math.min(left, hlen);
    const candidate: Pt = [pos[0] + (hx * step) / hlen, pos[1] + (hz * step) / hlen];
    if (!nav.walkable(candidate[0], candidate[1])) break;
    pos = candidate;
    left -= step;
  }
  if (!nav.walkable(pos[0], pos[1])) pos = nav.nearestWalkable(pos);
  return { at: pos, cursor: { corners, next } };
}
