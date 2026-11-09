// Desk frame crossfade: double-buffered, never blank between frames, no fade under reduced motion.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CROSSFADE_MS, fadeAlpha, liveLayers } from '../src/client/features/workers/desktop.js';

const frame = (id: number) => ({ img: { id } as unknown as CanvasImageSource, w: 10, h: 10, at: id });

test('fade curve: 0 → 1 over CROSSFADE_MS, monotonic; reduced motion is instant', () => {
  assert.equal(fadeAlpha(0, false), 0);
  assert.equal(fadeAlpha(CROSSFADE_MS, false), 1);
  let last = -1;
  for (let t = 0; t <= CROSSFADE_MS; t += 25) {
    const a = fadeAlpha(t, false);
    assert.ok(a >= last);
    last = a;
  }
  assert.equal(fadeAlpha(0, true), 1);
});

test('first frame shows at once; a new frame fades in over the old one (never blank)', () => {
  const key = {};
  const a = frame(1);
  const b = frame(2);
  const first = liveLayers(key, a, 1000, false);
  assert.equal(first.alpha, 1);
  assert.equal(first.under, undefined);
  const mid = liveLayers(key, b, 2000, false);
  assert.equal(mid.under, a, 'old frame kept underneath');
  assert.equal(mid.top, b);
  assert.equal(mid.alpha, 0);
  const half = liveLayers(key, b, 2000 + CROSSFADE_MS / 2, false);
  assert.equal(half.under, a);
  assert.ok(half.alpha > 0 && half.alpha < 1);
  const done = liveLayers(key, b, 2000 + CROSSFADE_MS, false);
  assert.equal(done.alpha, 1);
  assert.equal(done.under, undefined, 'old buffer released after the fade');
});

test('reduced motion swaps straight to the new frame', () => {
  const key = {};
  liveLayers(key, frame(1), 0, true);
  const r = liveLayers(key, frame(2), 10, true);
  assert.equal(r.alpha, 1);
  assert.equal(r.under, undefined);
});

test('separate canvases keep separate buffers', () => {
  const k1 = {};
  const k2 = {};
  liveLayers(k1, frame(1), 0, false);
  const five = frame(5);
  liveLayers(k2, five, 0, false);
  assert.equal(liveLayers(k1, frame(2), 100, false).under?.at, 1);
  assert.equal(liveLayers(k2, five, 100, false).under, undefined);
});
