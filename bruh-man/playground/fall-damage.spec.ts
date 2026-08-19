import { computeFallDamage } from './fall-damage.js';
import { SAFE_FALL_SPEED, LETHAL_FALL_SPEED } from './constants.js';

describe('computeFallDamage', () => {
  it('deals no damage at or below the safe fall speed', () => {
    expect(computeFallDamage(SAFE_FALL_SPEED)).toBe(0);
    expect(computeFallDamage(SAFE_FALL_SPEED - 3)).toBe(0);
  });

  it('deals full (lethal) damage at or above the lethal fall speed', () => {
    expect(computeFallDamage(LETHAL_FALL_SPEED)).toBe(100);
    expect(computeFallDamage(LETHAL_FALL_SPEED + 10)).toBe(100);
  });

  it('scales damage linearly between the safe and lethal thresholds', () => {
    const mid = (SAFE_FALL_SPEED + LETHAL_FALL_SPEED) / 2;
    const damage = computeFallDamage(mid);
    expect(damage).toBeGreaterThan(30);
    expect(damage).toBeLessThan(70);
  });
});
