// The loft's dressing: the stone pedestal with its Paleo-Hebrew engraving, the OKKIN sign in classical
// capitals, and the 日光 hanging scroll. Procedural geometry and canvas text only. The three fonts are
// small local subsets (fonts/, each with its OFL licence); nothing is fetched from a CDN.
import * as THREE from 'three';
import cinzelUrl from './fonts/cinzel-okkin.ttf?url';
import yujiUrl from './fonts/yuji-syuku-nikko.ttf?url';
import phoenicianUrl from './fonts/noto-sans-phoenician.ttf?url';
import { OKKIN_PEDESTAL, OKKIN_SCROLL, OKKIN_SIGN } from '../../../shared/okkin-loft';
import { VICTORY_OF_THE_PEOPLE, toPaleoHebrew } from '../../../shared/paleo-hebrew';

/** One palette for the loft: marble and stone, gold leaf, deep blue. */
export const LOFT_PALETTE = { marble: '#ece8e1', marbleVein: '#c9c3b8', stone: '#b9b2a6', stoneDark: '#8f887c', gold: '#c9a227', goldLight: '#f3d77a', blue: '#14284b', lacquer: '#16110e' } as const;

export const LOFT_FONTS = [
  { family: 'OKL Cinzel', url: cinzelUrl, name: 'Cinzel (subset: O K I N), weight 700', licence: 'SIL OFL 1.1' },
  { family: 'OKL Yuji Syuku', url: yujiUrl, name: 'Yuji Syuku (subset: 日光)', licence: 'SIL OFL 1.1' },
  { family: 'OKL Phoenician', url: phoenicianUrl, name: 'Noto Sans Phoenician (subset: U+10900–1091F)', licence: 'SIL OFL 1.1' },
] as const;

const repaints: (() => void)[] = [];
let fontsAsked = false;
/** Loads the bundled fonts once and repaints every texture that uses them. Without FontFace (tests), it doesn't. */
function askFonts() {
  if (fontsAsked || typeof FontFace === 'undefined' || typeof document === 'undefined' || !('fonts' in document)) return;
  fontsAsked = true;
  void Promise.all(LOFT_FONTS.map((f) => new FontFace(f.family, `url(${f.url})`).load().then((ff) => (document as Document).fonts.add(ff)).catch(() => undefined))).then(() => repaints.forEach((r) => r()));
}

function canvasTex(w: number, h: number, paint: (c: CanvasRenderingContext2D, w: number, h: number) => void) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const draw = () => {
    const c = canvas.getContext('2d');
    if (!c) return;
    c.clearRect(0, 0, w, h);
    paint(c, w, h);
    tex.needsUpdate = true;
  };
  draw();
  repaints.push(draw);
  askFonts();
  return tex;
}

/** Marble: a soft base with a few fine veins (seeded, so it's the same every load). */
function marble(c: CanvasRenderingContext2D, w: number, h: number, base: string = LOFT_PALETTE.marble) {
  c.fillStyle = base;
  c.fillRect(0, 0, w, h);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  c.strokeStyle = LOFT_PALETTE.marbleVein;
  for (let i = 0; i < 9; i++) {
    c.globalAlpha = 0.25 + rnd() * 0.3;
    c.lineWidth = 0.6 + rnd() * 1.4;
    c.beginPath();
    let x = rnd() * w, y = 0;
    c.moveTo(x, y);
    while (y < h) { x += (rnd() - 0.5) * 40; y += 12 + rnd() * 20; c.lineTo(x, y); }
    c.stroke();
  }
  c.globalAlpha = 1;
}

/** Gold leaf: a vertical gradient fill, with a thin dark edge so it reads against marble. */
function goldText(c: CanvasRenderingContext2D, text: string, x: number, y: number, size: number) {
  const g = c.createLinearGradient(0, y - size * 0.7, 0, y + size * 0.3);
  g.addColorStop(0, LOFT_PALETTE.goldLight);
  g.addColorStop(0.55, LOFT_PALETTE.gold);
  g.addColorStop(1, '#8a6a12');
  c.lineWidth = Math.max(1, size / 40);
  c.strokeStyle = 'rgba(70,50,10,.6)';
  c.strokeText(text, x, y);
  c.fillStyle = g;
  c.fillText(text, x, y);
}

