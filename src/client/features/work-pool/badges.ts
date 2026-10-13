// Original badge art for the seven work-pool levels. Drawn with canvas paths only.
import type { BadgeShape, LevelInfo } from '../../../shared/pool';

const METAL = {
  bronze: '#8c6239',
  silver: '#c5ccd6',
  gold: '#e0b44a',
  bone: '#f4efe4',
} as const;

const INK = '#1d2433';

export function drawBadge(g: CanvasRenderingContext2D, info: Pick<LevelInfo, 'badge' | 'marks' | 'metal'>, x: number, y: number, size: number) {
  const color = METAL[info.metal];
  g.save();
  g.translate(x, y);
  if (info.badge === 'skull') drawSkull(g, size, color);
  else if (info.badge === 'bar') drawBars(g, size, color, info.marks);
  else if (info.badge === 'stripes-star') drawStripes(g, size, color);
  else drawChevrons(g, size, color, 1);
  g.restore();
}

function drawChevrons(g: CanvasRenderingContext2D, size: number, color: string, count: number) {
  g.strokeStyle = color;
  g.lineWidth = Math.max(2, size * 0.16);
  g.lineCap = 'round';
  g.lineJoin = 'round';
  for (let i = 0; i < count; i++) {
    const y = -size * 0.22 + i * size * 0.28;
    g.beginPath();
    g.moveTo(-size * 0.42, y + size * 0.18);
    g.lineTo(0, y - size * 0.16);
    g.lineTo(size * 0.42, y + size * 0.18);
    g.stroke();
  }
}

function drawStripes(g: CanvasRenderingContext2D, size: number, color: string) {
  drawChevrons(g, size * 0.85, color, 3);
  drawStar(g, 0, size * 0.34, size * 0.16, color);
}

function drawBars(g: CanvasRenderingContext2D, size: number, color: string, count: number) {
  g.fillStyle = color;
  const w = size * 0.72;
  const h = size * 0.14;
  const gap = size * 0.12;
  const total = count * h + (count - 1) * gap;
  for (let i = 0; i < count; i++) {
    const y = -total / 2 + i * (h + gap);
    roundRect(g, -w / 2, y, w, h, h / 2);
    g.fill();
  }
}

function drawStar(g: CanvasRenderingContext2D, x: number, y: number, r: number, color: string) {
  g.fillStyle = color;
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const rad = (i % 2 === 0 ? r : r * 0.42);
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const px = x + Math.cos(a) * rad;
    const py = y + Math.sin(a) * rad;
    if (i === 0) g.moveTo(px, py);
    else g.lineTo(px, py);
  }
  g.closePath();
  g.fill();
}

/** A simple geometric skull: oval, two eyes, a small nose. Not taken from any game. */
function drawSkull(g: CanvasRenderingContext2D, size: number, color: string) {
  const glow = g.createRadialGradient(0, 0, size * 0.1, 0, 0, size * 0.7);
  glow.addColorStop(0, 'rgba(255, 214, 120, 0.9)');
  glow.addColorStop(1, 'rgba(255, 214, 120, 0)');
  g.fillStyle = glow;
  g.beginPath();
  g.arc(0, 0, size * 0.62, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = color;
  g.strokeStyle = INK;
  g.lineWidth = Math.max(1, size * 0.04);
  g.beginPath();
  g.ellipse(0, -size * 0.02, size * 0.32, size * 0.36, 0, 0, Math.PI * 2);
  g.fill();
  g.stroke();
  g.fillStyle = INK;
  g.beginPath();
  g.ellipse(-size * 0.12, -size * 0.06, size * 0.07, size * 0.09, 0, 0, Math.PI * 2);
  g.ellipse(size * 0.12, -size * 0.06, size * 0.07, size * 0.09, 0, 0, Math.PI * 2);
  g.fill();
  g.beginPath();
  g.moveTo(0, size * 0.02);
  g.lineTo(-size * 0.05, size * 0.12);
  g.lineTo(size * 0.05, size * 0.12);
  g.closePath();
  g.fill();
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

export function badgeLabel(shape: BadgeShape): string {
  if (shape === 'skull') return 'skull';
  if (shape === 'bar') return 'bar';
  if (shape === 'stripes-star') return 'stripes';
  return 'chevron';
}
