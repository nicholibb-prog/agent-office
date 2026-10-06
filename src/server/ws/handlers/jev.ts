// The center-room Jev board: rankings and desk cups for whoever just arrived.
import { boardFrom, seedAgents } from '../../../shared/jev.js';
import type { ViewPieces } from './types.js';

const seeded = boardFrom(seedAgents());

export const jevView: ViewPieces['jev'] = (_ctx, floor) => floor?.jev.board() ?? seeded;
