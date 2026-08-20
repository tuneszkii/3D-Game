import * as THREE from 'three';
import type { Collider } from './world.js';
import type { PlayerSnapshot, Stance } from './types.js';

const PLAYER_HEIGHT = 1.7;
const PLAYER_RADIUS = 0.35;

const CROUCH_HEIGHT = 1.15;
const PRONE_HEIGHT = 0.55;

const MOVE_SPEED = 7.5;
const SPRINT_SPEED = 10.0;
const TACTICAL_SPRINT_SPEED = 12.5;

const SLIDE_START_SPEED = 13.5;
const SLIDE_MAX_SPEED = 15.0;
const SLIDE_FRICTION = 7.0;
const SLIDE_DURATION = 0.8;

const AIR_CONTROL = 0.15;

const GRAVITY = 24;
const JUMP_VELOCITY = 7.5;

const MOUSE_SENSITIVITY = 0.0022;
const MAX_PITCH = Math.PI / 2 - 0.05;

/**
 * Tactical sprint:
 *
 * Shift down
 * Shift up
 * Shift down quickly
 *
 * The sprint key remains held after the second press.
 */
const SPRINT_DOUBLE_TAP_WINDOW = 0.3;
const TACTICAL_SPRINT_DURATION = 1.85;

const STANCE_TRANSITION_SPEED = 14;

/**
 * Mantle tuning.
 *
 * CLIMB_DISTANCE is the maximum horizontal distance at which
 * Space can initiate a mantle.
 */
const CLIMB_DISTANCE = 1.6;
const CLIMB_MIN_HEIGHT = 0.45;
const CLIMB_MAX_HEIGHT = 4;

/**
 * Mantling speed is distance based.
 *
 * A larger mantle therefore takes longer than a small mantle.
 */
const CLIMB_SPEED = 5.5;
const MIN_CLIMB_DURATION = 0.16;
const MAX_CLIMB_DURATION = 0.7;

const COLLISION_EPSILON = 0.001;

/** Fall damage tuning. */
const FALL_SAFE_SPEED = 12;
const FALL_LETHAL_SPEED = 28;
const FALL_MAX_DAMAGE = 100;

const SPAWN_POSITION = new THREE.Vector3(
  0,
  PLAYER_HEIGHT,
  22
);

/**
 * Movement states.
 *
 * walking and in-air are intentionally separate states.
 */
export type MovementState =
  | 'walking'
  | 'sprinting'
  | 'tactical-sprinting'
  | 'crouching'
  | 'sliding'
  | 'prone'
  | 'in-air'
  | 'climbing';

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

type CameraEffects = {
  bobTime: number;

  bobX: number;
  bobY: number;
  bobRoll: number;

  impulseX: number;
  impulseY: number;
  impulseRoll: number;

  targetRoll: number;
  currentRoll: number;

  landingKick: number;
  slideKick: number;
  proneKick: number;
  mantleKick: number;

  previousState: MovementState;
};

type MantleTarget = {
  collider: Collider;
  topY: number;
  distance: number;
  target: THREE.Vector3;
};

export class PlayerController {
  private readonly velocity = new THREE.Vector3();

  private readonly position =
    SPAWN_POSITION.clone();

  private yaw = 0;
  private pitch = 0;

  private onGround = false;

  private movementState: MovementState =
    'walking';

  private currentHeight =
    PLAYER_HEIGHT;

  private targetHeight =
    PLAYER_HEIGHT;

  private slideTimer = 0;

  private tacticalSprintTimer = 0;

  /**
   * Simulation clock makes tests deterministic.
   */
  private simulationTime = 0;

  private lastSprintPressTime =
    -Infinity;

  private climbTimer = 0;
  private climbDuration = 0;

  private climbStartPosition =
    new THREE.Vector3();

  private climbTargetPosition =
    new THREE.Vector3();

  private climbDirection =
    new THREE.Vector3();

  private jumpPressed = false;

  private health = 100;

  private debugOverlayEnabled = false;

  private controlHeld = false;
  private shiftHeld = false;

  private wasGrounded = false;

  private fallStartVelocityY = 0;

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

  private readonly playerBox =
    new THREE.Box3();

  private readonly up =
    new THREE.Vector3(0, 1, 0);

