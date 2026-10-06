/**
 * The Jev leaderboard: local rankings on the standing board, and a trophy on a desk once a
 * milestone names one. The numbers come from this computer's /api/jev. There is no TypeSafe call.
 */
import type { Group } from 'three';
import { isJevBoard, type JevBoard } from '../../../shared/jev';
import type { Ctx } from '../../core/context';
import { aside, hintTitle, key, onE } from '../../core/hint';
import { syncDeskTrophies } from './trophy';

declare module '../../world/types' {
  interface InteractKinds {
    jev: true;
  }
}

export function installJev(ctx: Ctx) {
  const cups = new WeakMap<object, Map<string, Group>>();

  async function refresh() {
    try {
      const res = await fetch('/api/jev', { cache: 'no-store' });
      if (!res.ok) return;
      const body: unknown = await res.json();
      if (!isJevBoard(body)) return;
      show(body);
    } catch {
      // The page may still be signing in, or the office may be restarting.
    }
  }

  function show(board: JevBoard) {
    const world = ctx.world();
    world.jev?.show(board);
    let placed = cups.get(world);
    if (!placed) cups.set(world, (placed = new Map()));
    syncDeskTrophies(world.desks, board.rankings, placed);
  }

  ctx.interactions.define('jev', {
    reach: 3.4,
    hint: () => ({ k: '', parts: [hintTitle('🏆 Jev board'), aside('local rankings'), key('E', 'Refresh')] }),
    use: onE(() => void refresh()),
  });

  void refresh();
  window.setInterval(() => void refresh(), 4000);
}
