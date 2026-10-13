// The live desk-screen feed, as the browser sees it. Polls which seats an office person switched on,
// and while a seat's worker is WORKING pulls its latest frame from the office server (same origin,
// session cookie). Nothing here makes up a picture: no frame means "no live feed".
const SEATS_MS = 3000;
const FRAME_MS = 500;

export type LiveImage = { img: CanvasImageSource; w: number; h: number; at: number };

const enabled = new Set<string>();
const frames = new Map<string, LiveImage>();
const pulling = new Set<string>();
let started = false;

export const seatOf = (name: string) => name.replace(/\s*[^\w\s.-]+\s*$/u, '').trim().toLowerCase();

async function refreshSeats() {
  try {
    const r = await fetch('/api/live/seats', { credentials: 'same-origin', cache: 'no-store' });
    if (!r.ok) return;
    const j = (await r.json()) as { seats?: { seat: string }[] };
    enabled.clear();
    for (const s of j.seats ?? []) enabled.add(s.seat);
    for (const k of [...frames.keys()]) if (!enabled.has(k)) frames.delete(k);
  } catch {
    /* office down: keep what we had, the frame ages out */
  }
}

async function pull(seat: string) {
  if (pulling.has(seat)) return;
  pulling.add(seat);
  try {
    const r = await fetch('/api/live/frame/' + encodeURIComponent(seat), { credentials: 'same-origin', cache: 'no-store' });
    if (!r.ok) {
      frames.delete(seat);
      return;
    }
    const at = Number(r.headers.get('x-frame-at')) || Date.now();
    const bmp = await createImageBitmap(await r.blob());
    frames.set(seat, { img: bmp, w: bmp.width, h: bmp.height, at });
  } catch {
    frames.delete(seat);
  } finally {
    pulling.delete(seat);
  }
}

const wanted = new Set<string>();

function start() {
  if (started || typeof window === 'undefined' || typeof fetch === 'undefined') return;
  started = true;
  void refreshSeats();
  setInterval(() => void refreshSeats(), SEATS_MS);
  setInterval(() => {
    for (const s of wanted) if (enabled.has(s)) void pull(s);
    wanted.clear();
  }, FRAME_MS);
}

/**
 * What the desk should show for a working worker: a real frame, or 'none'. Undefined when the
 * worker isn't working (idle screens stay exactly as they were).
 */
export function liveFor(name: string, working: boolean, now = Date.now(), id?: string): LiveImage | 'none' | undefined {
  if (!working) return undefined;
  start();
  // Crew desks are `crew-<seat>`: the seat a token names. Others fall back to the name.
  const seat = id?.startsWith('crew-') ? id.slice(5) : seatOf(name);
  wanted.add(seat);
  const f = frames.get(seat);
  if (!f || now - f.at > 10_000) return 'none';
  return f;
}
