/**
 * Kavi's face: the NPC's screen shows a still picture of Kavi, in a rounded frame and nothing else:
 * no caption, no name tag, no status strip. Her name only appears as the fallback card while the
 * picture loads. It never claims to be live.
 */

/** The picture, from the client's static assets (src/client/public), cropped to the screen's frame. */
export const FACE_SRC = '/kavi-face.jpg';
export const FACE_NAME = 'Kavi';
/** The screen's canvas (px), the same shape as the screen mesh (0.72 × 0.55 m). */
export const FACE_PX = { w: 512, h: 392 } as const;

const FONT = 'Nunito, ui-rounded, system-ui, sans-serif';
/** The rounded frame the picture sits in, inside the screen's bezel (px). Matches the asset, 488 × 368. */
const FRAME = { x: 12, y: 12, w: 488, h: 368, r: 26 } as const;

/** What paintFace draws with: the bits of a 2D canvas context it uses (a test hands it a recorder). */
export type FacePen = Pick<
  CanvasRenderingContext2D,
  'fillStyle' | 'strokeStyle' | 'lineWidth' | 'font' | 'textAlign' | 'textBaseline' | 'save' | 'restore' | 'beginPath' | 'roundRect' | 'fill' | 'stroke' | 'clip' | 'fillRect' | 'drawImage' | 'fillText' | 'measureText'
>;

/**
 * Paints the screen: the picture filling the rounded frame (a plain name card until it has
 * loaded), and nothing over it. Only when something changes (the
 * picture arriving), never per frame.
 */
export function paintFace(g: FacePen, picture: CanvasImageSource | null) {
  const { w, h } = FACE_PX;
  const f = FRAME;
  g.fillStyle = '#141625';
  g.fillRect(0, 0, w, h);

  g.save();
  g.beginPath();
  g.roundRect(f.x, f.y, f.w, f.h, f.r);
  g.clip();
  if (picture) {
    g.drawImage(picture, f.x, f.y, f.w, f.h);
  } else {
    g.fillStyle = '#118ab2';
    g.fillRect(f.x, f.y, f.w, f.h);
    g.fillStyle = '#edf2f4';
    g.font = `800 64px ${FONT}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(FACE_NAME, w / 2, f.y + f.h / 2);
  }

  g.restore();

  // A slim light edge round the frame.
  g.strokeStyle = 'rgba(255, 255, 255, 0.35)';
  g.lineWidth = 3;
  g.beginPath();
  g.roundRect(f.x, f.y, f.w, f.h, f.r);
  g.stroke();
}
