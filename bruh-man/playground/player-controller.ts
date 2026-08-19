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

const AIR_CONTROL = 0.45;

const GRAVITY = 24;
const JUMP_VELOCITY = 8.2;

const MOUSE_SENSITIVITY = 0.0022;
const MAX_PITCH = Math.PI / 2 - 0.05;

const SPRINT_DOUBLE_TAP_WINDOW = 0.25;
const TACTICAL_SPRINT_DURATION = 1.15;

const STANCE_TRANSITION_SPEED = 14;

const CLIMB_DISTANCE = 1.5;
const CLIMB_MIN_HEIGHT = 0.45;
const CLIMB_MAX_HEIGHT = 1.8;
const CLIMB_DURATION = 0.28;

const COLLISION_EPSILON = 0.001;

/** Fall damage tuning. */
const FALL_SAFE_SPEED = 12;
const FALL_LETHAL_SPEED = 28;
const FALL_MAX_DAMAGE = 100;

/** Respawn position. */
const SPAWN_POSITION = new THREE.Vector3(
  0,
  PLAYER_HEIGHT,
  22
);

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

export type MovementState =
  | 'walking'
  | 'sprinting'
  | 'tactical-sprinting'
  | 'crouching'
  | 'sliding'
  | 'prone'
  | 'climbing';

export class PlayerController {
  private readonly velocity = new THREE.Vector3();

  private readonly position = SPAWN_POSITION.clone();

  private yaw = 0;
  private pitch = 0;

  private onGround = false;

  private movementState: MovementState = 'walking';

  private currentHeight = PLAYER_HEIGHT;
  private targetHeight = PLAYER_HEIGHT;

  private slideTimer = 0;
  private tacticalSprintTimer = 0;

  /**
   * Simulation clock rather than performance.now().
   *
   * This makes tactical-sprint double-tapping deterministic in tests.
   */
  private simulationTime = 0;
  private lastSprintPressTime = -Infinity;

  private climbTimer = 0;
  private climbStartY = 0;
  private climbTargetY = 0;
  private climbDirection = new THREE.Vector3();

  private jumpPressed = false;

  private wasGrounded = false;
  private fallStartY = SPAWN_POSITION.y;
  private fallStartVelocityY = 0;

  private health = 100;

  private debugOverlayEnabled = false;

  private controlHeld = false;
  private shiftHeld = false;

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

