// The picture on a desk laptop. The terminal mirror only repaints when a row changes, so a worker
// that sits on one screen looks frozen. This draws a small desktop instead, and keeps redrawing it
// from the worker's own status (setStatus / mid-turn) and from lastInput, with no capture of
// anyone's real desktop. Click the laptop to see the same picture large. Press E at the desk for
// the real terminal.
import type { WorkerStatus } from '../../../shared/protocol';
import { isAsleep } from '../../../shared/status';
import type { ScreenState } from '../../state/store';

/** Working (blink, scroll, bars) or sitting still. `attention` blinks for a worker that needs you. */
export type DeskPace = 'working' | 'attention' | 'calm';

/** How long a keystroke (WorkerInfo.lastInput) keeps the screen awake before status catches up. */
export const KEYSTROKE_MS = 4000;

export interface DeskFace {
  pace: DeskPace;
  /** The chip on the menu bar: WORKING, NEEDS YOU, idle, done, asleep. */
  chip: string;
  /** Animation clock (ms). Not compared with lastInput, which is a wall clock. */
  now: number;
  name: string;
  activity?: string;
  /** Tail of the real terminal, newest last. Empty uses a stand-in line. */
  lines: string[];
  /** prefers-reduced-motion: one pose, so working and idle still read differently. */
  still?: boolean;
}

/** What the laptop should do, from the office's worker state. `typedAt` is lastInput.at (wall clock). */
export function deskFace(status: WorkerStatus, typedAt: number | undefined, wallNow: number): { pace: DeskPace; chip: string } {
  if (status === 'working') return { pace: 'working', chip: 'WORKING' };
  if (status === 'starting') return { pace: 'working', chip: 'STARTING' };
  if (status === 'needs_input') return { pace: 'attention', chip: 'NEEDS YOU' };
  if (typedAt !== undefined && wallNow - typedAt >= 0 && wallNow - typedAt < KEYSTROKE_MS && !isAsleep(status)) {
    return { pace: 'working', chip: 'WORKING' };
  }
  if (status === 'done') return { pace: 'calm', chip: 'done' };
  if (isAsleep(status)) return { pace: 'calm', chip: 'asleep' };
  return { pace: 'calm', chip: 'idle' };
}

/** The last non-empty rows of a terminal mirror, for the desktop's terminal window. */
export function screenLines(s: ScreenState | undefined, limit = 6): string[] {
  if (!s) return [];
  const out: string[] = [];
  for (const runs of s.lines) {
    if (!runs) continue;
    const text = runs.map((r) => r[0]).join('').replace(/\s+$/, '');
    if (text.trim()) out.push(text);
  }
  return out.slice(-limit);
}

const FILES = ['task.md', 'src/desk.ts', 'tests/', 'README.md', 'notes.txt', 'diff'];
const FONT = 'ui-monospace, Menlo, Consolas, monospace';

function clock(now: number): string {
  const d = new Date(now);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}

function chipColor(pace: DeskPace): string {
  if (pace === 'working') return '#ffd166';
  if (pace === 'attention') return '#ff5c7a';
  return '#6c7086';
}