  private readonly cameraEffects: CameraEffects = {
    bobTime: 0,

    bobX: 0,
    bobY: 0,
    bobRoll: 0,

    impulseX: 0,
    impulseY: 0,
    impulseRoll: 0,

    targetRoll: 0,
    currentRoll: 0,

    landingKick: 0,
    slideKick: 0,
    proneKick: 0,
    mantleKick: 0,

    previousState: 'walking',
  };

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly colliders: Collider[]
  ) {
    this.syncCamera();
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  get grounded(): boolean {
    return this.onGround;
  }

  get worldPosition(): THREE.Vector3 {
    return this.position;
  }

  get state(): MovementState {
    return this.movementState;
  }

  get sliding(): boolean {
    return (
      this.movementState === 'sliding'
    );
  }

  get isSliding(): boolean {
    return this.sliding;
  }

  get prone(): boolean {
    return (
      this.movementState === 'prone'
    );
  }

  get tacticalSprinting(): boolean {
    return (
      this.movementState ===
      'tactical-sprinting'
    );
  }

  get canMantle(): boolean {
    return this.findMantleTarget() !== undefined;
  }

  get height(): number {
    return this.currentHeight;
  }

  get worldColliders(): readonly Collider[] {
    return this.colliders;
  }

  get debugEnabled(): boolean {
    return this.debugOverlayEnabled;
  }

  get currentHealth(): number {
    return this.health;
  }

  get currentStance(): Stance {
    switch (this.movementState) {
      case 'crouching':
      case 'sliding':
        return 'crouch';

      case 'prone':
        return 'prone';

      default:
        return 'stand';
    }
  }

  toSnapshot(): PlayerSnapshot {
    return {
      position: {
        x: this.position.x,
        y: this.position.y,
        z: this.position.z,
      },

      velocity: {
        x: this.velocity.x,
        y: this.velocity.y,
        z: this.velocity.z,
      },

      speed: Math.hypot(
        this.velocity.x,
        this.velocity.z
      ),

      stance: this.currentStance,

      sliding: this.sliding,

      climbing:
        this.movementState ===
        'climbing',

      grounded: this.onGround,

      canMantle: this.canMantle,

      sprinting:
        this.movementState ===
          'sprinting' ||
        this.movementState ===
          'tactical-sprinting',

      health: this.health,

      debug: this.debugOverlayEnabled,
    };
  }

  // ---------------------------------------------------------------------------
  // Input
  // ---------------------------------------------------------------------------

  handleKey(
    code: string,
    pressed: boolean
  ): boolean {
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

      case 'ControlLeft':
      case 'ControlRight':
        this.controlHeld = pressed;
        break;

      case 'ShiftLeft':
      case 'ShiftRight':
        if (
          pressed &&
          !this.input.sprint
        ) {
          this.shiftHeld = true;
          this.handleSprintPress();
        }

        if (!pressed) {
          this.shiftHeld = false;
        }

        this.input.sprint = pressed;
        break;

      case 'Space':
        if (
          pressed &&
          !this.input.jump
        ) {
          this.jumpPressed = true;
        }

        this.input.jump = pressed;
        break;

      case 'KeyC':
        if (
          pressed &&
          !this.input.crouch
        ) {
          this.handleCrouchPress();
        }

        this.input.crouch = pressed;
        break;

      case 'KeyX':
        if (
          pressed &&
          !this.input.prone
        ) {
          this.handlePronePress();
        }

        this.input.prone = pressed;
        break;

      case 'KeyB':
        if (
          pressed &&
          this.controlHeld &&
          this.shiftHeld
        ) {
          this.debugOverlayEnabled =
            !this.debugOverlayEnabled;

          return true;
        }

        break;

      default:
        break;
    }

    return false;
  }

  handleLook(
    movementX: number,
    movementY: number
  ): void {
    this.yaw -=
      movementX *
      MOUSE_SENSITIVITY;

    this.pitch -=
      movementY *
      MOUSE_SENSITIVITY;

    this.pitch =
      THREE.MathUtils.clamp(
        this.pitch,
        -MAX_PITCH,
        MAX_PITCH
      );
  }

  releaseKeys(): void {
    this.input.forward = false;
    this.input.back = false;
    this.input.left = false;
    this.input.right = false;

    this.input.jump = false;
    this.input.sprint = false;
    this.input.crouch = false;
    this.input.prone = false;

    this.controlHeld = false;
    this.shiftHeld = false;

    this.jumpPressed = false;
  }

  // ---------------------------------------------------------------------------
  // Main update
  // ---------------------------------------------------------------------------

  update(delta: number): void {
    const step = Math.min(
      Math.max(delta, 0),
      0.05
    );

    this.simulationTime += step;

    if (
      this.movementState ===
      'climbing'
    ) {
      this.updateClimb(step);
      this.updateCameraEffects(step);
      this.syncCamera();
      return;
    }

    this.updateFallTracking();

    this.updateTimers(step);

    this.updateStance(step);

    const wish =
      this.getWishDirection();

    const hasMovementInput =
      wish.lengthSq() > 0;

    this.updateMovementState(
      hasMovementInput
    );

    const speed =
      this.getMovementSpeed();

    const targetX =
      wish.x * speed;

    const targetZ =
      wish.z * speed;

    const control =
      this.onGround
        ? 1
        : AIR_CONTROL;

    const blend =
      1 -
      Math.exp(
        -18 *
          control *
          step
      );

    if (
      this.movementState ===
      'sliding'
    ) {
      this.updateSlideMovement(step);
    } else {
      this.velocity.x +=
        (targetX -
          this.velocity.x) *
        blend;

      this.velocity.z +=
        (targetZ -
          this.velocity.z) *
        blend;
    }

    this.handleJump();

    this.velocity.y -=
      GRAVITY * step;

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

    this.handleLanding();

    this.updateCameraEffects(step);

    this.syncCamera();
  }

  // ---------------------------------------------------------------------------
  // Tactical sprint
  // ---------------------------------------------------------------------------

  private handleSprintPress(): void {
    const elapsed =
      this.simulationTime -
      this.lastSprintPressTime;

    if (
      elapsed <=
        SPRINT_DOUBLE_TAP_WINDOW &&
      this.onGround &&
      this.hasForwardMovement()
    ) {
      this.startTacticalSprint();
    }

    this.lastSprintPressTime =
      this.simulationTime;
  }

