import * as THREE from 'three';
// The supercomputer's light comes from real Okkin state only, and the power sequence runs in order:
// on ON bottom to top, on OFF top to bottom.
import test from 'node:test';
import assert from 'node:assert/strict';
import { BLADE_ROWS, MODEL_ACCENT, OFF_LEVEL, SEQ_STEP, bladeLevel, haloLevel, heroMode, hologramLines, seqProgress, sweepBand } from '../src/client/features/okkin-loft/hero-light.js';
import { OKKIN_MODELS } from '../src/shared/okkin-loft.js';

const ctx2d = new Proxy({}, { get: (_t, k) => (k === 'measureText' ? () => ({ width: 40 }) : () => ({ addColorStop() {} })), set: () => true });
(globalThis as { document?: unknown }).document ??= { createElement: () => ({ getContext: () => ctx2d, width: 0, height: 0 }) };

test('state → light: off dim, idle a slow breathe, working a fast ripple; real state only', () => {
  assert.equal(heroMode({ power: 'off', busy: true }), 'off', 'off wins over a stale busy flag');
  assert.equal(heroMode({ power: 'on' }), 'idle');
  assert.equal(heroMode({ power: 'on', busy: true }), 'working');
  assert.equal(heroMode({ power: 'on', loading: true }), 'working');
  for (let t = 0; t < 6; t += 0.37) assert.equal(bladeLevel('off', t, 3), OFF_LEVEL);
  const idle = [0, 1.25, 2.5, 3.75].map((t) => bladeLevel('idle', t, 0));
  assert.ok(Math.max(...idle) - Math.min(...idle) > 0.2 && Math.max(...idle) < 0.7, 'idle breathes gently');
  assert.ok(Math.abs(bladeLevel('idle', 0, 0) - bladeLevel('idle', 0, 10)) < 1e-9, 'idle is even across rows');
  const rows = Array.from({ length: BLADE_ROWS }, (_, r) => bladeLevel('working', 1, r));
  assert.ok(Math.max(...rows) - Math.min(...rows) > 0.5, 'working ripples across rows');
  assert.ok(Math.abs(bladeLevel('working', 1, 2) - bladeLevel('working', 1.1, 2)) > 0.1, 'and moves fast');
  assert.equal(haloLevel('off', 3), 0);
  assert.ok(haloLevel('working', 0) > haloLevel('idle', 0));
});

test('power sequence: ON lights rows bottom to top; OFF darkens top to bottom', () => {
  const onAt = (row: number) => Array.from({ length: 100 }, (_, i) => i * 0.02).find((e) => seqProgress('on', e, row) > 0)!;
  const offAt = (row: number) => Array.from({ length: 100 }, (_, i) => i * 0.02).find((e) => seqProgress('off', e, row) > 0)!;
  for (let r = 1; r < BLADE_ROWS; r++) {
    assert.ok(onAt(r) > onAt(r - 1), `ON: row ${r} after row ${r - 1}`);
    assert.ok(offAt(r) < offAt(r - 1), `OFF: row ${r} before row ${r - 1}`);
  }
  assert.equal(seqProgress('on', 0, 0), 0);
  assert.equal(seqProgress('on', BLADE_ROWS * SEQ_STEP + 0.2, BLADE_ROWS - 1), 1);
});

test('one accent per model, swept bottom to top after a dial change', () => {
  const roles = OKKIN_MODELS.map((m) => m.role);
  assert.equal(new Set(roles.map((r) => MODEL_ACCENT[r])).size, 5);
  const peak = (e: number) => Array.from({ length: BLADE_ROWS }, (_, r) => sweepBand(e, r)).indexOf(Math.max(...Array.from({ length: BLADE_ROWS }, (_, r) => sweepBand(e, r))));
  assert.ok(peak(0.9) > peak(0.3));
  assert.equal(sweepBand(5, 3), 0);
});

test('hologram: real numbers only; — when none; MOCK when mock', () => {
  assert.deepEqual(hologramLines(null), { top: '—', bottom: '—', mock: false });
  assert.deepEqual(hologramLines({ tps: null, model: null, mock: false }), { top: '—', bottom: '—', mock: false });
  assert.deepEqual(hologramLines({ tps: 41, model: 'okkin:latest', mock: true }), { top: '41 tok/s', bottom: 'okkin:latest', mock: true });
});

test('the scene: ONE monolith (glass front, deep blades, four fans, a light spine, cable runs), instanced blades, halo and floor glow local to the loft; paints the sequence in order', async () => {
  const { buildHero } = await import('../src/client/features/okkin-loft/hero.js');
  const h = buildHero();
  const towers: unknown[] = [];
  h.group.traverse((o) => { if (o.name === 'okkin-tower') towers.push(o); });
  assert.equal(towers.length, 1, 'one monolith');
  assert.equal(h.blades.count, 3 * BLADE_ROWS, 'one InstancedMesh for every blade');
  const named = (n: string) => { const out: THREE.Object3D[] = []; h.group.traverse((o) => { if (o.name === n) out.push(o); }); return out; };
  assert.equal(named('okkin-fan').length, 4, 'a bank of four fans');
  assert.equal(named('okkin-light-spine').length, 1);
  assert.ok(named('okkin-cable').length >= 3, 'cable runs');
  const bladeGeo = (h.blades.geometry as THREE.BoxGeometry).parameters;
  assert.ok(bladeGeo.width >= 0.25, 'blades have depth behind the glass');
  for (const n of ['okkin-halo', 'okkin-floor-reflection', 'okkin-hologram']) assert.ok(h.group.getObjectByName(n), n);
  h.setState({ power: 'on', busy: false, holo: null });
  h.tick(0.3);
  const lv = h.levels();
  const rows = h.rowOf();
  const avg = (r: number) => lv.filter((_, i) => rows[i] === r).reduce((a, b) => a + b, 0) / 3;
  assert.ok(avg(0) > avg(BLADE_ROWS - 1), 'mid-ON: bottom rows lit before top');
  h.tick(2);
  h.setState({ power: 'off', busy: false, holo: null });
  h.tick(0.3);
  const lv2 = h.levels();
  const avg2 = (r: number) => lv2.filter((_, i) => rows[i] === r).reduce((a, b) => a + b, 0) / 3;
  assert.ok(avg2(BLADE_ROWS - 1) < avg2(0), 'mid-OFF: top rows dark before bottom');
  h.tick(3);
  assert.ok(h.levels().every((l) => l === OFF_LEVEL));
  // Far away: no hologram or fans.
  h.setNear(false);
  assert.equal(h.group.getObjectByName('okkin-hologram')!.visible, false);
});
