// What the card shows for a board reply: nothing (non-owner, error), an honest off note, or lines.
import { BOARD_TITLE, ROUTER_OFF_NOTE, boardLines, type RouterBoardReply } from '../../../shared/router-board';

export type CardView = { hidden: true } | { hidden: false; title: string; lines: string[]; note: boolean };

export function cardView(status: number, body: RouterBoardReply | null): CardView {
  if (status !== 200 || !body || 'private' in body) return { hidden: true };
  if (!body.on) return { hidden: false, title: BOARD_TITLE, lines: [ROUTER_OFF_NOTE], note: true };
  return { hidden: false, title: BOARD_TITLE, lines: boardLines(body), note: false };
}