/** A soft additive glow (one small radial canvas), or null where there's no canvas gradient (tests). */
function glowSprite(color: string): THREE.Sprite | null {
  if (typeof document === 'undefined') return null;
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const c = cv.getContext('2d');
  if (!c || typeof c.createRadialGradient !== 'function') return null;
  const gr = c.createRadialGradient(64, 64, 4, 64, 64, 64);
  if (!gr || typeof gr.addColorStop !== 'function') return null;
  gr.addColorStop(0, 'rgba(255,255,255,.9)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = gr;
  c.fillRect(0, 0, 128, 128);
  return new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), color, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
}

/** The OKKIN sign: gold-leaf classical capitals on a marble tablet with a Greek-key (meander) border. */
export function buildSign(): THREE.Mesh {
  const W = 1300, H = 350;
  const tex = canvasTex(W, H, (c, w, h) => {
    marble(c, w, h);
    // Greek key band along the top and bottom, in gold.
    c.strokeStyle = LOFT_PALETTE.gold;
    c.lineWidth = 5;
    const key = (y: number) => {
      const s = 26;
      c.beginPath();
      for (let x = 24; x < w - 24 - s; x += s * 1.5) {
        c.moveTo(x, y + s); c.lineTo(x, y); c.lineTo(x + s, y); c.lineTo(x + s, y + s * 0.66); c.lineTo(x + s * 0.33, y + s * 0.66); c.lineTo(x + s * 0.33, y + s * 0.33);
      }
      c.stroke();
    };
    key(18);
    key(h - 18 - 26);
    c.font = `700 170px "OKL Cinzel", Cinzel, "Times New Roman", serif`;
    c.textAlign = 'center';
    c.textBaseline = 'alphabetic';
    // Wide, even letter spacing like a stoichedon inscription.
    const letters = 'OKKIN'.split('');
    const step = 210;
    letters.forEach((l, i) => goldText(c, l, w / 2 + (i - (letters.length - 1) / 2) * step, h / 2 + 62, 170));
  });
  const m = new THREE.Mesh(new THREE.BoxGeometry(OKKIN_SIGN.width, OKKIN_SIGN.height, 0.08), [
    new THREE.MeshLambertMaterial({ color: LOFT_PALETTE.marble }),
    new THREE.MeshLambertMaterial({ color: LOFT_PALETTE.marble }),
    new THREE.MeshLambertMaterial({ color: LOFT_PALETTE.marble }),
    new THREE.MeshLambertMaterial({ color: LOFT_PALETTE.marble }),
    new THREE.MeshBasicMaterial({ map: tex }),
    new THREE.MeshLambertMaterial({ color: LOFT_PALETTE.marble }),
  ]);
  m.name = 'okkin-sign';
  // A temple lintel: a gold frame round the tablet and a warm glow behind it (additive, local).
  const frame = new THREE.MeshBasicMaterial({ color: LOFT_PALETTE.gold });
  for (const [w, h, x, y] of [[OKKIN_SIGN.width + 0.16, 0.08, 0, OKKIN_SIGN.height / 2 + 0.04], [OKKIN_SIGN.width + 0.16, 0.08, 0, -OKKIN_SIGN.height / 2 - 0.04], [0.08, OKKIN_SIGN.height, -OKKIN_SIGN.width / 2 - 0.04, 0], [0.08, OKKIN_SIGN.height, OKKIN_SIGN.width / 2 + 0.04, 0]] as const) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.1), frame);
    bar.position.set(x, y, 0);
    m.add(bar);
  }
  const cornice = new THREE.Mesh(new THREE.BoxGeometry(OKKIN_SIGN.width + 0.4, 0.12, 0.22), new THREE.MeshLambertMaterial({ color: LOFT_PALETTE.marble }));
  cornice.position.set(0, OKKIN_SIGN.height / 2 + 0.14, 0.04);
  m.add(cornice);
  const glow = glowSprite(LOFT_PALETTE.goldLight);
  if (glow) {
    glow.name = 'okkin-sign-glow';
    glow.scale.set(OKKIN_SIGN.width * 1.6, OKKIN_SIGN.height * 2.6, 1);
    glow.position.set(0, 0, -0.12);
    m.add(glow);
  }
  return m;
}

