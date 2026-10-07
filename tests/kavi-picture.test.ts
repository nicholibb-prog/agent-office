// Kavi's picture window (features/kavi-board/picture.ts): a still picture over the Bridge NPC that
// says plainly it isn't a live call, and never dresses up as one.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { PICTURE_ALT, PICTURE_LABEL, PICTURE_SRC, SHOW_WITHIN, pictureSpot, sightBlocked } from '../src/client/features/kavi-board/picture.js';

const root = path.join(import.meta.dirname, '..');
const feature = path.join(root, 'src/client/features/kavi-board');

test('the picture window says it is a picture, not a live call, and Kavi replies async', () => {
  assert.equal(PICTURE_LABEL, 'Picture · not a live call · Kavi replies async');
  assert.equal(PICTURE_ALT, 'Kavi picture (not a live call)');
  for (const text of [PICTURE_LABEL, PICTURE_ALT]) {
    // "live" only ever as "not a live call".
    assert.equal(text.toLowerCase().replaceAll('not a live call', '').includes('live'), false, text);
  }
});

test('nothing in the window pretends to be a call: no connected state, timer, or mic and camera controls', () => {
  const src = readFileSync(path.join(feature, 'picture.ts'), 'utf8') + readFileSync(path.join(feature, 'picture.css'), 'utf8');
  // The doc comment says what it hasn't got; what's drawn is the code after it.
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  for (const word of [/connected/i, /connecting/i, /\bon call\b/i, /\btimer\b/i, /\d{1,2}:\d{2}/, /\bmic\b/i, /microphone/i, /camera-icon|webcam/i, /🎤|🎙|📹|📷|📞|🔴/u, /getUserMedia/]) {
    assert.equal(word.test(code), false, `picture window has ${word}`);
  }
});

test('the picture is a small asset in the client bundle, not the full-size original', () => {
  const file = path.join(root, 'src/client/public', PICTURE_SRC.replace(/^\//, ''));
  const bytes = readFileSync(file);
  assert.ok(statSync(file).size <= 100 * 1024, `${PICTURE_SRC} is ${statSync(file).size} bytes`);
  // PNG signature, then the IHDR's width and height.
  assert.equal(bytes.subarray(1, 4).toString('latin1'), 'PNG');
  assert.ok(bytes.readUInt32BE(16) <= 256 && bytes.readUInt32BE(20) <= 256, 'at most 256 px square');
});

test('the window shows near the NPC and in view, and not far off, behind you, or off screen', () => {
  const near = pictureSpot(3, { x: 0, y: 0.2, z: 0.9 }, 1000, 800);
  assert.ok(near);
  assert.equal(near.x, 500);
  assert.equal(near.scale, 1);
  assert.equal(pictureSpot(SHOW_WITHIN + 0.5, { x: 0, y: 0, z: 0.9 }, 1000, 800), null);
  assert.equal(pictureSpot(3, { x: 0, y: 0, z: 1.2 }, 1000, 800), null);
  assert.equal(pictureSpot(3, { x: 1.5, y: 0, z: 0.9 }, 1000, 800), null);
  // Further off it's drawn smaller, but never tiny.
  const far = pictureSpot(SHOW_WITHIN, { x: 0, y: 0, z: 0.99 }, 1000, 800);
  assert.ok(far && far.scale < 1 && far.scale >= 0.75);
  // Up close, with her head above the top of the screen, the window stays in view.
  const close = pictureSpot(1, { x: 0, y: 1.3, z: 0.5 }, 1000, 800);
  assert.ok(close && close.y > 0);
});

test('the window hides when a wall or board stands between you and her, not for desks or her own footprint', () => {
  const board = { minX: -1, maxX: 1, minZ: -0.1, maxZ: 0.1, top: 2.6 };
  const desk = { minX: -1, maxX: 1, minZ: -0.5, maxZ: 0.5, top: 0.75 };
  const hers = { minX: -0.5, maxX: 0.5, minZ: 2.65, maxZ: 3.35, top: 1.9 };
  const you = { x: 0, z: -3 };
  const her = { x: 0, z: 3 };
  assert.equal(sightBlocked(you, her, [board]), true);
  assert.equal(sightBlocked(you, her, [desk]), false);
  assert.equal(sightBlocked(you, her, [hers]), false);
  // Off to one side of the board, nothing's in the way.
  assert.equal(sightBlocked({ x: 3, z: -3 }, { x: 3, z: 3 }, [board]), false);
});
