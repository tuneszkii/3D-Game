import { resolveStance, maxSpeedForStance } from './stance.js';
import { SPEED } from './constants.js';

describe('resolveStance', () => {
  it('prioritizes prone over crouch when both keys are held', () => {
    expect(resolveStance(true, true)).toBe('prone');
  });

  it('falls back to stand when nothing is held', () => {
    expect(resolveStance(false, false)).toBe('stand');
  });
});

describe('maxSpeedForStance', () => {
  it('grants the sprint speed only while standing and sprinting', () => {
    expect(maxSpeedForStance('stand', true)).toBe(SPEED.sprint);
    expect(maxSpeedForStance('stand', false)).toBe(SPEED.walk);
  });

  it('ignores the sprint flag while crouched or prone', () => {
    expect(maxSpeedForStance('crouch', true)).toBe(SPEED.crouch);
    expect(maxSpeedForStance('prone', true)).toBe(SPEED.prone);
  });
});