/** The 日光 kakejiku: dark lacquer panel, gold brush kanji top to bottom, brocade borders, a roller at each end. */
export function buildScroll(): THREE.Group {
  const S = OKKIN_SCROLL;
  const g = new THREE.Group();
  g.name = 'okkin-scroll';
  const tex = canvasTex(256, 820, (c, w, h) => {
    // Brocade mounting (deep blue with a fine gold thread), then the lacquer panel.
    c.fillStyle = LOFT_PALETTE.blue;
    c.fillRect(0, 0, w, h);
    c.strokeStyle = 'rgba(201,162,39,.35)';
    c.lineWidth = 1;
    for (let y = 6; y < h; y += 12) { c.beginPath(); c.moveTo(0, y); c.lineTo(w, y + 6); c.stroke(); }
    const px = 26, py = 110;
    c.fillStyle = LOFT_PALETTE.lacquer;
    c.fillRect(px, py, w - px * 2, h - py * 1.6);
    c.strokeStyle = LOFT_PALETTE.gold;
    c.lineWidth = 3;
    c.strokeRect(px + 6, py + 6, w - px * 2 - 12, h - py * 1.6 - 12);
    c.font = `150px "OKL Yuji Syuku", "Yuji Syuku", serif`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    goldText(c, '日', w / 2, py + 170, 150);
    goldText(c, '光', w / 2, py + 380, 150);
    // A small red seal (hanko) bottom left of the text, plain square: no characters invented.
    c.fillStyle = '#a3262a';
    c.fillRect(w / 2 + 18, py + 500, 34, 34);
  });
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(S.width, S.height), new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }));
  panel.position.y = S.bottom + S.height / 2;
  g.add(panel);
  const roller = (y: number) => {
    const r = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, S.width + 0.08, 12), new THREE.MeshLambertMaterial({ color: '#7a4a24' }));
    r.name = 'okkin-scroll-roller';
    r.rotation.z = Math.PI / 2;
    r.position.y = y;
    g.add(r);
    for (const sx of [-1, 1]) {
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.025, 10, 8), new THREE.MeshLambertMaterial({ color: LOFT_PALETTE.gold }));
      cap.position.set(sx * (S.width / 2 + 0.05), y, 0);
      g.add(cap);
    }
  };
  roller(S.bottom);
  roller(S.bottom + S.height);
  // Silk tassels (deep blue, gold knot) hanging from both ends of the bottom roller.
  for (const sx of [-1, 1]) {
    const t = new THREE.Group();
    t.name = 'okkin-scroll-tassel';
    t.position.set(sx * (S.width / 2 + 0.05), S.bottom - 0.03, 0.01);
    const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.12, 6), new THREE.MeshLambertMaterial({ color: LOFT_PALETTE.gold }));
    cord.position.y = -0.06;
    t.add(cord);
    const knot = new THREE.Mesh(new THREE.SphereGeometry(0.018, 10, 8), new THREE.MeshLambertMaterial({ color: LOFT_PALETTE.gold }));
    knot.position.y = -0.13;
    t.add(knot);
    const silk = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.16, 12, 1, true), new THREE.MeshLambertMaterial({ color: LOFT_PALETTE.blue, side: THREE.DoubleSide }));
    silk.position.y = -0.22;
    t.add(silk);
    g.add(t);
  }
  // Its stand: a slim gold-capped stone post, the cord to the top roller.
  const post = new THREE.Mesh(new THREE.BoxGeometry(0.06, S.bottom + S.height + 0.25, 0.06), new THREE.MeshLambertMaterial({ color: LOFT_PALETTE.stoneDark }));
  post.position.set(0, (S.bottom + S.height + 0.25) / 2, -0.06);
  g.add(post);
  const arm = new THREE.Mesh(new THREE.BoxGeometry(S.width + 0.2, 0.03, 0.04), new THREE.MeshLambertMaterial({ color: LOFT_PALETTE.gold }));
  arm.position.set(0, S.bottom + S.height + 0.2, -0.03);
  g.add(arm);
  const foot = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.05, 0.3), new THREE.MeshLambertMaterial({ color: LOFT_PALETTE.stone }));
  foot.position.set(0, 0.025, -0.06);
  g.add(foot);
  return g;
}

