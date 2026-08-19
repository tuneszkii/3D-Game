import * as THREE from 'three';
import type { Collider } from './world.js';

const PLAYER_HEIGHT = 1.7;
const PLAYER_RADIUS = 0.35;

const CROUCH_HEIGHT = 1.15;
const PRONE_HEIGHT = 0.55;

const MOVE_SPEED = 7.5;
const SPRINT_SPEED = 10.0;
const TACTICAL_SPRINT_SPEED = 12.5;
const SLIDE_START_SPEED = 13.5;

const AIR_CONTROL = 0.45;

const GRAVITY = 24;
const JUMP_VELOCITY = 8.2;

const MOUSE_SENSITIVITY = 0.0022;
const MAX_PITCH = Math.PI / 2 - 0.05;

// Tactical sprint.
const SPRINT_DOUBLE_TAP_WINDOW = 0.25;
const TACTICAL_SPRINT_DURATION = 1.15;

// Slide.
const SLIDE_DURATION = 0.8;
const SLIDE_FRICTION = 7.0;

// Crouch/prone transition.
const STANCE_TRANSITION_SPEED = 14;

// Mantle/climb.
const CLIMB_DISTANCE = 1.35;
const CLIMB_MIN_HEIGHT = 0.45;
const CLIMB_MAX_HEIGHT = 1.8;
const CLIMB_DURATION = 0.28;

// Small tolerance used when checking whether the player can stand.
const COLLISION_EPSILON = 0.001;

/** Keys the controller reacts to. */
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

/** High-level movement state. */
export type MovementState =
  | 'walking'
  | 'sprinting'
  | 'tactical-sprinting'
  | 'crouching'
  | 'sliding'
  | 'prone'
  | 'climbing';

/**
 * First-person player controller.
 *
 * Movement:
 *   WASD              - movement
 *   Shift             - sprint
 *   Shift, Shift      - tactical sprint
 *   C                 - crouch
 *   Sprint + C        - slide
 *   Slide + C         - slide cancel
 *   Slide + Space     - slide cancel + jump
 *   X                 - prone
 *   Space             - jump
 *   Space near wall   - mantle/climb
 *
 * Crouch and prone are press-based actions rather than held actions.
 */
export class PlayerController {
  private readonly velocity = new THREE.Vector3();

  private readonly position = new THREE.Vector3(
    0,
    PLAYER_HEIGHT,
    22
  );

  private yaw = 0;
  private pitch = 0;

  private onGround = false;

  private movementState: MovementState = 'walking';

  private currentHeight = PLAYER_HEIGHT;
  private targetHeight = PLAYER_HEIGHT;

  private slideTimer = 0;

  private tacticalSprintTimer = 0;

  private lastSprintPressTime = -Infinity;

  private climbTimer = 0;
  private climbStartY = 0;
  private climbTargetY = 0;

  /**
   * Prevents a held Space key from repeatedly triggering jumps.
   */
  private jumpPressed = false;

  private readonly input: InputState = {
    forward: false,
    back: false,
    left: false,
    right: false,
    jump: false,

    sprint: false,
    crouch: false,
    prone: false,
  };

  private readonly playerBox = new THREE.Box3();

