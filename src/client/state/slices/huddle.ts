import type { HuddleFloorState } from '../../../shared/protocol';
import { emptyHuddleFloor } from '../../../shared/protocol';
import type { Slice } from '../store';

declare module '../store' {
  interface Store {
    /** The meeting-room huddle and the front-desk providers. */
    huddle: HuddleFloorState;
  }
  interface Topics {
    huddle: true;
  }
}

export const huddle: Slice = {
  init(s) {
    s.huddle = emptyHuddleFloor();
  },
  on: {
    huddle(s, m) {
      s.huddle = m.state;
      return ['huddle'];
    },
  },
  enter(s, v) {
    s.huddle = v.huddle;
    return ['huddle'];
  },
};