/** The pedestal: a stone plinth with a marble top and a gold fillet, the inscription cut into its front. */
export function buildPedestal(): { group: THREE.Group; inscription: string } {
  const P = OKKIN_PEDESTAL;
  const g = new THREE.Group();
  g.name = 'okkin-pedestal';
  const w = P.maxX - P.minX, d = P.maxZ - P.minZ;
  const inscription = toPaleoHebrew(VICTORY_OF_THE_PEOPLE.hebrew);
  const stoneTex = canvasTex(1024, 180, (c, cw, ch) => {
    marble(c, cw, ch, LOFT_PALETTE.stone);
    // Chiselled: each letter cut as a dark V-groove with a lit lower lip, right to left.
    c.font = `96px "OKL Phoenician", "Noto Sans Phoenician", serif`;
    c.direction = 'rtl';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillStyle = 'rgba(255,255,255,.55)';
    c.fillText(inscription, cw * 0.21 + 2, ch / 2 + 3);
    c.fillStyle = 'rgba(40,34,26,.85)';
    c.fillText(inscription, cw * 0.21, ch / 2);
    c.fillStyle = 'rgba(201,162,39,.35)';
    c.fillText(inscription, cw * 0.21 - 1, ch / 2 - 1);
  });
  stoneTex.wrapS = THREE.ClampToEdgeWrapping;
  const stone = new THREE.MeshLambertMaterial({ color: LOFT_PALETTE.stone });
  const front = new THREE.MeshLambertMaterial({ map: stoneTex });
  // Box faces: +x, -x, +y, -y, +z, -z. The -x face looks at the floor.
  const body = new THREE.Mesh(new THREE.BoxGeometry(w, P.height - 0.05, d), [stone, stone, stone, stone, stone, stone]);
  body.position.set((P.minX + P.maxX) / 2, (P.height - 0.05) / 2, (P.minZ + P.maxZ) / 2);
  g.add(body);
  const face = new THREE.Mesh(new THREE.PlaneGeometry(d, P.height - 0.05), front);
  face.name = 'okkin-engraving';
  face.rotation.y = -Math.PI / 2;
  face.position.set(P.minX - 0.002, (P.height - 0.05) / 2, (P.minZ + P.maxZ) / 2);
  g.add(face);
  const topTex = canvasTex(256, 512, (c, cw, ch) => marble(c, cw, ch));
  const top = new THREE.Mesh(new THREE.BoxGeometry(w + 0.06, 0.05, d + 0.06), new THREE.MeshLambertMaterial({ map: topTex }));
  top.position.set((P.minX + P.maxX) / 2, P.height - 0.025, (P.minZ + P.maxZ) / 2);
  g.add(top);
  // Gold trim bands: one under the marble top, one at the foot.
  const goldMat = new THREE.MeshBasicMaterial({ color: LOFT_PALETTE.gold });
  for (const [y, hgt] of [[P.height - 0.07, 0.04], [0.03, 0.035]] as const) {
    const band = new THREE.Mesh(new THREE.BoxGeometry(w + 0.07, hgt, d + 0.07), goldMat);
    band.name = 'okkin-pedestal-gold';
    band.position.set((P.minX + P.maxX) / 2, y, (P.minZ + P.maxZ) / 2);
    g.add(band);
  }
  return { group: g, inscription };
}
