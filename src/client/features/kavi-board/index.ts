/** Karen (the face-computer) and the Bridge title board. Both are fixtures on the office floor. */
import type { Ctx } from '../../core/context';

/** How often the Bridge feed repaints her face and the title board, while the office world is running. */
const FEED_EVERY = 5;

/**
 * Wires the two fixtures `build.ts` already places (`kaviKaren`, `kaviBoard`) to the Bridge title
 * feed. Walking stays on the fixture; this is what keeps the face and the board on the same titles.
 */
export function installKaviBoard(ctx: Ctx) {
  const karen = ctx.office.kaviKaren;
  const board = ctx.office.kaviBoard;
  let feedAge = 0;
  ctx.ticks.add('world', ({ dt }) => {
    // The office world is what walks her. The feed only advances while that world does.
    if (!ctx.inOffice() || ctx.upTop()) return;
    feedAge += dt;
    if (feedAge < FEED_EVERY) return;
    feedAge = 0;
    void fetch('/api/bridge/kavi-feed', { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { titles?: { name?: string }[] } | null) => {
        const names = (j?.titles || []).map((t) => String(t.name || '').trim()).filter(Boolean);
        if (!names.length) return;
        karen.setFeedTitles(names);
        board.show(names);
      })
      .catch(() => {});
  });
}
