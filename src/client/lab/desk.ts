// Idle beside working, for a headless screenshot of the desk laptops (see shot.mjs).
import { paintDesk } from '../features/workers/desktop';
import { ready } from './stage';

const lines = ['const live = true', 'paint the desk', 'status follows the worker'];
const base = { name: 'Byte', activity: 'editing laptop.ts', lines };

function draw(id: string, pace: 'working' | 'calm', chip: string, now: number) {
  const canvas = document.getElementById(id) as HTMLCanvasElement;
  const ctx = canvas.getContext('2d')!;
  paintDesk(ctx, canvas.width, canvas.height, { pace, chip, now, ...base });
}

const t = 1_700_000_000_000;
draw('calm', 'calm', 'idle', t);
draw('work', 'working', 'WORKING', t);
draw('later', 'working', 'WORKING', t + 600);
ready({ desk: 'idle beside WORKING' });
