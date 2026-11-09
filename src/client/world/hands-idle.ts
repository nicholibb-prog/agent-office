// First-person arms tuck away after a while with no input (AUD-7b).
/** Seconds without input before your first-person arms tuck away (AUD-7b). */
export const ARMS_IDLE_AFTER = 8;
/** How far (0 shown .. 1 tucked) the arms are, easing toward `idle`; with reduced motion it snaps. */
export function armsHideStep(k: number, idle: boolean, dt: number, reduceMotion: boolean): number {
  const target = idle ? 1 : 0;
  if (reduceMotion) return target;
  return k + (target - k) * Math.min(1, dt * (idle ? 2 : 10));
}

