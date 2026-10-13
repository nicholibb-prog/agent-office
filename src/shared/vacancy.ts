/**
 * The free-seat marker: a small green "+" just above the desk edge, never a tall shape that blocks
 * the view across the floor. Its label ("Free seat") shows only when you're within LABEL_NEAR.
 */
export const VACANCY = {
  /** Nothing of the marker (bob included) goes higher than this above the floor, in meters. */
  maxTop: 1.0,
  /** The "+" arm length. */
  size: 0.14,
  /** The stem from the "+" down to the desk top. */
  stem: 0.08,
  /** How far it bobs up and down. */
  bob: 0.02,
  /** The label shows within this distance (meters, on the floor plane). */
  labelNear: 2.5,
  /** The label's height above the "+" centre, and its scale. */
  labelUp: 0.16,
  labelScale: 0.22,
} as const;

/** Where a marker centred at `y` reaches at most, bob included (the label is not counted: it only shows up close). */
export function vacancyTop(y: number): number {
  return y + VACANCY.size / 2 + VACANCY.bob;
}

/** The highest centre a marker may sit at. */
export const VACANCY_MAX_Y = VACANCY.maxTop - VACANCY.size / 2 - VACANCY.bob;

/** A marker's centre for a surface at `surface` meters, capped so it stays under maxTop. */
export function vacancyY(surface: number): number {
  return Math.min(surface + VACANCY.stem + VACANCY.size / 2, VACANCY_MAX_Y);
}

/** Show the label only for someone close by. */
export function vacancyLabelShown(dx: number, dz: number): boolean {
  return Math.hypot(dx, dz) <= VACANCY.labelNear;
}
