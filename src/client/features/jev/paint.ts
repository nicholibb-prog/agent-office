// The rankings drawn onto the Jev board's face. Canvas only: the mesh in world.ts puts this on a texture.
import { JEV_FORMULA, looksSensitive, type JevBoard, type JevRanking } from '../../../shared/jev';

const FONT = 'Nunito, ui-rounded, system-ui, sans-serif';
const INK = '#1c2430';
const MUTED = '#5c6b7a';
const PAPER = '#f6f1e6';
const HEADER = '#1c3044';
const GOLD = '#e6b422';

const MEDAL = ['#e6b422', '#c5ced6', '#c4844a'];

/** Paints `board` into a canvas of `width` × `height` pixels. Rows that look like secrets are skipped. */
export function paintJevBoard(g: CanvasRenderingContext2D, width: number, height: number, board: JevBoard): void {
  const rows = board.rankings.filter((row) => !looksSensitive(row.displayName) && !looksSensitive(row.agentId)).slice(0, 6);
  g.fillStyle = PAPER;
  g.fillRect(0, 0, width, height);
  g.fillStyle = HEADER;
  g.fillRect(0, 0, width, 108);
  g.fillStyle = GOLD;
  g.fillRect(0, 108, width, 8);
  g.fillStyle = '#f4f7fb';
  g.font = `800 42px ${FONT}`;
  g.textAlign = 'left';
  g.textBaseline = 'middle';
  g.fillText('JEV LEADERBOARD', 36, 46);
  g.fillStyle = '#c5d4e4';
  g.font = `700 22px ${FONT}`;
  g.fillText('this computer only', 36, 82);

  if (!rows.length) {
    g.fillStyle = MUTED;
    g.font = `700 32px ${FONT}`;
    g.textAlign = 'center';
    g.fillText('No rankings yet', width / 2, height / 2);
    return;
  }

  g.textAlign = 'left';
  g.fillStyle = MUTED;
  g.font = `700 18px ${FONT}`;
  const headY = 148;
  g.fillText('#', 36, headY);
  g.fillText('AGENT', 100, headY);
  g.fillText('SCORE', 430, headY);
  g.fillText('LINES', 580, headY);
  g.fillText('PRS', 720, headY);
  g.fillText('TASKS', 820, headY);
  g.fillText('BREAK', 960, headY);

  rows.forEach((row, i) => paintRow(g, row, 184 + i * 64, i));

  g.fillStyle = MUTED;
  g.font = `600 16px ${FONT}`;
  g.textAlign = 'left';
  g.fillText(board.formula || JEV_FORMULA, 36, height - 28);
}

function paintRow(g: CanvasRenderingContext2D, row: JevRanking, y: number, index: number) {
  if (index % 2 === 0) {
    g.fillStyle = 'rgba(28, 48, 68, 0.06)';
    g.fillRect(24, y - 28, 1000, 56);
  }
  g.fillStyle = MEDAL[index] ?? '#8d99ae';
  g.beginPath();
  g.arc(48, y, 16, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = index < 3 ? '#1c2430' : '#f4f7fb';
  g.font = `800 18px ${FONT}`;
  g.textAlign = 'center';
  g.fillText(String(row.rank), 48, y);
  g.textAlign = 'left';
  g.fillStyle = INK;
  g.font = `800 26px ${FONT}`;
  g.fillText(row.displayName, 100, y);
  g.fillStyle = GOLD;
  g.font = `800 26px ${FONT}`;
  g.fillText(formatScore(row.rankScore), 430, y);
  g.fillStyle = INK;
  g.font = `700 22px ${FONT}`;
  g.fillText(String(row.linesWritten), 580, y);
  g.fillText(String(row.prsMerged), 720, y);
  g.fillText(String(row.tasksFinished), 820, y);
  g.fillStyle = MUTED;
  g.fillText(formatIdle(row.breakroomSeconds), 960, y);
}

function formatScore(score: number): string {
  if (!Number.isFinite(score)) return '0';
  return Number.isInteger(score) ? String(score) : score.toFixed(1);
}

function formatIdle(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s}s`;
  const minutes = Math.floor(s / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h`;
}
