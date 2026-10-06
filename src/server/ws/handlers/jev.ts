// The center-room Jev board: rankings and desk cups for whoever just arrived.
import type { JevBoard } from '../../../shared/jev.js';
import type { ViewPieces } from './types.js';

const empty: JevBoard = { rows: [], trophies: [] };

export const jevView: ViewPieces['jev'] = (_ctx, floor) => floor?.jev.board() ?? empty;
