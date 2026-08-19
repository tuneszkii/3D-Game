/**
 * Eye-height (in meters, from feet to camera) for each movement stance.
 */
export const STANCE_HEIGHT = {
  stand: 1.7,
  crouch: 1.15,
  prone: 0.55,
} as const;

/** Horizontal collision radius of the player capsule, in meters. */
export const PLAYER_RADIUS = 0.35;

/** How quickly the player's height eases towards its stance target (1/seconds). */
export const HEIGHT_EASE_RATE = 10;

/** Ground movement speeds, in meters/second, per stance and mode. */
export const SPEED = {
  walk: 7.5,
  sprint: 11.5,
  crouch: 4.2,
  prone: 2.2,
  slideStart: 13,
  slideMin: 3.5,
} as const;

/** Fraction of normal acceleration control retained while airborne. */
export const AIR_CONTROL = 0.45;

/** Downward acceleration applied every frame, in meters/second^2. */
export const GRAVITY = 24;

/** Upward velocity applied on a normal jump, in meters/second. */
export const JUMP_VELOCITY = 8.2;

/** Radians of camera rotation per pixel of mouse movement. */
export const MOUSE_SENSITIVITY = 0.0022;

/** Maximum camera pitch, just short of straight up/down. */
export const MAX_PITCH = Math.PI / 2 - 0.05;

/** Deceleration applied to slide speed, in meters/second^2. */
export const SLIDE_FRICTION = 9;

/** Hard cap on how long a slide can last, in seconds. */
export const SLIDE_MAX_DURATION = 0.9;

/** Minimum ledge height (meters above the feet) that requires a mantle. */
export const MANTLE_MIN_HEIGHT = 1.55;

/** Maximum ledge height a mantle can climb. */
export const MANTLE_MAX_HEIGHT = 2.7;

/** How long the mantle animation takes, in seconds. */
export const MANTLE_DURATION = 0.28;

/** Impact speed (m/s) at or below which a fall deals no damage. */
export const SAFE_FALL_SPEED = 10;

/** Impact speed (m/s) at or above which a fall deals full (lethal) damage. */
export const LETHAL_FALL_SPEED = 22;

/** Maximum player health. */
export const MAX_HEALTH = 100;

/** Seconds after taking damage before health starts regenerating. */
export const REGEN_DELAY = 4;

/** Health regenerated per second once regen kicks in. */
export const REGEN_RATE = 12;
