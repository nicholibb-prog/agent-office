// Okkin's supercomputer: one tall glass-and-black-metal monolith on the stone pedestal, compute and GPU
// blades behind smoked glass (one InstancedMesh), fans on top, a halo and a floor glow (a sprite and
// additive planes local to the loft: no post-processing pass), and a thin hologram showing live
// tokens/sec and the loaded model. Lit only from real state (see hero-light.ts).
import * as THREE from 'three';
import { OKKIN_LOFT, OKKIN_PEDESTAL } from '../../../shared/okkin-loft';
import { BLADE_ROWS, OFF_LEVEL, accentFor, bladeLevel, haloLevel, heroMode, hologramLines, seqDuration, seqProgress, sweepBand, type HeroMode } from './hero-light';
import { LOFT_PALETTE } from './regalia';

export type HeroState = {
  power: 'on' | 'off';
  busy: boolean;
  loading?: boolean;
  /** The dial's role now (its accent colour). */
  role?: string;
  holo: { tps: number | null; model: string | null; mock: boolean } | null;
};

/** ONE monolith: glass front, blades with depth, a fan bank, a light spine, cable runs. */
export const TOWER = { depth: 0.8, width: 2.1, height: 2.6 } as const;
const COLS = 3;
/** The front, along z: blades on the left part, the fan bank at the right end. */
const FAN_BANK = 0.42;

function glowTexture(): THREE.Texture | null {
  if (typeof document === 'undefined') return null;
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const c = cv.getContext('2d');
  if (!c || typeof c.createRadialGradient !== 'function') return null;
  const gr = c.createRadialGradient(64, 64, 4, 64, 64, 64);
  if (!gr || typeof gr.addColorStop !== 'function') return null;
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = gr;
  c.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(cv);
}