private startTacticalSprint(): void {
  if (!this.onGround) {
    return;
  }

  if (!this.hasForwardMovement()) {
    return;
  }

  this.tacticalSprintTimer =
    TACTICAL_SPRINT_DURATION;

  this.movementState =
    'tactical-sprinting';

  this.targetHeight =
    PLAYER_HEIGHT;

  this.cameraEffects.impulseY -=
    0.035;
}

  // ---------------------------------------------------------------------------
  // Crouch / slide
  // ---------------------------------------------------------------------------

  private handleCrouchPress(): void {
    if (
      this.movementState ===
      'sliding'
    ) {
      this.cancelSlide(false);
      return;
    }

    if (
      this.movementState ===
        'sprinting' ||
      this.movementState ===
        'tactical-sprinting'
    ) {
      this.startSlide();
      return;
    }

    if (
      this.movementState ===
      'prone'
    ) {
      this.exitProne();
      return;
    }

    if (
      this.movementState ===
      'crouching'
    ) {
      this.standUp();
      return;
    }

    if (this.onGround) {
      this.startCrouch();
    }
  }

  private startCrouch(): void {
    this.tacticalSprintTimer = 0;

    this.movementState =
      'crouching';

    this.targetHeight =
      CROUCH_HEIGHT;

    this.cameraEffects.impulseY -=
      0.025;
  }

  private standUp(): void {
    if (
      !this.canOccupyHeight(
        PLAYER_HEIGHT
      )
    ) {
      return;
    }

    this.movementState =
      'walking';

    this.targetHeight =
      PLAYER_HEIGHT;
  }

  // ---------------------------------------------------------------------------
  // Prone
  // ---------------------------------------------------------------------------

  private handlePronePress(): void {
    if (!this.onGround) {
      return;
    }

    if (
      this.movementState ===
      'prone'
    ) {
      this.exitProne();
      return;
    }

    if (
      this.movementState ===
      'sliding'
    ) {
      this.cancelSlide(false);
    }

    this.tacticalSprintTimer = 0;

    this.movementState =
      'prone';

    this.targetHeight =
      PRONE_HEIGHT;

    this.velocity.y = 0;

    this.cameraEffects.proneKick =
      1;
  }

  private exitProne(): void {
    if (
      this.canOccupyHeight(
        PLAYER_HEIGHT
      )
    ) {
      this.movementState =
        'walking';

      this.targetHeight =
        PLAYER_HEIGHT;

      return;
    }

    if (
      this.canOccupyHeight(
        CROUCH_HEIGHT
      )
    ) {
      this.movementState =
        'crouching';

      this.targetHeight =
        CROUCH_HEIGHT;
    }
  }

  // ---------------------------------------------------------------------------
  // Sliding
  // ---------------------------------------------------------------------------

  private startSlide(): void {
    if (!this.onGround) {
      return;
    }

    if (
      this.movementState !==
        'sprinting' &&
      this.movementState !==
        'tactical-sprinting'
    ) {
      return;
    }

    this.movementState =
      'sliding';

    this.slideTimer =
      SLIDE_DURATION;

    this.targetHeight =
      CROUCH_HEIGHT;

    const currentSpeed =
      Math.hypot(
        this.velocity.x,
        this.velocity.z
      );

    const wish =
      this.getWishDirection();

    const direction =
      new THREE.Vector3(
        this.velocity.x,
        0,
        this.velocity.z
      );

    if (
      direction.lengthSq() <
      0.001
    ) {
      direction.copy(wish);
    }

    if (
      direction.lengthSq() <
      0.001
    ) {
      direction.set(
        0,
        0,
        -1
      );

      direction.applyAxisAngle(
        this.up,
        this.yaw
      );
    }

    direction.normalize();

    const slideSpeed =
      THREE.MathUtils.clamp(
        Math.max(
          SLIDE_START_SPEED,
          currentSpeed
        ),
        SLIDE_START_SPEED,
        SLIDE_MAX_SPEED
      );

    this.velocity.x =
      direction.x *
      slideSpeed;

    this.velocity.z =
      direction.z *
      slideSpeed;

    this.tacticalSprintTimer = 0;

    this.cameraEffects.slideKick =
      1;
  }

  private cancelSlide(
    jumpAfterCancel: boolean
  ): void {
    if (
      this.movementState !==
      'sliding'
    ) {
      return;
    }

    this.slideTimer = 0;

    const speed =
      Math.hypot(
        this.velocity.x,
        this.velocity.z
      );

    const preservedSpeed =
      Math.min(
        speed,
        SPRINT_SPEED
      );

    const direction =
      new THREE.Vector3(
        this.velocity.x,
        0,
        this.velocity.z
      );

    if (
      direction.lengthSq() >
      0.001
    ) {
      direction.normalize();

      this.velocity.x =
        direction.x *
        preservedSpeed;

      this.velocity.z =
        direction.z *
        preservedSpeed;
    }

    this.movementState =
      'walking';

    this.targetHeight =
      PLAYER_HEIGHT;

    if (
      this.input.sprint &&
      this.hasForwardMovement() &&
      this.onGround
    ) {
      this.movementState =
        'sprinting';
    }

    if (jumpAfterCancel) {
      this.performJump();
    }
  }

  // ---------------------------------------------------------------------------
  // Jump
  // ---------------------------------------------------------------------------

  private handleJump(): void {
    if (!this.jumpPressed) {
      return;
    }

    this.jumpPressed = false;

    if (
      this.movementState ===
      'sliding'
    ) {
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

    this.velocity.y =
      JUMP_VELOCITY;

    this.onGround = false;

    this.movementState =
      'in-air';

    if (
      this.currentStance !==
      'stand'
    ) {
      this.targetHeight =
        PLAYER_HEIGHT;
    }

    this.cameraEffects.impulseY +=
      0.055;

    this.cameraEffects.impulseRoll +=
      (Math.random() - 0.5) *
      0.03;
  }

  // ---------------------------------------------------------------------------
  // Movement state machine
  // ---------------------------------------------------------------------------

  private updateMovementState(
    hasMovementInput: boolean
  ): void {
    if (
      this.movementState ===
        'sliding' ||
      this.movementState ===
        'prone'
    ) {
      return;
    }

    if (!this.onGround) {
      this.movementState =
        'in-air';

      return;
    }

    if (
      this.movementState ===
      'in-air'
    ) {
      this.movementState =
        'walking';
    }

    if (
      this.movementState ===
      'crouching'
    ) {
      if (
        this.input.sprint &&
        this.hasForwardMovement()
      ) {
        this.movementState =
          'sprinting';

        this.targetHeight =
          PLAYER_HEIGHT;

        return;
      }

      return;
    }

    if (!hasMovementInput) {
      if (
        this.movementState ===
          'sprinting' ||
        this.movementState ===
          'tactical-sprinting'
      ) {
        this.movementState =
          'walking';
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

      this.targetHeight =
        PLAYER_HEIGHT;

      return;
    }

    if (
      this.input.sprint &&
      this.hasForwardMovement()
    ) {
      this.movementState =
        'sprinting';

      this.targetHeight =
        PLAYER_HEIGHT;

      return;
    }

    this.movementState =
      'walking';
  }

  // ---------------------------------------------------------------------------
  // Timers
  // ---------------------------------------------------------------------------

  private updateTimers(
    step: number
  ): void {
    if (
      this.tacticalSprintTimer >
      0
    ) {
      this.tacticalSprintTimer =
        Math.max(
          0,
          this.tacticalSprintTimer -
            step
        );

      if (
        this.tacticalSprintTimer ===
          0 &&
        this.movementState ===
          'tactical-sprinting'
      ) {
        this.movementState =
          this.input.sprint &&
          this.hasForwardMovement()
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
        this.movementState ===
          'sliding'
      ) {
        this.cancelSlide(false);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Slide physics
  // ---------------------------------------------------------------------------

  private updateSlideMovement(
    step: number
  ): void {
    const speed =
      Math.hypot(
        this.velocity.x,
        this.velocity.z
      );

    if (speed <= 0.01) {
      return;
    }

    const newSpeed =
      Math.max(
        0,
        speed -
          SLIDE_FRICTION *
            step
      );

    const scale =
      newSpeed / speed;

    this.velocity.x *= scale;
    this.velocity.z *= scale;
  }

  // ---------------------------------------------------------------------------
  // Stance
  // ---------------------------------------------------------------------------

  private updateStance(
    step: number
  ): void {
    const difference =
      this.targetHeight -
      this.currentHeight;

    const maxChange =
      STANCE_TRANSITION_SPEED *
      step;

    const change =
      THREE.MathUtils.clamp(
        difference,
        -maxChange,
        maxChange
      );

    this.currentHeight +=
      change;

    /**
     * The player's feet remain planted
     * while the capsule/AABB height changes.
     */
    this.position.y += change;

    this.updateBox();
  }

  // ---------------------------------------------------------------------------
  // Movement direction
  // ---------------------------------------------------------------------------

  private getWishDirection(): THREE.Vector3 {
    const wish =
      new THREE.Vector3(
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
    switch (
      this.movementState
    ) {
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

      case 'in-air':
        return MOVE_SPEED;

      default:
        return MOVE_SPEED;
    }
  }

  // ---------------------------------------------------------------------------
  // Mantling / climbing
  // ---------------------------------------------------------------------------


private findMantleTarget():
  MantleTarget | undefined {
   
    const direction =
      new THREE.Vector3(
        0,
        0,
        -1
      ).applyAxisAngle(
        this.up,
        this.yaw
      );

    const feetY =
      this.position.y -
      this.currentHeight;

    let best:
      | {
          collider: Collider;
          topY: number;
          distance: number;
          target: THREE.Vector3;
        }
      | undefined;

    for (
      const collider of this.colliders
    ) {
      const topY =
        collider.max.y;

      const climbHeight =
        topY - feetY;

      if (
        climbHeight <
          CLIMB_MIN_HEIGHT ||
        climbHeight >
          CLIMB_MAX_HEIGHT
      ) {
        continue;
      }

      /**
       * Horizontal distance from player to
       * the relevant face of the obstacle.
       */
      const dx =
        this.position.x -
        THREE.MathUtils.clamp(
          this.position.x,
          collider.min.x,
          collider.max.x
        );

      const dz =
        this.position.z -
        THREE.MathUtils.clamp(
          this.position.z,
          collider.min.z,
          collider.max.z
        );

      const horizontalDistance =
        Math.hypot(dx, dz);

      /**
       * Only consider objects that are actually
       * in front of the player.
       */
      const center =
        new THREE.Vector3(
          (collider.min.x +
            collider.max.x) *
            0.5,

          0,

          (collider.min.z +
            collider.max.z) *
            0.5
        );

      const toCenter =
        center.sub(
          new THREE.Vector3(
            this.position.x,
            0,
            this.position.z
          )
        );

      if (
        toCenter.lengthSq() <
        0.0001
      ) {
        continue;
      }

      toCenter.normalize();

      const facing =
        toCenter.dot(direction);

      if (facing < 0.45) {
        continue;
      }

      /**
       * Check distance along the player's
       * forward axis.
       */
      const forwardDistance =
        (
          new THREE.Vector3(
            collider.min.x,
            0,
            collider.min.z
          ).sub(
            new THREE.Vector3(
              this.position.x,
              0,
              this.position.z
            )
          )
        ).dot(direction);

      const reverseForwardDistance =
        (
          new THREE.Vector3(
            collider.max.x,
            0,
            collider.max.z
          ).sub(
            new THREE.Vector3(
              this.position.x,
              0,
              this.position.z
            )
          )
        ).dot(direction);

      const nearestForwardDistance =
        Math.max(
          0,
          Math.min(
            forwardDistance,
            reverseForwardDistance
          )
        );

      if (
        nearestForwardDistance >
        CLIMB_DISTANCE
      ) {
        continue;
      }

      /**
       * The player needs to be horizontally
       * aligned with the obstacle footprint.
       */
      const playerX =
        this.position.x;

      const playerZ =
        this.position.z;

      const insideExpandedFootprint =
        playerX >=
          collider.min.x -
            PLAYER_RADIUS -
            0.15 &&
        playerX <=
          collider.max.x +
            PLAYER_RADIUS +
            0.15 &&
        playerZ >=
          collider.min.z -
            PLAYER_RADIUS -
            0.15 &&
        playerZ <=
          collider.max.z +
            PLAYER_RADIUS +
            0.15;

      if (
        !insideExpandedFootprint
      ) {
        continue;
      }

      /**
       * Put the player on the far side/top
       * of the obstacle.
       */
      const target =
        this.position.clone();

      const expandedMinX =
        collider.min.x -
        PLAYER_RADIUS -
        0.05;

      const expandedMaxX =
        collider.max.x +
        PLAYER_RADIUS +
        0.05;

      const expandedMinZ =
        collider.min.z -
        PLAYER_RADIUS -
        0.05;

      const expandedMaxZ =
        collider.max.z +
        PLAYER_RADIUS +
        0.05;

      /**
       * Determine which face the player
       * is approaching.
       */
      const distances = [
        {
          distance: Math.abs(
            this.position.z -
              expandedMaxZ
          ),
          x: this.position.x,
          z: expandedMaxZ,
        },

        {
          distance: Math.abs(
            this.position.z -
              expandedMinZ
          ),
          x: this.position.x,
          z: expandedMinZ,
        },

        {
          distance: Math.abs(
            this.position.x -
              expandedMaxX
          ),
          x: expandedMaxX,
          z: this.position.z,
        },

        {
          distance: Math.abs(
            this.position.x -
              expandedMinX
          ),
          x: expandedMinX,
          z: this.position.z,
        },
      ];

      distances.sort(
        (a, b) =>
          a.distance -
          b.distance
      );

      const face =
        distances[0];

      target.x =
        THREE.MathUtils.clamp(
          face.x,
          expandedMinX,
          expandedMaxX
        );

      target.z =
        THREE.MathUtils.clamp(
          face.z,
          expandedMinZ,
          expandedMaxZ
        );

      /**
       * Move beyond the face in the direction
       * of travel. This is what makes the mantle
       * feel like going over the obstacle instead
       * of just rising vertically.
       */
      target.x +=
        direction.x *
        (PLAYER_RADIUS + 0.05);

      target.z +=
        direction.z *
        (PLAYER_RADIUS + 0.05);

      target.y =
        topY +
        PLAYER_HEIGHT;

      const horizontalDistanceToTarget =
        Math.hypot(
          target.x -
            this.position.x,
          target.z -
            this.position.z
        );

      const distance =
        Math.hypot(
          horizontalDistanceToTarget,
          climbHeight
        );

      if (
        !best ||
        distance < best.distance
      ) {
        best = {
          collider,
          topY,
          distance,
          target
        };
      }
    }

    if (!best) {
      return undefined;
    }

    return best;
  }

  /**
   * Finds a climbable collider directly in front of
   * the player.
   *
   * Crucially, this does NOT require the player to be
   * moving into the wall.
   */
  private tryStartClimb(): boolean {
  const best = this.findMantleTarget();

  if (!best) {
    return false;
  }

  const direction = new THREE.Vector3(
    this.input.right ? 1 : 0,
    0,
    this.input.forward ? -1 : 0,
  );

  /**
   * We only reject the mantle if the final
   * position is genuinely occupied by another
   * collider.
   *
   * The collider being climbed is explicitly
   * ignored for this destination check.
   */
  if (
    !this.canOccupyAtIgnoring(
      best.target,
      PLAYER_HEIGHT,
      best.collider
    )
  ) {
    return false;
  }

  if (
  !this.canTraverseMantle(
    this.position,
    best.target,
    PLAYER_HEIGHT,
    best.collider
  )
) {
  return false;
}

  this.movementState =
    'climbing';

  this.climbStartPosition.copy(
    this.position
  );

  this.climbTargetPosition.copy(
    best.target
  );

  this.climbDirection.copy(
    direction
  );

  this.climbDuration =
    THREE.MathUtils.clamp(
      best.distance /
        CLIMB_SPEED,
      MIN_CLIMB_DURATION,
      MAX_CLIMB_DURATION
    );

  this.climbTimer =
    this.climbDuration;

  this.velocity.set(
    0,
    0,
    0
  );

  this.targetHeight =
    PLAYER_HEIGHT;

  this.currentHeight =
    PLAYER_HEIGHT;

  this.cameraEffects.mantleKick =
    1;

  return true;
}

  private updateClimb(
    step: number
  ): void {
    if (
      this.climbDuration <= 0
    ) {
      this.finishClimb();
      return;
    }

    this.climbTimer =
      Math.max(
        0,
        this.climbTimer - step
      );

    const progress =
      1 -
      this.climbTimer /
        this.climbDuration;

    /**
     * Smoothstep gives a quick start,
     * smooth middle and controlled finish.
     */
    const eased =
      progress *
      progress *
      (3 - 2 * progress);

    /**
     * Add a slight arc to the mantle.
     */
    const arc =
      Math.sin(
        Math.PI * progress
      );

    this.position.lerpVectors(
      this.climbStartPosition,
      this.climbTargetPosition,
      eased
    );

    this.position.y +=
      arc * 0.18;

    if (
      this.climbTimer <= 0
    ) {
      this.finishClimb();
    }
  }

  private finishClimb(): void {
    this.position.copy(
      this.climbTargetPosition
    );

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

    this.climbTimer = 0;
    this.climbDuration = 0;
  }

  // ---------------------------------------------------------------------------
  // Occupancy / collisions
  // ---------------------------------------------------------------------------

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
    const box =
      new THREE.Box3();

    box.min.set(
      position.x -
        PLAYER_RADIUS,

      position.y -
        height,

      position.z -
        PLAYER_RADIUS
    );

    box.max.set(
      position.x +
        PLAYER_RADIUS,

      position.y,

      position.z +
        PLAYER_RADIUS
    );

    for (
      const collider of
        this.colliders
    ) {
      if (
        box.intersectsBox(
          collider
        )
      ) {
        return false;
      }
    }

    return true;
  }

  private canOccupyAtIgnoring(
    position: THREE.Vector3,
    height: number,
    ignored: Collider
  ): boolean {
    const box =
      new THREE.Box3();

    box.min.set(
      position.x -
        PLAYER_RADIUS,

      position.y -
        height,

      position.z -
        PLAYER_RADIUS
    );

    box.max.set(
      position.x +
        PLAYER_RADIUS,

      position.y,

      position.z +
        PLAYER_RADIUS
    );

    for (
      const collider of
        this.colliders
    ) {
      if (collider === ignored) {
        continue;
      }

      if (
        box.intersectsBox(
          collider
        )
      ) {
        return false;
      }
    }

    return true;
  }

private canTraverseMantle(
  start: THREE.Vector3,
  target: THREE.Vector3,
  height: number,
  ignored: Collider
): boolean {
  const steps = 16;

  const sample =
    new THREE.Vector3();

  for (let i = 1; i <= steps; i++) {
    const progress =
      i / steps;

    const eased =
      progress *
      progress *
      (3 - 2 * progress);

    sample.lerpVectors(
      start,
      target,
      eased
    );

    const arc =
      Math.sin(
        Math.PI * progress
      ) * 0.18;

    sample.y += arc;

    if (
      !this.canOccupyAtIgnoring(
        sample,
        height,
        ignored
      )
    ) {
      return false;
    }
  }

  return true;
}

private moveAxis(
  axis: 'x' | 'y' | 'z',
  amount: number
): void {
  if (amount === 0) {
    return;
  }

  this.position[axis] += amount;
  this.updateBox();

  if (axis === 'y') {
    // Falling: find the highest surface directly below us.
    if (amount < 0) {
      let landingY = -Infinity;

      for (
        const box of this.colliders
      ) {
        const horizontalOverlap =
          this.playerBox.max.x >
            box.min.x &&
          this.playerBox.min.x <
            box.max.x &&
          this.playerBox.max.z >
            box.min.z &&
          this.playerBox.min.z <
            box.max.z;

        if (!horizontalOverlap) {
          continue;
        }

        const playerBottom =
          this.playerBox.min.y;

        const crossedTop =
          playerBottom <=
            box.max.y &&
          playerBottom - amount >=
            box.max.y;

        if (crossedTop) {
          landingY =
            Math.max(
              landingY,
              box.max.y
            );
        }
      }

      if (landingY !== -Infinity) {
        this.position.y =
          landingY +
          this.currentHeight +
          COLLISION_EPSILON;

        this.velocity.y = 0;
        this.onGround = true;

        this.updateBox();
        return;
      }
    }

    // Rising: only collide with a ceiling
    // if the player's head actually crosses
    // the bottom of a collider.
    if (amount > 0) {
      for (
        const box of this.colliders
      ) {
        const horizontalOverlap =
          this.playerBox.max.x >
            box.min.x &&
          this.playerBox.min.x <
            box.max.x &&
          this.playerBox.max.z >
            box.min.z &&
          this.playerBox.min.z <
            box.max.z;

        if (!horizontalOverlap) {
          continue;
        }

        const playerTop =
          this.playerBox.max.y;

        const crossedBottom =
          playerTop >=
            box.min.y &&
          playerTop - amount <=
            box.min.y;

        if (crossedBottom) {
          this.position.y =
            box.min.y -
            COLLISION_EPSILON;

          this.velocity.y = 0;

          this.updateBox();
          return;
        }
      }
    }

    return;
  }

  // Horizontal collision.
  for (
    const box of this.colliders
  ) {
    if (
      !this.playerBox.intersectsBox(
        box
      )
    ) {
      continue;
    }

    if (axis === 'x') {
      if (amount > 0) {
        this.position.x =
          box.min.x -
          PLAYER_RADIUS -
          COLLISION_EPSILON;
      } else {
        this.position.x =
          box.max.x +
          PLAYER_RADIUS +
          COLLISION_EPSILON;
      }

      this.velocity.x = 0;
    } else {
      if (amount > 0) {
        this.position.z =
          box.min.z -
          PLAYER_RADIUS -
          COLLISION_EPSILON;
      } else {
        this.position.z =
          box.max.z +
          PLAYER_RADIUS +
          COLLISION_EPSILON;
      }

      this.velocity.z = 0;
    }

    this.updateBox();
    return;
  }
}

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

  // ---------------------------------------------------------------------------
  // Fall damage
  // ---------------------------------------------------------------------------

  private updateFallTracking(): void {
    if (
      this.wasGrounded &&
      !this.onGround
    ) {
      this.fallStartVelocityY =
        this.velocity.y;
    }

    this.wasGrounded =
      this.onGround;
  }

  private handleLanding(): void {
    if (
      this.onGround &&
      !this.wasGrounded
    ) {
      const impactSpeed =
        Math.abs(
          this.fallStartVelocityY
        );

      if (
        impactSpeed >
        FALL_SAFE_SPEED
      ) {
        const damage =
          THREE.MathUtils.clamp(
            ((impactSpeed -
              FALL_SAFE_SPEED) /
              (FALL_LETHAL_SPEED -
                FALL_SAFE_SPEED)) *
              FALL_MAX_DAMAGE,

            0,
            FALL_MAX_DAMAGE
          );

        if (
          impactSpeed >=
          FALL_LETHAL_SPEED
        ) {
          this.respawn();
          return;
        }

        this.health =
          Math.max(
            0,
            this.health - damage
          );
      }

      this.cameraEffects.landingKick =
        THREE.MathUtils.clamp(
          impactSpeed / 20,
          0,
          1
        );
    }

    this.wasGrounded =
      this.onGround;
  }

  private respawn(): void {
    this.position.copy(
      SPAWN_POSITION
    );

    this.velocity.set(
      0,
      0,
      0
    );

    this.currentHeight =
      PLAYER_HEIGHT;

    this.targetHeight =
      PLAYER_HEIGHT;

    this.movementState =
      'walking';

    this.onGround = false;

    this.health = 100;

    this.slideTimer = 0;
    this.tacticalSprintTimer = 0;

    this.wasGrounded = false;

    this.cameraEffects.landingKick =
      1;
  }

  // ---------------------------------------------------------------------------
  // Camera effects
  // ---------------------------------------------------------------------------

  private updateCameraEffects(
    step: number
  ): void {
    const state =
      this.movementState;

    if (
      state !==
      this.cameraEffects.previousState
    ) {
      this.handleCameraStateChange(
        state
      );

      this.cameraEffects.previousState =
        state;
    }

    const speed =
      Math.hypot(
        this.velocity.x,
        this.velocity.z
      );

    const normalizedSpeed =
      THREE.MathUtils.clamp(
        speed / 12,
        0,
        1.5
      );

    if (
      this.onGround &&
      speed > 0.15 &&
      state !== 'climbing'
    ) {
      let frequency = 7.5;
      let amplitude = 0.012;

      switch (state) {
        case 'walking':
          frequency = 8;
          amplitude = 0.012;
          break;

        case 'sprinting':
          frequency = 10.5;
          amplitude = 0.019;
          break;

        case 'tactical-sprinting':
          frequency = 13;
          amplitude = 0.028;
          break;

        case 'crouching':
          frequency = 6;
          amplitude = 0.008;
          break;

        case 'sliding':
          frequency = 12;
          amplitude = 0.014;
          break;
      }

      this.cameraEffects.bobTime +=
        step *
        frequency *
        (0.8 +
          normalizedSpeed);

      const bob =
        this.cameraEffects.bobTime;

      this.cameraEffects.bobX =
        Math.sin(bob * 0.5) *
        amplitude;

      this.cameraEffects.bobY =
        Math.abs(
          Math.sin(bob)
        ) *
        amplitude;

      this.cameraEffects.bobRoll =
        Math.sin(
          bob * 0.5
        ) *
        amplitude *
        0.65;
    } else {
      this.cameraEffects.bobX =
        THREE.MathUtils.damp(
          this.cameraEffects.bobX,
          0,
          12,
          step
        );

      this.cameraEffects.bobY =
        THREE.MathUtils.damp(
          this.cameraEffects.bobY,
          0,
          12,
          step
        );

      this.cameraEffects.bobRoll =
        THREE.MathUtils.damp(
          this.cameraEffects.bobRoll,
          0,
          12,
          step
        );
    }

    this.cameraEffects.landingKick =
      THREE.MathUtils.damp(
        this.cameraEffects.landingKick,
        0,
        12,
        step
      );

    this.cameraEffects.slideKick =
      THREE.MathUtils.damp(
        this.cameraEffects.slideKick,
        0,
        10,
        step
      );

    this.cameraEffects.proneKick =
      THREE.MathUtils.damp(
        this.cameraEffects.proneKick,
        0,
        7,
        step
      );

    this.cameraEffects.mantleKick =
      THREE.MathUtils.damp(
        this.cameraEffects.mantleKick,
        0,
        8,
        step
      );

    this.cameraEffects.impulseX =
      THREE.MathUtils.damp(
        this.cameraEffects.impulseX,
        0,
        10,
        step
      );

    this.cameraEffects.impulseY =
      THREE.MathUtils.damp(
        this.cameraEffects.impulseY,
        0,
        10,
        step
      );

    this.cameraEffects.impulseRoll =
      THREE.MathUtils.damp(
        this.cameraEffects.impulseRoll,
        0,
        10,
        step
      );

    let targetRoll = 0;

    if (
      state === 'sprinting'
    ) {
      targetRoll =
        -0.012 *
        Math.sign(
          this.input.right
            ? 1
            : this.input.left
              ? -1
              : 0
        );
    }

    if (
      state ===
      'tactical-sprinting'
    ) {
      targetRoll =
        -0.025 *
        Math.sign(
          this.input.right
            ? 1
            : this.input.left
              ? -1
              : 0
        );
    }

    if (
      state === 'sliding'
    ) {
      targetRoll =
        0.035;
    }

    this.cameraEffects.targetRoll =
      targetRoll;

    this.cameraEffects.currentRoll =
      THREE.MathUtils.damp(
        this.cameraEffects.currentRoll,
        targetRoll,
        10,
        step
      );
  }

  private handleCameraStateChange(
    state: MovementState
  ): void {
    switch (state) {
      case 'sprinting':
        this.cameraEffects.impulseY -=
          0.018;
        break;

      case 'tactical-sprinting':
        this.cameraEffects.impulseY -=
          0.04;

        this.cameraEffects.impulseRoll +=
          (Math.random() - 0.5) *
          0.025;
        break;

      case 'sliding':
        this.cameraEffects.slideKick =
          1;

        this.cameraEffects.impulseY -=
          0.08;

        this.cameraEffects.impulseRoll +=
          (Math.random() - 0.5) *
          0.06;
        break;

      case 'crouching':
        this.cameraEffects.impulseY -=
          0.025;
        break;

      case 'prone':
        this.cameraEffects.proneKick =
          1;

        this.cameraEffects.impulseY -=
          0.08;

        this.cameraEffects.impulseRoll +=
          (Math.random() - 0.5) *
          0.035;
        break;

      case 'in-air':
        this.cameraEffects.impulseY +=
          0.035;
        break;

      case 'climbing':
        this.cameraEffects.mantleKick =
          1;
        break;
    }
  }

  /**
   * Camera effects are applied here rather than modifying
   * the player's actual physics position.
   */
  private syncCamera(): void {
    this.camera.position.copy(
      this.position
    );

    const speed =
      Math.hypot(
        this.velocity.x,
        this.velocity.z
      );

    const slideDip =
      this.cameraEffects.slideKick *
      0.1;

    const proneDip =
      this.cameraEffects.proneKick *
      0.06;

    const mantleLift =
      this.cameraEffects.mantleKick *
      0.035;

    const landingDip =
      this.cameraEffects.landingKick *
      0.075;

    const cameraY =
      this.position.y +
      this.cameraEffects.bobY +
      this.cameraEffects.impulseY -
      slideDip -
      proneDip -
      landingDip +
      mantleLift;

    const cameraX =
      this.cameraEffects.bobX +
      this.cameraEffects.impulseX;

    this.camera.position.x +=
      cameraX;

    this.camera.position.y =
      cameraY;

    this.camera.position.z +=
      0;

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

    this.camera.rotateZ(
      this.cameraEffects.currentRoll +
        this.cameraEffects.bobRoll +
        this.cameraEffects.impulseRoll
    );

    /**
     * Tiny speed-dependent pitch movement.
     */
    if (speed > 0.1) {
      const movementPitch =
        Math.sin(
          this.cameraEffects.bobTime *
            0.5
        ) *
        THREE.MathUtils.clamp(
          speed / 20,
          0,
          1
        ) *
        0.008;

      this.camera.rotateX(
        movementPitch
      );
    }
  }
}