// The center-room Jev board, pushed when the nightly ranking is published.
import type { JevBoard } from '../jev.js';

export type JevServerMsg =
  /** The floor's ranking changed: the first agents of a night, or the next midnight. */
  | { t: 'jev'; board: JevBoard };
