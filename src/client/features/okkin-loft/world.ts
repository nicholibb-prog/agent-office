import * as THREE from 'three';
import { mesh, roundedBox, textPlane, toon } from '../../world/toon';
import type { Collider } from '../../world/types';
import type { Fixture } from '../../world/office/fixture';
import { OKKIN_LOFT } from '../../../shared/okkin-loft';

export type LoftState = { power: 'on' | 'off'; busy: boolean };

export interface OkkinLoftView {
  group: THREE.Group;
  colliders: Collider[];
  /** Real state only: off = dark; busy = only while Okkin has a request in flight. */
  setState(s: LoftState): void;
}

export function buildOkkinLoft(): OkkinLoftView {
  const L = OKKIN_LOFT;
  const group = new THREE.Group();
  const cz = (L.minZ + L.maxZ) / 2;
  const len = L.maxZ - L.minZ;
  // Dais: a thin aluminum plinth, just a visual (0.04 high), so walking is unchanged.
  group.add(mesh(roundedBox(L.maxX - L.minX, 0.04, len, 0.02), toon('#d9dde3'), (L.minX + L.maxX) / 2, 0.02, cz, false));
  const rackMat = toon('#2b2f36');
  const glassMat = toon('#9fb4c7', { transparent: true, opacity: 0.35 });
  const rackX = L.maxX - L.rackDepth / 2 - 0.05;
  const leds: THREE.MeshBasicMaterial[] = [];
  const racks = 4;
  const rw = len / racks - 0.08;
  for (let i = 0; i < racks; i++) {
    const z = L.minZ + (i + 0.5) * (len / racks);
    group.add(mesh(roundedBox(L.rackDepth, L.rackHeight, rw, 0.03), rackMat, rackX, L.rackHeight / 2 + 0.04, z));
    group.add(mesh(new THREE.BoxGeometry(0.01, L.rackHeight - 0.2, rw - 0.1), glassMat, rackX - L.rackDepth / 2 - 0.01, L.rackHeight / 2 + 0.04, z, false));
    for (let r = 0; r < 9; r++) {
      const m = new THREE.MeshBasicMaterial({ color: '#2a3b2a' });
      leds.push(m);
      const led = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.03, 0.05), m);
      led.position.set(rackX - L.rackDepth / 2 - 0.02, 0.35 + r * 0.2, z - rw / 3);
      group.add(led);
    }
  }
  // Cooling glow along the floor at the rack fronts.
  const glowMat = new THREE.MeshBasicMaterial({ color: '#66d9ff', transparent: true, opacity: 0.0 });
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(0.5, len - 0.2), glowMat);
  glow.rotation.x = -Math.PI / 2;
  glow.position.set(rackX - L.rackDepth / 2 - 0.25, 0.05, cz);
  group.add(glow);
  // Nameplate above the racks.
  const plate = textPlane('OKKIN');
  plate.position.set(L.maxX - 0.08, L.rackHeight + 0.45, cz);
  plate.rotation.y = -Math.PI / 2;
  group.add(plate);

  let state: LoftState = { power: 'off', busy: false };
  let t = 0;
  const paint = () => {
    const on = state.power === 'on';
    glowMat.opacity = on ? 0.35 : 0;
    leds.forEach((m, i) => {
      if (!on) return m.color.set('#1f2a1f');
      // Idle: a slow, regular breathe. Busy (real in-flight request only): quick, scattered.
      const lit = state.busy ? Math.sin(t * 9 + i * 1.7) > 0.2 : Math.sin(t * 1.2 + (i % 3)) > 0.6;
      m.color.set(lit ? (state.busy ? '#ffb340' : '#34c759') : '#1f3a24');
    });
  };
  paint();
  const colliders: Collider[] = [{ minX: L.maxX - L.rackDepth - 0.1, maxX: L.maxX, minZ: L.minZ, maxZ: L.maxZ, top: L.rackHeight + 0.04 }];
  const view: OkkinLoftView & { tick(dt: number): void } = {
    group,
    colliders,
    setState(s) {
      state = s;
      paint();
    },
    tick(dt) {
      t += dt;
      paint();
    },
  };
  return view;
}

declare module '../../world/types' {
  interface OfficeHandles {
    okkinLoft: OkkinLoftView;
  }
}

export const okkinLoft: Fixture<'okkinLoft'> = () => {
  const built = buildOkkinLoft() as OkkinLoftView & { tick(dt: number): void };
  return { group: built.group, colliders: built.colliders, interactables: [], handle: { okkinLoft: built }, update: (_t, dt) => built.tick(dt) };
};
