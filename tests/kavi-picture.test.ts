// Kavi's face (features/kavi-board/picture.ts, karen.ts): the Bridge NPC's screen shows a still
// picture of Kavi framed like a video call, says plainly it isn't a live call, and never dresses up as one.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { FACE_NAME, FACE_PX, FACE_SRC, paintFace, type FacePen } from '../src/client/features/kavi-board/picture.js';

const root = path.join(import.meta.dirname, '..');
const feature = path.join(root, 'src/client/features/kavi-board');

/** A 2D context that writes down what's drawn with it. */
function recorder() {
  const calls: { op: string; args: unknown[] }[] = [];
  const pen = new Proxy({ calls } as unknown as FacePen & { calls: typeof calls }, {
    get(target, key) {
      if (key in target) return (target as Record<string | symbol, unknown>)[key];
      if (key === 'measureText') return (s: string) => ({ width: s.length * 12 });
      return (...args: unknown[]) => calls.push({ op: String(key), args });
    },
    set(target, key, value) {
      (target as Record<string | symbol, unknown>)[key] = value;
      calls.push({ op: `=${String(key)}`, args: [value] });
      return true;
    },
  });
  return { pen, calls, texts: () => calls.filter((c) => c.op === 'fillText').map((c) => String(c.args[0])) };
}

test('the screen shows only her picture: no caption, name tag or strip over it once it loads', () => {
  assert.equal(FACE_NAME, 'Kavi');
  const loaded = recorder();
  paintFace(loaded.pen, { width: 488, height: 368 } as unknown as CanvasImageSource);
  assert.deepEqual(loaded.texts(), [], 'no text over the picture');
  assert.ok(loaded.calls.some((c) => c.op === 'drawImage'));
  const card = recorder();
  paintFace(card.pen, null);
  assert.deepEqual(card.texts(), [FACE_NAME], 'just her name on the card while it loads');
});

test('nothing on the screen pretends to be a call: no connected state, timer, or mic, camera or hang-up controls', () => {
  const src = ['picture.ts', 'karen.ts', 'index.ts'].map((f) => readFileSync(path.join(feature, f), 'utf8')).join('\n');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  for (const word of [/connected/i, /connecting/i, /\bon call\b/i, /hang.?up/i, /\btimer\b/i, /\d{1,2}:\d{2}/, /\bmic\b/i, /microphone/i, /webcam/i, /🎤|🎙|📹|📷|📞|🔴/u, /getUserMedia/]) {
    assert.equal(word.test(code), false, `kavi-board has ${word}`);
  }
  const r = recorder();
  paintFace(r.pen, null);
  for (const t of r.texts()) assert.equal(/live|connected|\d:\d\d/i.test(t), false, t);
});

test('the picture is a small asset sized for the screen, not the full-size original', () => {
  const file = path.join(root, 'src/client/public', FACE_SRC.replace(/^\//, ''));
  const bytes = readFileSync(file);
  assert.ok(statSync(file).size <= 100 * 1024, `${FACE_SRC} is ${statSync(file).size} bytes`);
  assert.equal(bytes.readUInt16BE(0), 0xffd8, 'a JPEG');
  // Its size, from the start-of-frame marker.
  let at = 2;
  let size: [number, number] | null = null;
  while (at < bytes.length - 9) {
    const marker = bytes.readUInt16BE(at);
    if (marker >= 0xffc0 && marker <= 0xffc2) {
      size = [bytes.readUInt16BE(at + 7), bytes.readUInt16BE(at + 5)];
      break;
    }
    at += 2 + bytes.readUInt16BE(at + 2);
  }
  assert.deepEqual(size, [488, 368]);
  assert.ok(FACE_PX.w <= 512 && FACE_PX.h <= 512);
});

test('the NPC\'s face material shows the picture texture: loaded once, sRGB, painted when it arrives, and let go on dispose', async () => {
  const pens: ReturnType<typeof recorder>[] = [];
  const images: { src: string; onload: (() => void) | null }[] = [];
  const g = globalThis as Record<string, unknown>;
  const saved = { document: g.document, Image: g.Image };
  g.document = { createElement: (tag: string) => {
    assert.equal(tag, 'canvas');
    const r = recorder();
    pens.push(r);
    return { width: 0, height: 0, getContext: () => r.pen };
  } };
  g.Image = class { src = ''; decoding = ''; onload: (() => void) | null = null; constructor() { images.push(this); } };
  try {
    const { buildKaviKaren } = await import('../src/client/features/kavi-board/karen.js');
    const npc = buildKaviKaren([]);
    const face = npc.group.getObjectByName('kavi-face') as THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
    assert.equal(face, npc.face);
    const map = face.material.map as THREE.CanvasTexture;
    assert.ok(map instanceof THREE.CanvasTexture);
    assert.equal(map.colorSpace, THREE.SRGBColorSpace);
    assert.equal((map.image as { width: number }).width, FACE_PX.w);
    assert.equal((map.image as { height: number }).height, FACE_PX.h);
    // One picture, asked for once.
    assert.equal(images.length, 1);
    assert.equal(images[0].src, FACE_SRC);
    const pen = pens[0];
    assert.deepEqual(pen.texts(), [FACE_NAME]);
    assert.equal(pen.calls.some((c) => c.op === 'drawImage'), false, 'no picture before it has loaded');
    const version = map.version;
    images[0].onload!();
    const drawn = pen.calls.find((c) => c.op === 'drawImage');
    assert.equal(drawn?.args[0], images[0], 'the picture is painted onto the face');
    assert.ok(map.version > version, 'and the texture is told');
    // Walking around doesn't repaint it.
    const before = pen.calls.length;
    for (let i = 0; i < 20; i++) npc.tick(0.1);
    assert.equal(pen.calls.length, before);
    let disposed = 0;
    map.addEventListener('dispose', () => disposed++);
    face.material.addEventListener('dispose', () => disposed++);
    face.geometry.addEventListener('dispose', () => disposed++);
    npc.dispose();
    assert.equal(disposed, 3);
    assert.equal(images[0].onload, null);
  } finally {
    g.document = saved.document;
    g.Image = saved.Image;
  }
});
