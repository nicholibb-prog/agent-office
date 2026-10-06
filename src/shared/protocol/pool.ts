// The community work pool board, pushed when it changes.

import type { PoolBoard } from '../pool.js';

export type PoolServerMsg = { t: 'pool'; board: PoolBoard };
