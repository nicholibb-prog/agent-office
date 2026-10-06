// The enlarged desk desktop, for a headless screenshot (see shot.mjs). Same paintDesk picture as the lid.
import { paintDesk } from '../features/workers/desktop';

const canvas = document.getElementById('screen') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const now = 1_700_000_400_000;
paintDesk(ctx, canvas.width, canvas.height, {
  pace: 'working',
  chip: 'WORKING',
  now,
  name: 'Byte',
  activity: 'editing laptop.ts',
  lines: ['const live = true', 'paint the desk', 'status follows the worker'],
});
(window as unknown as { __ready: unknown }).__ready = { overlay: "Byte's working desktop" };
