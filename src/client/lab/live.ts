// Desk screens with the live-feed path, for a headless screenshot (see shot.mjs). The third canvas
// uses a labelled test pattern as the pushed frame. It is a lab fixture, never shown in the office.
import { paintDesk, type DeskFace } from '../features/workers/desktop';
import { ready } from './stage';

const base = { name: 'Byte', activity: 'editing laptop.ts', lines: ['const live = true', 'paint the desk'] };
const t = 1_700_000_000_000;

function draw(id: string, face: Omit<DeskFace, 'name' | 'lines' | 'now'>) {
  const c = document.getElementById(id) as HTMLCanvasElement;
  paintDesk(c.getContext('2d')!, c.width, c.height, { ...base, now: t, ...face });
}

const pat = document.createElement('canvas');
pat.width = 1280;
pat.height = 800;
const p = pat.getContext('2d')!;
['#c0c0c0', '#c0c000', '#00c0c0', '#00c000', '#c000c0', '#c00000', '#0000c0'].forEach((col, i) => {
  p.fillStyle = col;
  p.fillRect((i * pat.width) / 7, 0, pat.width / 7 + 1, pat.height);
});
p.fillStyle = 'rgba(0,0,0,0.75)';
p.fillRect(240, 330, 800, 140);
p.fillStyle = '#fff';
p.font = '700 56px ui-monospace, monospace';
p.textAlign = 'center';
p.fillText('TEST PATTERN 1280×800', 640, 420);

draw('calm', { pace: 'calm', chip: 'idle' });
draw('none', { pace: 'working', chip: 'WORKING', live: 'none' });
draw('live', { pace: 'working', chip: 'WORKING', live: { img: pat, w: pat.width, h: pat.height, at: t } });
ready({ desk: 'idle / working no feed / working live' });