/** One frame of the desk desktop. A calm face keeps its windows still; the clock on the bar can still tick. */
export function paintDesk(ctx: CanvasRenderingContext2D, w: number, h: number, face: DeskFace) {
  const t = face.still ? 0 : face.now;
  const live = face.pace === 'working' && !face.still;
  ctx.save();
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#12141c';
  ctx.fillRect(0, 0, w, h);

  ctx.fillStyle = '#1b1e2b';
  ctx.fillRect(0, 0, w, 44);
  ctx.fillStyle = '#e6e6f0';
  ctx.font = `700 ${Math.round(h / 28)}px ${FONT}`;
  ctx.fillText(face.name.slice(0, 22), 16, 10);
  ctx.fillStyle = '#9aa0b8';
  ctx.font = `600 ${Math.round(h / 34)}px ${FONT}`;
  ctx.fillText(clock(face.now), w * 0.42, 12);
  const chipW = Math.max(120, face.chip.length * 14 + 28);
  ctx.fillStyle = chipColor(face.pace);
  ctx.globalAlpha = face.pace === 'calm' || face.still ? 1 : 0.75 + 0.25 * Math.abs(Math.sin(t / 280));
  ctx.fillRect(w - chipW - 16, 8, chipW, 28);
  ctx.globalAlpha = 1;
  ctx.fillStyle = face.pace === 'working' ? '#1b1d2e' : '#fffaf3';
  ctx.font = `800 ${Math.round(h / 36)}px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.fillText(face.chip, w - chipW / 2 - 16, 13);
  ctx.textAlign = 'left';

  const gap = 14;
  const top = 56;
  const mainW = Math.round(w * 0.62);
  paintWindow(ctx, gap, top, mainW - gap, h - top - gap, 'terminal', face, t, (x, y, ww, hh) => paintTerm(ctx, x, y, ww, hh, face, live));
  const sideX = mainW + gap;
  const sideW = w - sideX - gap;
  const filesH = Math.round((h - top - gap * 2) * 0.48);
  paintWindow(ctx, sideX, top, sideW, filesH, 'files', face, t, (x, y, ww, hh) => paintFiles(ctx, x, y, ww, hh, live ? t : 0));
  paintWindow(
    ctx, sideX, top + filesH + gap, sideW, h - (top + filesH + gap) - gap, 'activity', face, t,
    (x, y, ww, hh) => paintActivity(ctx, x, y, ww, hh, face, t, live),
  );
  ctx.restore();
}

function paintWindow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  title: string,
  face: DeskFace,
  t: number,
  body: (x: number, y: number, w: number, h: number) => void,
) {
  const bar = 32;
  ctx.fillStyle = '#0e1018';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = face.pace === 'working' ? '#33406e' : face.pace === 'attention' ? '#5c2438' : '#2a2d3e';
  ctx.fillRect(x, y, w, bar);
  if (face.pace === 'working') {
    const span = Math.max(1, w - 90);
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x + 8 + (face.still ? 16 : (t / 5) % span), y + 8, 28, bar - 16);
    ctx.globalAlpha = 1;
  }
  ctx.fillStyle = '#e6e6f0';
  ctx.font = `700 ${Math.round(bar * 0.5)}px ${FONT}`;
  ctx.fillText(title, x + 12, y + 8);
  body(x + 8, y + bar + 6, w - 16, h - bar - 14);
}

function termFeed(face: DeskFace): string[] {
  const lines = face.lines.map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean).slice(-6);
  if (lines.length) return lines;
  if (face.pace === 'working') return [face.activity || 'working…', 'reading the task', 'editing files', 'running checks'];
  if (face.pace === 'attention') return [face.activity || 'waiting on you'];
  return ['ready'];
}

function paintTerm(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, face: DeskFace, live: boolean) {
  const feed = termFeed(face);
  const t = live ? face.now : 0;
  const shift = live ? Math.floor(t / 420) % feed.length : 0;
  const rows = [...feed.slice(shift), ...feed.slice(0, shift)];
  const lineH = Math.min(36, Math.floor(h / 7));
  const font = Math.max(12, lineH - 10);
  ctx.font = `500 ${font}px ${FONT}`;
  ctx.fillStyle = '#c8c9d8';
  const shown = rows.slice(0, Math.max(1, Math.floor(h / lineH) - 1));
  shown.forEach((line, i) => ctx.fillText(line.slice(0, 42), x, y + i * lineH));
  const blink = face.pace !== 'calm' && (face.still || Math.floor((face.still ? 0 : face.now) / 530) % 2 === 0);
  if (blink) {
    const last = shown[shown.length - 1] ?? '';
    ctx.fillStyle = face.pace === 'attention' ? '#ff5c7a' : '#ffd166';
    ctx.fillRect(x + Math.min(w - 16, last.slice(0, 42).length * font * 0.6 + 4), y + (shown.length - 1) * lineH, Math.max(8, font * 0.55), font);
  }
}

function paintFiles(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, t: number) {
  const rowH = Math.min(32, Math.floor(h / FILES.length));
  const on = t === 0 ? 0 : Math.floor(t / 700) % FILES.length;
  ctx.font = `600 ${Math.max(12, rowH - 12)}px ${FONT}`;
  FILES.forEach((name, i) => {
    if (i === on) {
      ctx.fillStyle = t === 0 ? '#2a3148' : '#3d4f86';
      ctx.fillRect(x, y + i * rowH, w, rowH - 4);
    }
    ctx.fillStyle = i === on ? '#fffaf3' : '#9aa0b8';
    ctx.fillText(name, x + 8, y + i * rowH + 4);
  });
}

function paintActivity(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  face: DeskFace,
  t: number,
  live: boolean,
) {
  const n = 5;
  const gap = 10;
  const bw = (w - gap * (n - 1)) / n;
  const base = h * 0.62;
  for (let i = 0; i < n; i++) {
    const wave = live ? Math.abs(Math.sin(t / 280 + i * 0.9)) : face.pace === 'attention' && !face.still ? 0.45 : 0.22;
    const bh = Math.max(8, base * wave);
    ctx.fillStyle = face.pace === 'calm' ? '#3a3d4e' : face.pace === 'attention' ? '#ff5c7a' : '#72ddf7';
    ctx.fillRect(x + i * (bw + gap), y + base - bh, bw, bh);
  }
  const note = (face.activity || (face.pace === 'working' ? 'working…' : face.pace === 'attention' ? 'needs you' : 'quiet')).slice(0, 28);
  ctx.font = `600 ${Math.max(12, Math.round(h / 10))}px ${FONT}`;
  ctx.fillStyle = '#c8c9d8';
  ctx.fillText(note, x - (live ? (t / 40) % Math.max(80, note.length * 8) : 0), y + base + 10);
}

/** What the laptop shows before its terminal has printed a line. */
export interface DeskWorker {
  status: WorkerStatus;
  name: string;
  activity?: string;
  lastInput?: { at: number };
  kind?: 'agent' | 'shell';
  lost?: unknown;
}

/** The stand-in line on an empty laptop, for a shell or an agent. */
export function laptopPlaceholder(w: DeskWorker): string {
  const again = w.kind === 'shell' ? 'restart' : 'resume';
  if (w.lost) return `🌿 ${w.name}'s worktree was deleted — press E to fix it`;
  if (w.status === 'offline') return `💤 ${w.name} is asleep — press R to ${again}`;
  if (w.status === 'exited') return `${w.name} exited`;
  return 'booting…';
}

/**
 * The desktop both the laptop lid and the enlarged overlay paint. `animNow` drives the blink and
 * the scroll (and the clock on the bar). `wallNow` is only for how recently someone typed.
 */
export function workerDesktop(w: DeskWorker, screen: ScreenState | undefined, animNow: number, wallNow: number, still = false): DeskFace {
  const lines = screenLines(screen);
  return {
    ...deskFace(w.status, w.lastInput?.at, wallNow),
    now: animNow,
    name: w.name,
    activity: w.activity,
    lines: lines.length ? lines : [laptopPlaceholder(w)],
    still,
  };
}
