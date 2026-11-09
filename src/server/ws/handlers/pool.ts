// The work pool board for whoever just arrived on a floor.
import { emptyBoard } from '../../../shared/pool.js';
import type { ViewPieces } from './types.js';

export const poolView: ViewPieces['pool'] = (_ctx, floor) => floor?.pool.board() ?? emptyBoard();
