import * as THREE from 'three';
import { mesh, roundedBox, textPlane, toon } from '../../world/toon';
import type { Collider, Interactable } from '../../world/types';
import type { Fixture } from '../../world/office/fixture';
import { OKKIN_CONSOLE, OKKIN_LOFT, OKKIN_MODELS, OKKIN_PEDESTAL, OKKIN_SCROLL, OKKIN_SIGN } from '../../../shared/okkin-loft';
import { LOFT_PALETTE, buildPedestal, buildScroll, buildSign } from './regalia';
import { TOWER, buildHero } from './hero';

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
  /** The dial's chosen role, for the blades' accent colour. */
  dialRole?: string;
  /** A model loading or switching (counts as working). */
  loading?: boolean;
  /** The hologram's real data: live tokens/sec and the loaded model; null when there's none. */
  holo?: { tps: number | null; model: string | null; mock: boolean } | null;
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
  /** Close by (within ~16 m, in the office): the halo, hologram and fans run. Far: they don't. */
  setNear(v: boolean): void;
}

export function buildOkkinLoft(): OkkinLoftView {
  const L = OKKIN_LOFT;
  const group = new THREE.Group();
  const cz = (L.minZ + L.maxZ) / 2;
  const len = L.maxZ - L.minZ;
  // Dais: a thin aluminum plinth, just a visual (0.04 high), so walking is unchanged.
  // The stone pedestal everything stands on, with the engraving cut into its front.
  const PH = OKKIN_PEDESTAL.height;
  group.add(buildPedestal().group);
  // The supercomputer: two glass-and-metal towers with lit blades (see hero.ts).
  const hero = buildHero();
  group.add(hero.group);
  const heroFront = L.maxX - TOWER.depth - 0.08;
  // The OKKIN sign above it all, facing the floor; the 日光 scroll on its stand at the north end.
  const sign = buildSign();
  sign.position.set(heroFront, OKKIN_SIGN.y, cz);
  sign.rotation.y = -Math.PI / 2;
  group.add(sign);
  for (const sx of [-1, 1]) {
    const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 6.8 - OKKIN_SIGN.y - OKKIN_SIGN.height / 2, 6), toon('#c9a227'));
    chain.position.set(heroFront, (6.8 + OKKIN_SIGN.y + OKKIN_SIGN.height / 2) / 2, cz + sx * (OKKIN_SIGN.width / 2 - 0.15));
    group.add(chain);
  }
  const scroll = buildScroll();
  scroll.position.set(OKKIN_SCROLL.x, 0, OKKIN_SCROLL.z);
  scroll.rotation.y = -Math.PI / 2;
  group.add(scroll);

  // The console: a pedestal in front of the racks with the POWER switch (left) and the MODEL dial (right), facing -x.
  const C = OKKIN_CONSOLE;
  const consoleG = new THREE.Group();
  consoleG.name = 'okkin-console';
  consoleG.position.set(C.x, 0, C.z);
  consoleG.rotation.y = -Math.PI / 2; // its front (+z local) faces -x, toward the floor
  // Stone and gold, like the plinth: a stone pillar with gold bands, a deep-blue slate top in a gold rim.
  consoleG.add(mesh(roundedBox(C.width, C.height - 0.08, C.depth, 0.04), toon(LOFT_PALETTE.stone), 0, (C.height - 0.08) / 2, 0));
  for (const y of [0.04, C.height - 0.14]) consoleG.add(mesh(new THREE.BoxGeometry(C.width + 0.03, 0.03, C.depth + 0.03), new THREE.MeshBasicMaterial({ color: LOFT_PALETTE.gold }), 0, y, 0, false));
  const top = mesh(roundedBox(C.width + 0.06, 0.08, C.depth + 0.1, 0.03), toon(LOFT_PALETTE.gold), 0, C.height - 0.04, 0.02);
  top.add(mesh(new THREE.BoxGeometry(C.width - 0.02, 0.012, C.depth + 0.02), toon(LOFT_PALETTE.blue), 0, 0.04, 0, false));
  top.rotation.x = 0.35;
  consoleG.add(top);
  const face = new THREE.Group();
  face.position.set(0, C.height + 0.005, 0.02);
  face.rotation.x = 0.35 - Math.PI / 2;
  consoleG.add(face);
  const label = (text: string, x: number, y: number, scale = 0.26) => {
    const t = textPlane(text, { color: LOFT_PALETTE.goldLight });
    t.scale.setScalar(scale);
    t.position.set(x, y, 0.012);
    face.add(t);
    return t;
  };
  // Power switch: a rocker in a housing, with a status lamp.
  const power = new THREE.Group();
  power.name = 'okkin-power-switch';
  power.position.set(-C.width / 4, 0, 0);
  power.add(mesh(new THREE.BoxGeometry(0.16, 0.2, 0.03), toon('#0b1222'), 0, 0, 0.015, false));
  const lever = mesh(new THREE.BoxGeometry(0.1, 0.07, 0.05), toon(LOFT_PALETTE.marble), 0, 0, 0.045, false);
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
  dial.add(mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.01, 32), toon(LOFT_PALETTE.gold), 0, 0, 0.005, false).rotateX(Math.PI / 2));
  const knob = new THREE.Group();
  knob.add(mesh(new THREE.CylinderGeometry(0.06, 0.065, 0.04, 24), toon(LOFT_PALETTE.marble), 0, 0, 0.03, false).rotateX(Math.PI / 2));
  knob.add(mesh(new THREE.BoxGeometry(0.012, 0.05, 0.012), new THREE.MeshBasicMaterial({ color: LOFT_PALETTE.blue }), 0, 0.03, 0.052, false));
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
    const t = textPlane(role.toUpperCase(), { color: LOFT_PALETTE.goldLight });
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
      t.mat.color.set(i === (state.dialIndex ?? 1) ? LOFT_PALETTE.goldLight : st === 'installed' ? LOFT_PALETTE.marble : '#6b7280');
    });
  };
  paint();
  const colliders: Collider[] = [
    { minX: OKKIN_PEDESTAL.minX, maxX: OKKIN_PEDESTAL.maxX, minZ: OKKIN_PEDESTAL.minZ, maxZ: OKKIN_PEDESTAL.maxZ, top: OKKIN_PEDESTAL.height },
    { minX: heroFront, maxX: L.maxX - 0.08, minZ: L.minZ + 0.1, maxZ: L.maxZ - 0.1, top: OKKIN_PEDESTAL.height + TOWER.height },
    { minX: OKKIN_SCROLL.x - 0.25, maxX: OKKIN_SCROLL.x + 0.25, minZ: OKKIN_SCROLL.z - OKKIN_SCROLL.width / 2, maxZ: OKKIN_SCROLL.z + OKKIN_SCROLL.width / 2, top: OKKIN_SCROLL.bottom + OKKIN_SCROLL.height + 0.25 },
    { minX: C.x - C.depth / 2, maxX: C.x + C.depth / 2, minZ: C.z - C.width / 2, maxZ: C.z + C.width / 2, top: C.height },
  ];
  // E or a click on the switch or the dial: see installOkkinLoft (index.ts) for what they do.
  const interactables: Interactable[] = [
    { kind: 'okkinswitch', x: C.x - C.depth / 2, z: C.z, radius: 1.6 },
    { kind: 'okkindial', x: C.x - C.depth / 2, z: C.z + 0.25, radius: 1.6 },
  ];
  power.userData.interact = interactables[0];
  dial.userData.interact = interactables[1];
  const view: OkkinLoftView & { tick(dt: number): void; hero: typeof hero } = {
    hero,
    group,
    colliders,
    interactables,
    setState(s) {
      state = s;
      paint();
      const role = s.dial ? OKKIN_MODELS[s.dialIndex ?? 1]?.role : undefined;
      hero.setState({ power: s.power, busy: s.busy, loading: s.loading, role: s.dialRole ?? role, holo: s.holo ?? null });
    },
    setNear(v) {
      hero.setNear(v);
    },
    tick(dt) {
      t += dt;
      hero.tick(dt);
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
