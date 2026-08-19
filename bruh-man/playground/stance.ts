import { SPEED, STANCE_HEIGHT } from './constants.js';
import type { Stance } from './types.js';

/**
 * Resolves the movement stance from the crouch/prone keys currently held.
 * Prone takes priority over crouch when both are held.
 */
export function resolveStance(crouchHeld: boolean, proneHeld: boolean): Stance {
  if (proneHeld) return 'prone';
  if (crouchHeld) return 'crouch';
  return 'stand';
}

/**
 * The top speed (m/s) available for a given stance.
 *
 * @param stance current movement stance.
 * @param sprinting whether sprint is currently active (only relevant while standing).
 */
export function maxSpeedForStance(stance: Stance, sprinting: boolean): number {
  if (stance === 'prone') return SPEED.prone;
  if (stance === 'crouch') return SPEED.crouch;
  return sprinting ? SPEED.sprint : SPEED.walk;
}

/** Target eye-height (feet to camera) for a given stance. */
export function heightForStance(stance: Stance): number {
  return STANCE_HEIGHT[stance];
}
