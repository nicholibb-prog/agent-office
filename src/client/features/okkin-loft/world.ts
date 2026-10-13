import * as THREE from 'three';
import { mesh, roundedBox, textPlane, toon } from '../../world/toon';
import type { Collider, Interactable } from '../../world/types';
import type { Fixture } from '../../world/office/fixture';
import { OKKIN_CONSOLE, OKKIN_LOFT, OKKIN_MODELS } from '../../../shared/okkin-loft';

export type LoftState = {
  power: 'on' | 'off';
  busy: boolean;
  /** Whether the power switch works (real config passed). False: it shows 'NOT SET UP', never a fake state. */
  switchWorks?: boolean;
  switchLabel?: string;
  /** The status light: on green, off grey, setup amber, error red (can't reach Okkin). */
  light?: 'on' | 'off' | 'setup' | 'error';
  dial?: { role: string; status: 'installed' | 'not installed' | 'unknown' }[];
  dialIndex?: number;
};

export const LIGHT = { on: '#34c759', off: '#8e8e93', setup: '#ff9f0a', error: '#ff3b30' } as const;

/** The dial in the room turns through this sweep, like the panel's (270°). */
const SWEEP = (270 * Math.PI) / 180;
export const dialTurn = (i: number, n: number) => (n <= 1 ? 0 : -SWEEP / 2 + (SWEEP * i) / (n - 1));

export interface OkkinLoftView {
  /** The power switch and the dial: E or a click uses them. */
  interactables: Interactable[];
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
  plate.position.set(rackX - L.rackDepth / 2 - 0.02, L.rackHeight + 0.4, cz);
  plate.rotation.y = -Math.PI / 2;
  group.add(plate);

