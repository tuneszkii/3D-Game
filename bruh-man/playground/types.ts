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
  prone: boolean;
};

/**
 * A read-only snapshot of the player's movement state, safe to pass to
 * React for HUD and debug rendering.
 */
export type PlayerSnapshot = {
  position: { x: number; y: number; z: number };
  velocity: { x: number; y: number; z: number };
  speed: number;
  stance: Stance;
  sliding: boolean;
  climbing: boolean;
  grounded: boolean;
  sprinting: boolean;
  canMantle: boolean;
  health: number;
  debug: boolean;
};
