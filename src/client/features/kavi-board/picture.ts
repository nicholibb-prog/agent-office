/**
 * Kavi's face: the NPC's screen shows a still picture of Kavi, framed like a video-call view (a
 * rounded inner frame and a name tag in the corner). It is a picture, not a call, and says so on
 * the screen in plain words. Nothing on it pretends otherwise.
 */

/** The picture, from the client's static assets (src/client/public), cropped to the screen's frame. */
export const FACE_SRC = '/kavi-face.jpg';
export const FACE_NAME = 'Kavi';
/** What the screen says along its bottom edge, always, over the picture. */
export const FACE_CAPTION = 'Picture · not a live call';
/** The screen's canvas (px), the same shape as the screen mesh (0.72 × 0.55 m). */
export const FACE_PX = { w: 512, h: 392 } as const;

const FONT = 'Nunito, ui-rounded, system-ui, sans-serif';
/** The rounded frame the picture sits in, inside the screen's bezel (px). Matches the asset, 488 × 368. */
const FRAME = { x: 12, y: 12, w: 488, h: 368, r: 26 } as const;
const CAPTION_TALL = 50;

/** What paintFace draws with: the bits of a 2D canvas context it uses (a test hands it a recorder). */
export type FacePen = Pick<
  CanvasRenderingContext2D,
  'fillStyle' | 'strokeStyle' | 'lineWidth' | 'font' | 'textAlign' | 'textBaseline' | 'save' | 'restore' | 'beginPath' | 'roundRect' | 'fill' | 'stroke' | 'clip' | 'fillRect' | 'drawImage' | 'fillText' | 'measureText'
>;

/**
 * Paints the screen: the picture filling the rounded frame (a plain card until it has loaded), the
 * name tag in the top corner, and the caption along the bottom. Only when something changes (the
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
    g.fillText(FACE_NAME, w / 2, f.y + (f.h - CAPTION_TALL) / 2);
  }

  // The caption, along the bottom of the frame.
  g.fillStyle = 'rgba(10, 12, 24, 0.74)';
  g.fillRect(f.x, f.y + f.h - CAPTION_TALL, f.w, CAPTION_TALL);
  g.fillStyle = '#ffffff';
  g.font = `800 26px ${FONT}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(FACE_CAPTION, w / 2, f.y + f.h - CAPTION_TALL / 2);

  // The name tag, in the top corner.
  g.font = `800 24px ${FONT}`;
  const tag = g.measureText(FACE_NAME).width + 24;
  g.fillStyle = 'rgba(0, 0, 0, 0.5)';
  g.beginPath();
  g.roundRect(f.x + 12, f.y + 12, tag, 38, 19);
  g.fill();
  g.fillStyle = '#ffffff';
  g.textAlign = 'left';
  g.fillText(FACE_NAME, f.x + 24, f.y + 31);
  g.restore();

  // A slim light edge round the frame.
  g.strokeStyle = 'rgba(255, 255, 255, 0.35)';
  g.lineWidth = 3;
  g.beginPath();
  g.roundRect(f.x, f.y, f.w, f.h, f.r);
  g.stroke();
}