  // The console: a pedestal in front of the racks with the POWER switch (left) and the MODEL dial (right), facing -x.
  const C = OKKIN_CONSOLE;
  const consoleG = new THREE.Group();
  consoleG.name = 'okkin-console';
  consoleG.position.set(C.x, 0, C.z);
  consoleG.rotation.y = -Math.PI / 2; // its front (+z local) faces -x, toward the floor
  consoleG.add(mesh(roundedBox(C.width, C.height - 0.08, C.depth, 0.04), toon('#c9ccd1'), 0, (C.height - 0.08) / 2, 0));
  const top = mesh(roundedBox(C.width + 0.06, 0.08, C.depth + 0.1, 0.03), toon('#f2f3f5'), 0, C.height - 0.04, 0.02);
  top.rotation.x = 0.35;
  consoleG.add(top);
  const face = new THREE.Group();
  face.position.set(0, C.height + 0.005, 0.02);
  face.rotation.x = 0.35 - Math.PI / 2;
  consoleG.add(face);
  const label = (text: string, x: number, y: number, scale = 0.26) => {
    const t = textPlane(text);
    t.scale.setScalar(scale);
    t.position.set(x, y, 0.012);
    face.add(t);
    return t;
  };
  // Power switch: a rocker in a housing, with a status lamp.
  const power = new THREE.Group();
  power.name = 'okkin-power-switch';
  power.position.set(-C.width / 4, 0, 0);
  power.add(mesh(new THREE.BoxGeometry(0.16, 0.2, 0.03), toon('#1d1d1f'), 0, 0, 0.015, false));
  const lever = mesh(new THREE.BoxGeometry(0.1, 0.07, 0.05), toon('#f5f5f7'), 0, 0, 0.045, false);
  lever.name = 'okkin-power-lever';
  power.add(lever);
  const lampMat = new THREE.MeshBasicMaterial({ color: '#8e8e93' });
  const lamp = new THREE.Mesh(new THREE.CircleGeometry(0.03, 20), lampMat);
  lamp.name = 'okkin-status-light';
  lamp.position.set(0.14, 0.06, 0.032);
  power.add(lamp);
  face.add(power);
  label('POWER', -C.width / 4, 0.16);
  // Model dial: a knob with a pointer, and one tick per model round it.
  const dial = new THREE.Group();
  dial.name = 'okkin-model-dial';
  dial.position.set(C.width / 4, -0.01, 0);
  dial.add(mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.01, 32), toon('#e9eaee'), 0, 0, 0.005, false).rotateX(Math.PI / 2));
  const knob = new THREE.Group();
  knob.add(mesh(new THREE.CylinderGeometry(0.06, 0.065, 0.04, 24), toon('#c3c6cc'), 0, 0, 0.03, false).rotateX(Math.PI / 2));
  knob.add(mesh(new THREE.BoxGeometry(0.012, 0.05, 0.012), new THREE.MeshBasicMaterial({ color: '#0071e3' }), 0, 0.03, 0.052, false));
  knob.name = 'okkin-dial-knob';
  dial.add(knob);
  const ticks: { mat: THREE.MeshBasicMaterial; label: THREE.Object3D }[] = [];
  const roles = OKKIN_MODELS.map((m) => m.role);
  roles.forEach((role, i) => {
    const a = dialTurn(i, roles.length);
    const mat = new THREE.MeshBasicMaterial({ color: '#6e6e73' });
    const tick = new THREE.Mesh(new THREE.CircleGeometry(0.012, 10), mat);
    tick.position.set(Math.sin(a) * 0.09, Math.cos(a) * 0.09, 0.012);
    dial.add(tick);
    const t = textPlane(role.toUpperCase());
    t.scale.setScalar(0.13);
    t.position.set(Math.sin(a) * 0.17, Math.cos(a) * 0.17, 0.012);
    t.name = `okkin-dial-stop-${role}`;
    dial.add(t);
    ticks.push({ mat, label: t });
  });
  face.add(dial);
  group.add(consoleG);

  let state: LoftState = { power: 'off', busy: false };
  let t = 0;
  const paint = () => {
    const on = state.power === 'on';
    // The switch: up when Okkin is really on. Not set up: amber lamp and the plate says so.
    const works = !!state.switchWorks;
    lever.rotation.x = on ? -0.45 : 0.45;
    const light = state.light ?? (!works ? 'setup' : on ? 'on' : 'off');
    lampMat.color.set(LIGHT[light]);
    lamp.userData.light = light;
    const n = state.dial?.length || roles.length;
    knob.rotation.z = -dialTurn(Math.min(state.dialIndex ?? 1, n - 1), n);
    ticks.forEach((t, i) => {
      const st = state.dial?.[i]?.status ?? 'unknown';
      t.mat.color.set(i === (state.dialIndex ?? 1) ? '#0071e3' : st === 'installed' ? '#34c759' : '#a1a1a6');
    });
    glowMat.opacity = on ? 0.35 : 0;
    leds.forEach((m, i) => {
      if (!on) return m.color.set('#1f2a1f');
      // Idle: a slow, regular breathe. Busy (real in-flight request only): quick, scattered.
      const lit = state.busy ? Math.sin(t * 9 + i * 1.7) > 0.2 : Math.sin(t * 1.2 + (i % 3)) > 0.6;
      m.color.set(lit ? (state.busy ? '#ffb340' : '#34c759') : '#1f3a24');
    });
  };
  paint();
  const colliders: Collider[] = [
    { minX: L.maxX - L.rackDepth - 0.1, maxX: L.maxX, minZ: L.minZ, maxZ: L.maxZ, top: L.rackHeight + 0.04 },
    { minX: C.x - C.depth / 2, maxX: C.x + C.depth / 2, minZ: C.z - C.width / 2, maxZ: C.z + C.width / 2, top: C.height },
  ];
  // E or a click on the switch or the dial: see installOkkinLoft (index.ts) for what they do.
  const interactables: Interactable[] = [
    { kind: 'okkinswitch', x: C.x - C.depth / 2, z: C.z, radius: 1.6 },
    { kind: 'okkindial', x: C.x - C.depth / 2, z: C.z + 0.25, radius: 1.6 },
  ];
  power.userData.interact = interactables[0];
  dial.userData.interact = interactables[1];
  const view: OkkinLoftView & { tick(dt: number): void } = {
    group,
    colliders,
    interactables,
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
  return { group: built.group, colliders: built.colliders, interactables: built.interactables, handle: { okkinLoft: built }, update: (_t, dt) => built.tick(dt) };
};