  private readonly up = new THREE.Vector3(0, 1, 0);

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly colliders: Collider[]
  ) {
    this.syncCamera();
  }

  /** Whether the player is currently standing on ground or a surface. */
  get grounded(): boolean {
    return this.onGround;
  }

  /** Current world position of the player's eye/feet origin. */
  get worldPosition(): THREE.Vector3 {
    return this.position;
  }

  /** Current movement state. */
  get state(): MovementState {
    return this.movementState;
  }

  /** Whether the player is currently sliding. */
  get sliding(): boolean {
    return this.movementState === 'sliding';
  }

  /** Whether the player is currently prone. */
  get prone(): boolean {
    return this.movementState === 'prone';
  }

  /** Whether the player is currently tactically sprinting. */
  get tacticalSprinting(): boolean {
    return this.movementState === 'tactical-sprinting';
  }

  /** Current player collision height. */
  get height(): number {
    return this.currentHeight;
  }

  /**
   * Handles a keydown/keyup event.
   *
   * This intentionally remains compatible with the original controller API.
   */
  handleKey(code: string, pressed: boolean): void {
    switch (code) {
      case 'KeyW':
      case 'ArrowUp':
        this.input.forward = pressed;
        break;

      case 'KeyS':
      case 'ArrowDown':
        this.input.back = pressed;
        break;

      case 'KeyA':
      case 'ArrowLeft':
        this.input.left = pressed;
        break;

      case 'KeyD':
      case 'ArrowRight':
        this.input.right = pressed;
        break;

      case 'ShiftLeft':
      case 'ShiftRight':
        if (pressed && !this.input.sprint) {
          this.handleSprintPress();
        }

        this.input.sprint = pressed;
        break;

      case 'Space':
        if (pressed && !this.input.jump) {
          this.jumpPressed = true;
        }

        this.input.jump = pressed;
        break;

      case 'KeyC':
        if (pressed && !this.input.crouch) {
          this.handleCrouchPress();
        }

        this.input.crouch = pressed;
        break;

      case 'KeyX':
        if (pressed && !this.input.prone) {
          this.handlePronePress();
        }

        this.input.prone = pressed;
        break;

      default:
        break;
    }
  }

  /** Applies relative mouse movement to the camera orientation. */
  handleLook(movementX: number, movementY: number): void {
    this.yaw -= movementX * MOUSE_SENSITIVITY;
    this.pitch -= movementY * MOUSE_SENSITIVITY;

    this.pitch = Math.max(
      -MAX_PITCH,
      Math.min(MAX_PITCH, this.pitch)
    );
  }

  /** Clears all held keys — used when pointer lock is released. */
  releaseKeys(): void {
    this.input.forward = false;
    this.input.back = false;
    this.input.left = false;
    this.input.right = false;

    this.input.jump = false;
    this.input.sprint = false;
    this.input.crouch = false;
    this.input.prone = false;

    this.jumpPressed = false;
  }

  /**
   * Advances the simulation.
   *
   * @param delta seconds elapsed since the previous frame.
   */
  update(delta: number): void {
    const step = Math.min(delta, 0.05);

    if (this.movementState === 'climbing') {
      this.updateClimb(step);
      this.syncCamera();
      return;
    }

    this.updateTimers(step);
    this.updateStance(step);

    const wish = this.getWishDirection();

    const hasMovementInput = wish.lengthSq() > 0;

    this.updateMovementState(hasMovementInput);

    const speed = this.getMovementSpeed();

    const targetX = wish.x * speed;
    const targetZ = wish.z * speed;

    const control =
      this.onGround
        ? 1
        : AIR_CONTROL;

    const blend =
      1 - Math.exp(-18 * control * step);

    if (this.movementState === 'sliding') {
      this.updateSlideMovement(step);
    } else {
      this.velocity.x +=
        (targetX - this.velocity.x) * blend;

      this.velocity.z +=
        (targetZ - this.velocity.z) * blend;
    }

    this.handleJump();

    this.velocity.y -= GRAVITY * step;

    this.onGround = false;

    this.moveAxis(
      'y',
      this.velocity.y * step
    );

    this.moveAxis(
      'x',
      this.velocity.x * step
    );

    this.moveAxis(
      'z',
      this.velocity.z * step
    );

    this.resolveGround();

    this.syncCamera();
  }

  /**
   * Handles the sprint double-tap mechanic.
   */
  private handleSprintPress(): void {
    const now = performance.now() / 1000;

    const timeSincePreviousPress =
      now - this.lastSprintPressTime;

    if (
      timeSincePreviousPress <=
      SPRINT_DOUBLE_TAP_WINDOW
    ) {
      if (
        this.onGround &&
        this.hasForwardMovement()
      ) {
        this.startTacticalSprint();
      }
    }

    this.lastSprintPressTime = now;
  }

  /**
   * C is an action rather than a held crouch state.
   */
  private handleCrouchPress(): void {
    if (this.movementState === 'sliding') {
      this.cancelSlide(false);
      return;
    }

    if (
      this.movementState === 'tactical-sprinting' ||
      this.movementState === 'sprinting'
    ) {
      this.startSlide();
      return;
    }

    if (this.movementState === 'prone') {
      this.exitProne();
      return;
    }

    if (this.movementState === 'crouching') {
      this.standUp();
      return;
    }

    if (this.onGround) {
      this.startCrouch();
    }
  }

  /**
   * X immediately puts the player into prone.
   */
  private handlePronePress(): void {
    if (!this.onGround) {
      return;
    }

    if (this.movementState === 'prone') {
      this.exitProne();
      return;
    }

    if (this.movementState === 'sliding') {
      this.cancelSlide(false);
    }

    this.tacticalSprintTimer = 0;

    this.movementState = 'prone';
    this.targetHeight = PRONE_HEIGHT;

    // Going prone should kill most vertical movement but preserve
    // horizontal momentum.
    this.velocity.y = 0;
  }

  private startCrouch(): void {
    this.tacticalSprintTimer = 0;

    this.movementState = 'crouching';
    this.targetHeight = CROUCH_HEIGHT;
  }

  private standUp(): void {
    if (!this.canOccupyHeight(PLAYER_HEIGHT)) {
      return;
    }

    this.movementState = 'walking';
    this.targetHeight = PLAYER_HEIGHT;
  }

  private exitProne(): void {
    if (!this.canOccupyHeight(PLAYER_HEIGHT)) {
      // If there isn't enough room to stand, at least move to crouch.
      if (this.canOccupyHeight(CROUCH_HEIGHT)) {
        this.movementState = 'crouching';
        this.targetHeight = CROUCH_HEIGHT;
      }

      return;
    }

    this.movementState = 'walking';
    this.targetHeight = PLAYER_HEIGHT;
  }

  /**
   * Starts a slide from sprint/tactical sprint.
   */
  private startSlide(): void {
    if (!this.onGround) {
      return;
    }

    if (
      this.movementState !== 'sprinting' &&
      this.movementState !== 'tactical-sprinting'
    ) {
      return;
    }

    this.movementState = 'sliding';

    this.slideTimer = SLIDE_DURATION;

    this.targetHeight = CROUCH_HEIGHT;

    const horizontalSpeed = Math.hypot(
      this.velocity.x,
      this.velocity.z
    );

    const wish = this.getWishDirection();

    let direction = new THREE.Vector3(
      this.velocity.x,
      0,
      this.velocity.z
    );

    if (direction.lengthSq() < 0.001) {
      direction.copy(wish);
    }

    if (direction.lengthSq() < 0.001) {
      direction.set(0, 0, -1);
      direction.applyAxisAngle(
        this.up,
        this.yaw
      );
    }

    direction.normalize();

    const slideSpeed = Math.max(
      SLIDE_START_SPEED,
      horizontalSpeed
    );

    this.velocity.x =
      direction.x * slideSpeed;

    this.velocity.z =
      direction.z * slideSpeed;

    this.tacticalSprintTimer = 0;
  }

  /**
   * Cancels a slide immediately.
   *
   * If jumpAfterCancel is true, the jump is performed on the same
   * simulation frame.
   */
  private cancelSlide(
    jumpAfterCancel: boolean
  ): void {
    if (this.movementState !== 'sliding') {
      return;
    }

    this.slideTimer = 0;

    const speed = Math.hypot(
      this.velocity.x,
      this.velocity.z
    );

    // Preserve slide momentum, but don't let the player keep
    // an absurdly high speed forever.
    const preservedSpeed = Math.min(
      speed,
      SPRINT_SPEED
    );

    const direction = new THREE.Vector3(
      this.velocity.x,
      0,
      this.velocity.z
    );

    if (direction.lengthSq() > 0.001) {
      direction.normalize();

      this.velocity.x =
        direction.x * preservedSpeed;

      this.velocity.z =
        direction.z * preservedSpeed;
    }

    this.movementState = 'walking';
    this.targetHeight = PLAYER_HEIGHT;

    if (
      this.input.sprint &&
      this.hasForwardMovement() &&
      this.onGround
    ) {
      this.movementState = 'sprinting';
    }

    if (jumpAfterCancel) {
      this.performJump();
    }
  }

  /**
   * Space is context-sensitive:
   *
   *   Slide + Space → slide cancel + jump
   *   Near mantle    → climb
   *   Ground         → jump
   */
  private handleJump(): void {
    if (!this.jumpPressed) {
      return;
    }

    this.jumpPressed = false;

    if (this.movementState === 'sliding') {
      this.cancelSlide(true);
      return;
    }

    if (!this.onGround) {
      return;
    }

    if (this.tryStartClimb()) {
      return;
    }

    this.performJump();
  }

  private performJump(): void {
    if (!this.onGround) {
      return;
    }

    this.velocity.y = JUMP_VELOCITY;

    this.onGround = false;

    if (
      this.movementState === 'crouching' ||
      this.movementState === 'prone'
    ) {
      this.movementState = 'walking';
      this.targetHeight = PLAYER_HEIGHT;
    }
  }

  /**
   * Determines whether the player is currently sprinting.
   */
  private updateMovementState(
    hasMovementInput: boolean
  ): void {
    if (
      this.movementState === 'sliding' ||
      this.movementState === 'prone'
    ) {
      return;
    }

    if (!this.onGround) {
      return;
    }

    if (
      this.movementState === 'crouching'
    ) {
      if (
        this.input.sprint &&
        this.hasForwardMovement()
      ) {
        this.movementState = 'sprinting';
        this.targetHeight = PLAYER_HEIGHT;
      }

      return;
    }

    if (!hasMovementInput) {
      if (
        this.movementState === 'sprinting' ||
        this.movementState === 'tactical-sprinting'
      ) {
        this.movementState = 'walking';
      }

      return;
    }

    if (
      this.tacticalSprintTimer > 0 &&
      this.input.sprint &&
      this.hasForwardMovement()
    ) {
      this.movementState =
        'tactical-sprinting';

      this.targetHeight = PLAYER_HEIGHT;

      return;
    }

    if (
      this.input.sprint &&
      this.hasForwardMovement()
    ) {
      this.movementState = 'sprinting';
      this.targetHeight = PLAYER_HEIGHT;

      return;
    }

    if (
      this.movementState === 'sprinting' ||
      this.movementState === 'tactical-sprinting'
    ) {
      this.movementState = 'walking';
    }
  }

  private startTacticalSprint(): void {
    if (!this.onGround) {
      return;
    }

    if (!this.input.sprint) {
      return;
    }

    if (!this.hasForwardMovement()) {
      return;
    }

    this.tacticalSprintTimer =
      TACTICAL_SPRINT_DURATION;

    this.movementState =
      'tactical-sprinting';

    this.targetHeight = PLAYER_HEIGHT;
  }

  private updateTimers(step: number): void {
    if (this.tacticalSprintTimer > 0) {
      this.tacticalSprintTimer =
        Math.max(
          0,
          this.tacticalSprintTimer - step
        );

      if (
        this.tacticalSprintTimer === 0 &&
        this.movementState ===
          'tactical-sprinting'
      ) {
        this.movementState =
          this.input.sprint
            ? 'sprinting'
            : 'walking';
      }
    }

    if (this.slideTimer > 0) {
      this.slideTimer =
        Math.max(
          0,
          this.slideTimer - step
        );

      if (
        this.slideTimer === 0 &&
        this.movementState === 'sliding'
      ) {
        this.cancelSlide(false);
      }
    }

    if (
      this.climbTimer > 0
    ) {
      this.climbTimer =
        Math.max(
          0,
          this.climbTimer - step
        );
    }
  }

  private updateSlideMovement(
    step: number
  ): void {
    const horizontalSpeed = Math.hypot(
      this.velocity.x,
      this.velocity.z
    );

    if (horizontalSpeed <= 0.01) {
      return;
    }

    const newSpeed = Math.max(
      0,
      horizontalSpeed -
        SLIDE_FRICTION * step
    );

    const scale =
      newSpeed / horizontalSpeed;

    this.velocity.x *= scale;
    this.velocity.z *= scale;
  }

  /**
   * Smoothly changes the collision height.
   *
   * The player's feet remain planted while the head lowers/raises.
   */
  private updateStance(
    step: number
  ): void {
    const difference =
      this.targetHeight -
      this.currentHeight;

    const maxChange =
      STANCE_TRANSITION_SPEED *
      step;

    const change = THREE.MathUtils.clamp(
      difference,
      -maxChange,
      maxChange
    );

    this.currentHeight += change;

    // Keep the player's feet planted.
    this.position.y += change;

    this.updateBox();
  }

  private getWishDirection(): THREE.Vector3 {
    const wish = new THREE.Vector3(
      Number(this.input.right) -
        Number(this.input.left),

      0,

      Number(this.input.back) -
        Number(this.input.forward)
    );

    if (wish.lengthSq() > 0) {
      wish.normalize();

      wish.applyAxisAngle(
        this.up,
        this.yaw
      );
    }

    return wish;
  }

  private hasForwardMovement(): boolean {
    return (
      this.input.forward &&
      !this.input.back
    );
  }

  private getMovementSpeed(): number {
    switch (this.movementState) {
      case 'tactical-sprinting':
        return TACTICAL_SPRINT_SPEED;

      case 'sprinting':
        return SPRINT_SPEED;

      case 'crouching':
        return MOVE_SPEED * 0.55;

      case 'prone':
        return MOVE_SPEED * 0.25;

      case 'sliding':
        return SLIDE_START_SPEED;

      default:
        return MOVE_SPEED;
    }
  }

  /**
   * Contextual mantle/climb detection.
   *
   * We use the existing Box3 world representation rather than
   * requiring a new physics system.
   */
  private tryStartClimb(): boolean {
    if (!this.onGround) {
      return false;
    }

    const direction = new THREE.Vector3(
      0,
      0,
      -1
    ).applyAxisAngle(
      this.up,
      this.yaw
    );

    const feet = this.position.y -
      this.currentHeight;

    const horizontalX =
      direction.x * CLIMB_DISTANCE;

    const horizontalZ =
      direction.z * CLIMB_DISTANCE;

    let bestTop = -Infinity;

    for (const collider of this.colliders) {
      const nearX =
        this.position.x +
        horizontalX;

      const nearZ =
        this.position.z +
        horizontalZ;

      const insideHorizontalFootprint =
        nearX >= collider.min.x - PLAYER_RADIUS &&
        nearX <= collider.max.x + PLAYER_RADIUS &&
        nearZ >= collider.min.z - PLAYER_RADIUS &&
        nearZ <= collider.max.z + PLAYER_RADIUS;

      if (!insideHorizontalFootprint) {
        continue;
      }

      const obstacleHeight =
        collider.max.y - feet;

      if (
        obstacleHeight <
          CLIMB_MIN_HEIGHT ||
        obstacleHeight >
          CLIMB_MAX_HEIGHT
      ) {
        continue;
      }

      if (
        collider.max.y >
        bestTop
      ) {
        bestTop = collider.max.y;
      }
    }

    if (bestTop === -Infinity) {
      return false;
    }

    // Make sure the player won't immediately be stuck
    // inside another collider at the destination.
    const targetY =
      bestTop + PLAYER_HEIGHT;

    const targetPosition =
      this.position.clone();

    targetPosition.x +=
      direction.x *
      (CLIMB_DISTANCE * 0.9);

    targetPosition.z +=
      direction.z *
      (CLIMB_DISTANCE * 0.9);

    if (
      !this.canOccupyAt(
        targetPosition,
        PLAYER_HEIGHT
      )
    ) {
      return false;
    }

    this.movementState = 'climbing';

    this.climbTimer =
      CLIMB_DURATION;

    this.climbStartY =
      this.position.y;

    this.climbTargetY =
      targetY;

    this.velocity.set(0, 0, 0);

    return true;
  }

  private updateClimb(
    step: number
  ): void {
    const previous =
      this.climbTimer;

    this.climbTimer =
      Math.max(
        0,
        this.climbTimer - step
      );

    const progress =
      1 -
      this.climbTimer /
        CLIMB_DURATION;

    // Smoothstep.
    const eased =
      progress *
      progress *
      (3 - 2 * progress);

    const startY =
      this.climbStartY;

    const targetY =
      this.climbTargetY;

    this.position.y =
      THREE.MathUtils.lerp(
        startY,
        targetY,
        eased
      );

    // Move the player forward during the mantle.
    const direction =
      new THREE.Vector3(
        0,
        0,
        -1
      ).applyAxisAngle(
        this.up,
        this.yaw
      );

    const forwardAmount =
      CLIMB_DISTANCE *
      0.9 *
      Math.min(
        1,
        progress * 1.35
      );

    this.position.x =
      this.position.x +
      direction.x *
      forwardAmount *
      (step / CLIMB_DURATION);

    this.position.z =
      this.position.z +
      direction.z *
      forwardAmount *
      (step / CLIMB_DURATION);

    if (
      previous > 0 &&
      this.climbTimer === 0
    ) {
      this.position.y =
        targetY;

      this.currentHeight =
        PLAYER_HEIGHT;

      this.targetHeight =
        PLAYER_HEIGHT;

      this.movementState =
        'walking';

      this.onGround = true;

      this.velocity.set(
        0,
        0,
        0
      );
    }
  }

  /**
   * Checks whether the player can occupy a particular height
   * at their current location.
   */
  private canOccupyHeight(
    height: number
  ): boolean {
    return this.canOccupyAt(
      this.position,
      height
    );
  }

  private canOccupyAt(
    position: THREE.Vector3,
    height: number
  ): boolean {
    const box = new THREE.Box3();

    box.min.set(
      position.x - PLAYER_RADIUS,
      position.y - height,
      position.z - PLAYER_RADIUS
    );

    box.max.set(
      position.x + PLAYER_RADIUS,
      position.y,
      position.z + PLAYER_RADIUS
    );

    for (
      const collider of this.colliders
    ) {
      if (
        box.intersectsBox(collider)
      ) {
        return false;
      }
    }

    return true;
  }

  /**
   * Moves along one axis and resolves collision on that axis.
   */
  private moveAxis(
    axis: 'x' | 'y' | 'z',
    amount: number
  ): void {
    if (amount === 0) {
      return;
    }

    this.position[axis] += amount;

    this.updateBox();

    for (
      const box of this.colliders
    ) {
      if (
        !box.intersectsBox(
          this.playerBox
        )
      ) {
        continue;
      }

      if (axis === 'y') {
        if (amount < 0) {
          this.position.y =
            box.max.y +
            this.currentHeight +
            0.01;

          this.onGround = true;
        } else {
          this.position.y =
            box.min.y -
            COLLISION_EPSILON;
        }

        this.velocity.y = 0;
      } else if (amount > 0) {
        this.position[axis] =
          box.min[axis] -
          PLAYER_RADIUS -
          COLLISION_EPSILON;

        this.velocity[axis] = 0;
      } else {
        this.position[axis] =
          box.max[axis] +
          PLAYER_RADIUS +
          COLLISION_EPSILON;

        this.velocity[axis] = 0;
      }

      this.updateBox();
    }
  }

  /**
   * Ensures the player doesn't fall below the world ground.
   */
  private resolveGround(): void {
    if (
      this.position.y <
      this.currentHeight
    ) {
      this.position.y =
        this.currentHeight;

      this.velocity.y = 0;

      this.onGround = true;
    }
  }

  /** Recomputes the player's AABB. */
  private updateBox(): void {
    this.playerBox.min.set(
      this.position.x -
        PLAYER_RADIUS,

      this.position.y -
        this.currentHeight,

      this.position.z -
        PLAYER_RADIUS
    );

    this.playerBox.max.set(
      this.position.x +
        PLAYER_RADIUS,

      this.position.y,

      this.position.z +
        PLAYER_RADIUS
    );
  }

  /** Applies position and orientation to the camera. */
  private syncCamera(): void {
    this.camera.position.copy(
      this.position
    );

    this.camera.rotation.set(
      0,
      0,
      0
    );

    this.camera.rotateY(
      this.yaw
    );

    this.camera.rotateX(
      this.pitch
    );
  }
}