export function buildHero() {
  const L = OKKIN_LOFT;
  const PH = OKKIN_PEDESTAL.height;
  const g = new THREE.Group();
  g.name = 'okkin-hero';
  const cz = (L.minZ + L.maxZ) / 2;
  const tx = L.maxX - TOWER.depth / 2 - 0.08;
  const front = tx - TOWER.depth / 2;
  const towersZ = [cz];
  const metal = new THREE.MeshLambertMaterial({ color: '#15171c' });
  const gold = new THREE.MeshLambertMaterial({ color: LOFT_PALETTE.gold });
  const inner = new THREE.MeshBasicMaterial({ color: '#05070d' });
  const goldLit = new THREE.MeshBasicMaterial({ color: '#4a3a10' });
  const glass = new THREE.MeshBasicMaterial({ color: '#0c1830', transparent: true, opacity: 0.3, depthWrite: false });
  const fans: THREE.Object3D[] = [];
  const fanMat = new THREE.MeshLambertMaterial({ color: '#7d8796' });
  const spineMat = new THREE.MeshBasicMaterial({ color: '#0d1830' });
  const cableMat = new THREE.MeshLambertMaterial({ color: '#0b0d12' });
  const cableBlue = new THREE.MeshLambertMaterial({ color: LOFT_PALETTE.blue });
  const box = (w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number) => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    b.position.set(x, y, z);
    return b;
  };
  for (const z of towersZ) {
    const t = new THREE.Group();
    t.name = 'okkin-tower';
    t.position.set(tx, PH, z);
    // The dark core sits back from the glass, so the blades (and fans) have a lit bay in front of it.
    t.add(box(TOWER.depth - 0.44, TOWER.height - 0.08, TOWER.width - 0.06, inner, 0.2, TOWER.height / 2, 0));
    // Bay walls: black metal top and bottom of the blade bay, and a back plate.
    t.add(box(0.4, 0.04, TOWER.width - 0.06, metal, -TOWER.depth / 2 + 0.2, 0.17, 0));
    for (const [dx, dz] of [[-1, -1], [-1, 1], [1, -1], [1, 1]] as const) t.add(box(0.06, TOWER.height, 0.06, metal, (dx * (TOWER.depth - 0.06)) / 2, TOWER.height / 2, (dz * (TOWER.width - 0.06)) / 2));
    t.add(box(TOWER.depth, 0.08, TOWER.width, metal, 0, TOWER.height - 0.04, 0));
    t.add(box(TOWER.depth + 0.02, 0.1, TOWER.width + 0.02, metal, 0, 0.05, 0));
    t.add(box(TOWER.depth + 0.03, 0.025, TOWER.width + 0.03, gold, 0, TOWER.height - 0.1, 0));
    // A gold light strip down each front edge and across the crown: lit with the blades.
    for (const dz of [-1, 1]) {
      const s = box(0.02, TOWER.height - 0.2, 0.025, goldLit, -TOWER.depth / 2 - 0.01, TOWER.height / 2, (dz * (TOWER.width - 0.06)) / 2);
      s.name = 'okkin-gold-strip';
      t.add(s);
    }
    t.add(box(0.02, 0.025, TOWER.width - 0.06, goldLit, -TOWER.depth / 2 - 0.01, TOWER.height - 0.14, 0));
    const pane = new THREE.Mesh(new THREE.PlaneGeometry(TOWER.width - 0.08, TOWER.height - 0.2), glass);
    pane.rotation.y = -Math.PI / 2;
    pane.position.set(-TOWER.depth / 2 - 0.004, TOWER.height / 2, 0);
    pane.renderOrder = 2;
    t.add(pane);
    // The fan bank: four fans behind the glass at the right end, spinning only when on.
    const fanZ = TOWER.width / 2 - FAN_BANK / 2 - 0.05;
    t.add(box(0.04, TOWER.height - 0.3, FAN_BANK, metal, -TOWER.depth / 2 + 0.08, TOWER.height / 2, fanZ));
    for (let k = 0; k < 4; k++) {
      const fan = new THREE.Group();
      fan.position.set(-TOWER.depth / 2 + 0.05, 0.45 + k * ((TOWER.height - 0.8) / 3), fanZ);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.018, 8, 28), gold);
      ring.rotation.y = Math.PI / 2;
      fan.add(ring);
      const rotor = new THREE.Group();
      rotor.name = 'okkin-fan';
      for (let j = 0; j < 7; j++) {
        const arm = new THREE.Group();
        arm.rotation.x = (j / 7) * Math.PI * 2;
        const blade = box(0.01, 0.14, 0.045, fanMat, 0, 0.08, 0);
        blade.rotation.y = 0.5;
        arm.add(blade);
        rotor.add(arm);
      }
      rotor.add(box(0.02, 0.05, 0.05, metal, 0, 0, 0));
      fan.add(rotor);
      fans.push(rotor);
      t.add(fan);
    }
    // The light spine: a vertical bar between blades and fans, animated with the state.
    const spine = box(0.03, TOWER.height - 0.3, 0.05, spineMat, -TOWER.depth / 2 - 0.006, TOWER.height / 2, fanZ - FAN_BANK / 2 - 0.05);
    spine.name = 'okkin-light-spine';
    t.add(spine);
    // Cable runs: down the back corners into the plinth, and across the crown.
    for (const dz of [-1, 1]) {
      const c = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, TOWER.height + 0.1, 8), cableMat);
      c.name = 'okkin-cable';
      c.position.set(TOWER.depth / 2 + 0.04, TOWER.height / 2 - 0.05, (dz * (TOWER.width - 0.3)) / 2);
      t.add(c);
      const c2 = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, TOWER.height, 8), cableBlue);
      c2.name = 'okkin-cable';
      c2.position.set(TOWER.depth / 2 + 0.04, TOWER.height / 2, (dz * (TOWER.width - 0.45)) / 2);
      t.add(c2);
    }
    const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, TOWER.width - 0.3, 8), cableMat);
    crown.name = 'okkin-cable';
    crown.rotation.x = Math.PI / 2;
    crown.position.set(TOWER.depth / 2 + 0.04, TOWER.height + 0.03, 0);
    t.add(crown);
    g.add(t);
  }
  // Blades: one InstancedMesh for both towers. Row 0 is the bottom.
  const bladeH = (TOWER.height - 0.36) / BLADE_ROWS;
  const span = TOWER.width - FAN_BANK - 0.3;
  const spanZ0 = -TOWER.width / 2 + 0.1;
  const blades = new THREE.InstancedMesh(new THREE.BoxGeometry(0.32, bladeH * 0.62, span / COLS - 0.05), new THREE.MeshBasicMaterial({ color: '#ffffff' }), towersZ.length * COLS * BLADE_ROWS);
  blades.name = 'okkin-blades';
  const rowOf: number[] = [];
  const m4 = new THREE.Matrix4();
  let n = 0;
  for (const z of towersZ) for (let c = 0; c < COLS; c++) for (let r = 0; r < BLADE_ROWS; r++) {
    m4.makeTranslation(front + 0.2, PH + 0.2 + (r + 0.5) * bladeH, z + spanZ0 + (c + 0.5) * (span / COLS));
    blades.setMatrixAt(n, m4);
    blades.setColorAt(n, new THREE.Color('#0a1022'));
    rowOf.push(r);
    n++;
  }
  g.add(blades);
  // Halo and floor glow: additive, local.
  const glowTex = glowTexture();
  const haloMat = new THREE.SpriteMaterial({ map: glowTex, color: '#3b6fe0', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
  const halo = new THREE.Sprite(haloMat);
  halo.name = 'okkin-halo';
  halo.scale.set(4.2, 3.6, 1);
  halo.position.set(front - 0.25, PH + TOWER.height * 0.55, cz);
  g.add(halo);
  const floorMat = new THREE.MeshBasicMaterial({ map: glowTex, color: '#3b6fe0', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
  const floorGlow = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 3.6), floorMat);
  floorGlow.name = 'okkin-floor-reflection';
  floorGlow.rotation.x = -Math.PI / 2;
  floorGlow.position.set(OKKIN_PEDESTAL.minX - 0.55, 0.012, cz);
  g.add(floorGlow);
  const topGlow = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 3.0), floorMat);
  topGlow.rotation.x = -Math.PI / 2;
  topGlow.position.set(front - 0.2, PH + 0.006, cz);
  g.add(topGlow);
  // Hologram: a thin column of light above the towers, with a text card (live data only).
  const holo = new THREE.Group();
  holo.name = 'okkin-hologram';
  holo.position.set(tx, PH + TOWER.height, cz);
  const beamMat = new THREE.MeshBasicMaterial({ color: '#3b6fe0', transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.12, 0.9, 16, 1, true), beamMat);
  beam.position.y = 0.45;
  holo.add(beam);
  let cardCanvas: HTMLCanvasElement | null = null;
  let cardTex: THREE.CanvasTexture | null = null;
  if (typeof document !== 'undefined') {
    cardCanvas = document.createElement('canvas');
    cardCanvas.width = 512;
    cardCanvas.height = 200;
    cardTex = new THREE.CanvasTexture(cardCanvas);
    cardTex.colorSpace = THREE.SRGBColorSpace;
  }
  const cardMesh = new THREE.Mesh(new THREE.PlaneGeometry(1.15, 0.45), new THREE.MeshBasicMaterial({ map: cardTex, transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
  cardMesh.name = 'okkin-hologram-card';
  cardMesh.rotation.y = -Math.PI / 2;
  cardMesh.position.set(-0.05, 0.62, 0);
  holo.add(cardMesh);
  g.add(holo);
  let cardKey = '';
  const drawCard = (lines: { top: string; bottom: string; mock: boolean }) => {
    const key = JSON.stringify(lines);
    if (key === cardKey) return;
    cardKey = key;
    holo.userData.lines = lines;
    const c = cardCanvas?.getContext('2d');
    if (!c || typeof c.fillText !== 'function') return;
    c.clearRect(0, 0, 512, 200);
    // A smoked-glass backing so the readout reads against a bright room.
    c.fillStyle = 'rgba(8,16,38,.82)';
    c.beginPath();
    if (typeof c.roundRect === 'function') c.roundRect(6, 6, 500, 188, 22); else c.rect(6, 6, 500, 188);
    c.fill();
    c.strokeStyle = 'rgba(201,162,39,.9)';
    c.lineWidth = 3;
    c.stroke();
    c.fillStyle = LOFT_PALETTE.goldLight;
    c.textAlign = 'center';
    c.font = '700 74px -apple-system, "SF Pro Display", "Helvetica Neue", Arial, sans-serif';
    c.fillText(lines.top, 256, 92);
    c.font = '500 34px -apple-system, "SF Pro Text", "Helvetica Neue", Arial, sans-serif';
    c.fillText(lines.bottom.length > 26 ? `${lines.bottom.slice(0, 25)}…` : lines.bottom, 256, 150);
    if (lines.mock) {
      c.fillStyle = LOFT_PALETTE.gold;
      c.fillRect(196, 162, 120, 34);
      c.fillStyle = '#1d1d1f';
      c.font = '800 24px -apple-system, Arial, sans-serif';
      c.fillText('MOCK', 256, 188);
    }
    if (cardTex) cardTex.needsUpdate = true;
  };

  let st: HeroState = { power: 'off', busy: false, holo: null };
  let mode: HeroMode = 'off';
  let t = 0;
  let seq: { kind: 'on' | 'off'; at: number } | null = null;
  let sweep: number | null = null;
  let near = true;
  let acc = 0;
  const base = new THREE.Color(LOFT_PALETTE.blue);
  const lit = new THREE.Color('#5d8cff');
  const tmp = new THREE.Color();
  const accent = new THREE.Color();
  const goldHot = new THREE.Color(LOFT_PALETTE.goldLight);
  const spineHot = new THREE.Color('#fff3c4');
  const levels: number[] = new Array(rowOf.length).fill(OFF_LEVEL);
  const paint = () => {
    accent.set(accentFor(st.role));
    const inSeq = seq && t - seq.at < seqDuration() ? seq : null;
    for (let i = 0; i < rowOf.length; i++) {
      const r = rowOf[i]!;
      let level = bladeLevel(mode, t, r);
      // ON: rows light bottom to top. OFF: rows go dark top to bottom.
      if (inSeq) {
        const p = seqProgress(inSeq.kind, t - inSeq.at, r);
        level = inSeq.kind === 'on' ? OFF_LEVEL + (level - OFF_LEVEL) * p : OFF_LEVEL + (0.45 - OFF_LEVEL) * (1 - p);
      }
      levels[i] = level;
      tmp.copy(base).lerp(lit, level).multiplyScalar(0.25 + level * 1.1);
      if (sweep !== null) tmp.lerp(accent, sweepBand(t - sweep, r));
      else if (mode !== 'off') tmp.lerp(accent, 0.12 * level);
      blades.setColorAt(i, tmp);
    }
    if (blades.instanceColor) blades.instanceColor.needsUpdate = true;
    const hl = haloLevel(mode, t);
    haloMat.color.copy(accent).lerp(lit, 0.5);
    haloMat.opacity = near ? hl * 0.5 : 0;
    floorMat.color.copy(haloMat.color);
    floorMat.opacity = near ? hl * 0.4 : 0;
    beamMat.opacity = mode === 'off' ? 0.05 : 0.12 + 0.05 * Math.sin(t * 3);
    // The gold strips follow the tower: dark off, glowing gold with the breathe or ripple.
    // The spine: deep blue when off, then gold-white with the breathe or the ripple.
    spineMat.color.set('#0d1830').lerp(spineHot, mode === 'off' ? 0 : Math.min(1, 0.3 + hl * 1.2));
    goldLit.color.set('#3a2c0c').lerp(goldHot, mode === 'off' ? 0 : Math.min(1, 0.35 + hl));
  };
  const view = {
    group: g,
    blades,
    /** Row levels as last painted (for tests). */
    levels: () => levels.slice(),
    rowOf: () => rowOf.slice(),
    mode: () => mode,
    setState(s: HeroState) {
      const was = mode;
      const wasRole = st.role;
      st = s;
      mode = heroMode(s);
      if ((was === 'off') !== (mode === 'off')) seq = { kind: mode === 'off' ? 'off' : 'on', at: t };
      if (s.role && wasRole && s.role !== wasRole && mode !== 'off') sweep = t;
      drawCard(hologramLines(s.holo));
      paint();
    },
    /** Far away: no halo, hologram or fans, and the blades repaint only a few times a second. */
    setNear(v: boolean) {
      if (v === near) return;
      near = v;
      holo.visible = v;
    },
    tick(dt: number) {
      t += dt;
      if (sweep !== null && t - sweep > 1.3) sweep = null;
      if (near && mode !== 'off') for (const f of fans) f.rotation.x += dt * (mode === 'working' ? 18 : 7);
      acc += dt;
      if (!near && acc < 0.25) return;
      acc = 0;
      paint();
    },
  };
  drawCard(hologramLines(null));
  paint();
  return view;
}
