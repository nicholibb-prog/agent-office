import { emptyBoard, type PoolBoard } from '../../../shared/pool';
import type { Slice } from '../store';

declare module '../store' {
  interface Store {
    /** Community work pool on the floor you're on. */
    pool: PoolBoard;
  }
  interface Topics {
    pool: true;
  }
}

export const pool: Slice = {
  init(s) {
    s.pool = emptyBoard();
  },
  on: {
    pool(s, m) {
      s.pool = m.board;
      return ['pool'];
    },
  },
  enter(s, v) {
    s.pool = v.pool ?? emptyBoard();
    return ['pool'];
  },
};
