import { SAFE_FALL_SPEED, LETHAL_FALL_SPEED } from './constants.js';

/**
 * Computes fall damage from a vertical impact speed. Damage ramps linearly
 * from 0 at {@link SAFE_FALL_SPEED} up to 100 (lethal) at
 * {@link LETHAL_FALL_SPEED}, and clamps outside that range.
 *
 * @param impactSpeed absolute vertical speed, in meters/second, at the moment of landing.
 * @returns damage points between 0 and 100.
 */
export function computeFallDamage(impactSpeed: number): number {
  if (impactSpeed <= SAFE_FALL_SPEED) return 0;
  const ratio = (impactSpeed - SAFE_FALL_SPEED) / (LETHAL_FALL_SPEED - SAFE_FALL_SPEED);
  return Math.round(Math.min(1, ratio) * 100);
}
