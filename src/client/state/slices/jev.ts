import type { JevBoard } from '../../../shared/jev';
import type { Slice } from '../store';

declare module '../store' {
  interface Store {
    /** Rankings on the center-room Jev board, and which desks have a cup. */
    jev: JevBoard;
  }
  interface Topics {
    jev: true;
  }
}

const EMPTY: JevBoard = { rows: [], trophies: [] };

export const jev: Slice = {
  init(s) {
    s.jev = EMPTY;
  },
  on: {
    jev(s, m) {
      s.jev = m.board ?? EMPTY;
      return ['jev'];
    },
  },
  enter(s, v) {
    s.jev = v.jev ?? EMPTY;
    return ['jev'];
  },
};
