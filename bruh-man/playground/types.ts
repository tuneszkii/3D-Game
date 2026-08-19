/** The player's current movement stance. */
export type Stance = 'stand' | 'crouch' | 'prone';

/** Raw held-key state the controller reacts to every frame. */
export type InputState = {
  forward: boolean;
  back: boolean;
  left: boolean;
  right: boolean;
  jump: boolean;
  sprint: boolean;
  crouch: boolean;
};

/**
 * A read-only snapshot of the player's movement state, safe to pass to
 * React for HUD and debug rendering.
 */
export type PlayerSnapshot = {
  position: { x: number; y: number; z: number };
  velocity: { x: number; y: number; z: number };
  /** Horizontal speed magnitude, in meters/second. */
  speed: number;
  stance: Stance;
  sliding: boolean;
  climbing: boolean;
  grounded: boolean;
  sprinting: boolean;
  /** Current health, 0-100. */
  health: number;
  /** Whether the debug overlay is currently toggled on. */
  debug: boolean;
};