  // ---------------------------------------------------------------------------
  // Public compatibility API
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
    return this.movementState === 'sliding';
  }

  get prone(): boolean {
    return this.movementState === 'prone';
  }

  get tacticalSprinting(): boolean {
    return this.movementState === 'tactical-sprinting';
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

  get isSliding(): boolean {
    return this.sliding;
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
        this.movementState === 'climbing',

      grounded: this.onGround,

      sprinting:
        this.movementState === 'sprinting' ||
        this.movementState === 'tactical-sprinting',

      health: this.health,

      debug: this.debugOverlayEnabled,
    };
  }

  // ---------------------------------------------------------------------------
  // Input
  // ---------------------------------------------------------------------------

  handleKey(code: string, pressed: boolean): boolean {
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
        if (pressed && !this.input.sprint) {
          this.shiftHeld = true;
          this.handleSprintPress();
        }

        if (!pressed) {
          this.shiftHeld = false;
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
      movementX * MOUSE_SENSITIVITY;

    this.pitch -=
      movementY * MOUSE_SENSITIVITY;

    this.pitch = THREE.MathUtils.clamp(
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
      this.movementState === 'climbing'
    ) {
      this.updateClimb(step);
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
        -18 * control * step
      );

    if (
      this.movementState === 'sliding'
    ) {
      this.updateSlideMovement(step);
    } else {
      this.velocity.x +=
        (targetX - this.velocity.x) *
        blend;

      this.velocity.z +=
        (targetZ - this.velocity.z) *
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

    this.syncCamera();
  }

  // ---------------------------------------------------------------------------
  // Sprint / tactical sprint
  // ---------------------------------------------------------------------------

  private handleSprintPress(): void {
    const elapsed =
      this.simulationTime -
      this.lastSprintPressTime;

    if (
      elapsed <=
      SPRINT_DOUBLE_TAP_WINDOW
    ) {
      if (
        this.onGround &&
        this.hasForwardMovement()
      ) {
        this.startTacticalSprint();
      }
    }

    this.lastSprintPressTime =
      this.simulationTime;
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

    this.targetHeight =
      PLAYER_HEIGHT;
  }

  // ---------------------------------------------------------------------------
  // Crouch / slide
  // ---------------------------------------------------------------------------

  private handleCrouchPress(): void {
    /*
     * C is deliberately press-based.
     *
     * Sprint + C:
     *   starts slide.
     *
     * Sliding + C:
     *   slide cancel.
     *
     * Walking + C:
     *   crouch.
     *
     * Crouching + C:
     *   stand.
     */

    if (
      this.movementState === 'sliding'
    ) {
      this.cancelSlide(false);
      return;
    }

    if (
      this.movementState === 'sprinting' ||
      this.movementState ===
        'tactical-sprinting'
    ) {
      this.startSlide();
      return;
    }

    if (
      this.movementState === 'prone'
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
      this.movementState === 'prone'
    ) {
      this.exitProne();
      return;
    }

    if (
      this.movementState === 'sliding'
    ) {
      this.cancelSlide(false);
    }

    this.tacticalSprintTimer = 0;

    this.movementState =
      'prone';

    this.targetHeight =
      PRONE_HEIGHT;

    this.velocity.y = 0;
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
  // Slide
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
      direction.x * slideSpeed;

    this.velocity.z =
      direction.z * slideSpeed;

    this.tacticalSprintTimer = 0;
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
  // Jump
  // ---------------------------------------------------------------------------

  private handleJump(): void {
    if (!this.jumpPressed) {
      return;
    }

    this.jumpPressed = false;

    /*
     * MW-style slide cancel:
     *
     * Slide -> Space
     * immediately exits slide and jumps.
     */
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

    /*
     * Space near a climbable wall/ledge
     * takes priority over normal jumping.
     */
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

    if (
      this.movementState ===
        'crouching' ||
      this.movementState ===
        'prone'
    ) {
      this.movementState =
        'walking';

      this.targetHeight =
        PLAYER_HEIGHT;
    }
  }

  // ---------------------------------------------------------------------------
  // Movement state
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
      return;
    }

    if (
      this.movementState ===
      'crouching'
    ) {
      /*
       * Crouch is an actual stance, but sprinting
       * can transition back into standing sprint.
       */
      if (
        this.input.sprint &&
        this.hasForwardMovement()
      ) {
        this.movementState =
          'sprinting';

        this.targetHeight =
          PLAYER_HEIGHT;
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

    if (
      this.movementState ===
        'sprinting' ||
      this.movementState ===
        'tactical-sprinting'
    ) {
      this.movementState =
        'walking';
    }
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
        return 0;

      default:
        return MOVE_SPEED;
    }
  }

  private hasForwardMovement(): boolean {
    return (
      this.input.forward &&
      !this.input.back
    );
  }

  // ---------------------------------------------------------------------------
  // Timers / stance
  // ---------------------------------------------------------------------------

  private updateTimers(
    step: number
  ): void {
    if (
      this.tacticalSprintTimer > 0
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
        this.movementState ===
          'sliding'
      ) {
        this.cancelSlide(false);
      }
    }
  }

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

    /*
     * position.y represents the player's eye/top origin.
     * Lowering the stance therefore moves the origin down
     * while keeping the feet planted.
     */
    this.position.y += change;

    this.updateBox();
  }

  // ---------------------------------------------------------------------------
  // Direction
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

  // ---------------------------------------------------------------------------
  // Climbing
  // ---------------------------------------------------------------------------

  private tryStartClimb(): boolean {
    if (!this.onGround) {
      return false;
    }

    if (
      this.movementState ===
        'sliding' ||
      this.movementState ===
        'prone'
    ) {
      return false;
    }

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

    /*
     * The player must be close to the obstacle.
     *
     * We test several points in front of the player rather than
     * requiring movement toward the wall.
     */
    const probeDistances = [
      0.65,
      0.9,
      1.15,
      CLIMB_DISTANCE,
    ];

    let bestCollider:
      Collider | undefined;

    let bestTop = -Infinity;

    for (
      const collider of this.colliders
    ) {
      const obstacleHeight =
        collider.max.y - feetY;

      if (
        obstacleHeight <
          CLIMB_MIN_HEIGHT ||
        obstacleHeight >
          CLIMB_MAX_HEIGHT
      ) {
        continue;
      }

      let nearWall = false;

      for (
        const distance of
          probeDistances
      ) {
        const probe =
          this.position.clone();

        probe.x +=
          direction.x *
          distance;

        probe.z +=
          direction.z *
          distance;

        const horizontalOverlap =
          probe.x >=
            collider.min.x -
              PLAYER_RADIUS &&
          probe.x <=
            collider.max.x +
              PLAYER_RADIUS &&
          probe.z >=
            collider.min.z -
              PLAYER_RADIUS &&
          probe.z <=
            collider.max.z +
              PLAYER_RADIUS;

        if (horizontalOverlap) {
          nearWall = true;
          break;
        }
      }

      if (
        !nearWall
      ) {
        continue;
      }

      /*
       * Don't allow climbing something that is behind us.
       */
      const center =
        new THREE.Vector3(
          (
            collider.min.x +
            collider.max.x
          ) * 0.5,

          collider.max.y,

          (
            collider.min.z +
            collider.max.z
          ) * 0.5
        );

      const toCenter =
        center.sub(
          this.position
        );

      toCenter.y = 0;

      if (
        toCenter.lengthSq() >
        0.001
      ) {
        toCenter.normalize();

        if (
          direction.dot(
            toCenter
          ) < -0.25
        ) {
          continue;
        }
      }

      if (
        collider.max.y >
        bestTop
      ) {
        bestTop =
          collider.max.y;

        bestCollider =
          collider;
      }
    }

    if (
      !bestCollider ||
      bestTop === -Infinity
    ) {
      return false;
    }

    const targetPosition =
      this.position.clone();

    targetPosition.x +=
      direction.x *
      (CLIMB_DISTANCE * 0.95);

    targetPosition.z +=
      direction.z *
      (CLIMB_DISTANCE * 0.95);

    const targetY =
      bestTop +
      PLAYER_HEIGHT;

    targetPosition.y =
      targetY;

    if (
      !this.canOccupyAt(
        targetPosition,
        PLAYER_HEIGHT
      )
    ) {
      /*
       * Try a slightly shorter forward displacement.
       */
      targetPosition.copy(
        this.position
      );

      targetPosition.x +=
        direction.x *
        (CLIMB_DISTANCE * 0.65);

      targetPosition.z +=
        direction.z *
        (CLIMB_DISTANCE * 0.65);

      targetPosition.y =
        targetY;

      if (
        !this.canOccupyAt(
          targetPosition,
          PLAYER_HEIGHT
        )
      ) {
        return false;
      }
    }

    this.movementState =
      'climbing';

    this.climbTimer =
      CLIMB_DURATION;

    this.climbStartY =
      this.position.y;

    this.climbTargetY =
      targetY;

    this.climbDirection.copy(
      direction
    );

    this.velocity.set(
      0,
      0,
      0
    );

    return true;
  }

  private updateClimb(
    step: number
  ): void {
    const previousTimer =
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

    const eased =
      progress *
      progress *
      (3 - 2 * progress);

    this.position.y =
      THREE.MathUtils.lerp(
        this.climbStartY,
        this.climbTargetY,
        eased
      );

    const forwardDistance =
      CLIMB_DISTANCE *
      0.95;

    const previousProgress =
      previousTimer <= 0
        ? 1
        : 1 -
          previousTimer /
            CLIMB_DURATION;

    const distanceThisFrame =
      (
        progress -
        previousProgress
      ) *
      forwardDistance;

    this.position.x +=
      this.climbDirection.x *
      distanceThisFrame;

    this.position.z +=
      this.climbDirection.z *
      distanceThisFrame;

    if (
      previousTimer > 0 &&
      this.climbTimer === 0
    ) {
      this.position.y =
        this.climbTargetY;

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

  // ---------------------------------------------------------------------------
  // Collision
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

  private moveAxis(
    axis: 'x' | 'y' | 'z',
    amount: number
  ): void {
    if (amount === 0) {
      return;
    }

    this.position[axis] +=
      amount;

    this.updateBox();

    for (
      const collider of
        this.colliders
    ) {
      if (
        !collider.intersectsBox(
          this.playerBox
        )
      ) {
        continue;
      }

      if (axis === 'y') {
        if (amount < 0) {
          this.position.y =
            collider.max.y +
            this.currentHeight +
            COLLISION_EPSILON;

          this.onGround = true;
        } else {
          this.position.y =
            collider.min.y -
            COLLISION_EPSILON;
        }

        this.velocity.y = 0;
      } else if (
        amount > 0
      ) {
        this.position[axis] =
          collider.min[axis] -
          PLAYER_RADIUS -
          COLLISION_EPSILON;

        this.velocity[axis] = 0;
      } else {
        this.position[axis] =
          collider.max[axis] +
          PLAYER_RADIUS +
          COLLISION_EPSILON;

        this.velocity[axis] = 0;
      }

      this.updateBox();
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
      !this.onGround &&
      this.wasGrounded
    ) {
      this.fallStartY =
        this.position.y;

      this.fallStartVelocityY =
        this.velocity.y;
    }

    this.wasGrounded =
      this.onGround;
  }

  private handleLanding(): void {
    if (
      !this.onGround
    ) {
      return;
    }

    if (
      this.wasGrounded
    ) {
      return;
    }

    const impactSpeed =
      Math.max(
        Math.abs(
          this.velocity.y
        ),
        Math.abs(
          this.fallStartVelocityY
        )
      );

    if (
      impactSpeed >
      FALL_SAFE_SPEED
    ) {
      const damage =
        THREE.MathUtils.clamp(
          (
            impactSpeed -
            FALL_SAFE_SPEED
          ) /
          (
            FALL_LETHAL_SPEED -
            FALL_SAFE_SPEED
          ) *
          FALL_MAX_DAMAGE,

          0,
          FALL_MAX_DAMAGE
        );

      this.health -= damage;

      if (
        this.health <= 0
      ) {
        this.respawn();
      }
    }

    this.fallStartVelocityY =
      0;
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

    this.slideTimer = 0;
    this.tacticalSprintTimer = 0;

    this.onGround = true;
    this.wasGrounded = true;

    this.health = 100;

    this.syncCamera();
  }

  // ---------------------------------------------------------------------------
  // Camera
  // ---------------------------------------------------------------------------

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