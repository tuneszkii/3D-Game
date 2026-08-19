import * as THREE from 'three';
import type { Collider } from './world.js';

const PLAYER_HEIGHT = 1.7;
const PLAYER_RADIUS = 0.35;
const MOVE_SPEED = 7.5;
const AIR_CONTROL = 0.45;
const GRAVITY = 24;
const JUMP_VELOCITY = 8.2;
const MOUSE_SENSITIVITY = 0.0022;
const MAX_PITCH = Math.PI / 2 - 0.05;

/** Keys the controller reacts to. */
export type InputState = {
  forward: boolean;
  back: boolean;
  left: boolean;
  right: boolean;
  jump: boolean;
};

/**
 * First-person player controller: WASD movement, space to jump,
 * mouse-look via pointer lock, gravity and AABB collision resolution.
 */
export class PlayerController {
  private readonly velocity = new THREE.Vector3();
  private readonly position = new THREE.Vector3(0, PLAYER_HEIGHT, 22);
  private yaw = 0;
  private pitch = 0;
  private onGround = false;
  private readonly input: InputState = {
    forward: false,
    back: false,
    left: false,
    right: false,
    jump: false,
  };
  private readonly playerBox = new THREE.Box3();

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

  /** Current world position of the player's feet-to-eye origin. */
  get worldPosition(): THREE.Vector3 {
    return this.position;
  }

  /** Handles a keydown/keyup event. */
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
      case 'Space':
        this.input.jump = pressed;
        break;
      default:
        break;
    }
  }

  /** Applies relative mouse movement to the camera orientation. */
  handleLook(movementX: number, movementY: number): void {
    this.yaw -= movementX * MOUSE_SENSITIVITY;
    this.pitch -= movementY * MOUSE_SENSITIVITY;
    this.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, this.pitch));
  }

  /** Clears all held keys — used when pointer lock is released. */
  releaseKeys(): void {
    this.input.forward = false;
    this.input.back = false;
    this.input.left = false;
    this.input.right = false;
    this.input.jump = false;
  }

  /**
   * Advances the simulation.
   *
   * @param delta seconds elapsed since the previous frame.
   */
  update(delta: number): void {
    const step = Math.min(delta, 0.05);

    const wish = new THREE.Vector3(
      Number(this.input.right) - Number(this.input.left),
      0,
      Number(this.input.back) - Number(this.input.forward)
    );
    if (wish.lengthSq() > 0) wish.normalize();
    wish.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw);

    const control = this.onGround ? 1 : AIR_CONTROL;
    const targetX = wish.x * MOVE_SPEED;
    const targetZ = wish.z * MOVE_SPEED;
    const blend = 1 - Math.exp(-18 * control * step);
    this.velocity.x += (targetX - this.velocity.x) * blend;
    this.velocity.z += (targetZ - this.velocity.z) * blend;

    if (this.input.jump && this.onGround) {
      this.velocity.y = JUMP_VELOCITY;
      this.onGround = false;
    }

    this.velocity.y -= GRAVITY * step;

    this.onGround = false;
    this.moveAxis('y', this.velocity.y * step);
    this.moveAxis('x', this.velocity.x * step);
    this.moveAxis('z', this.velocity.z * step);

    if (this.position.y < PLAYER_HEIGHT) {
      this.position.y = PLAYER_HEIGHT;
      this.velocity.y = 0;
      this.onGround = true;
    }

    this.syncCamera();
  }

  /** Moves along one axis and resolves any collision on that axis. */
  private moveAxis(axis: 'x' | 'y' | 'z', amount: number): void {
    if (amount === 0) return;
    this.position[axis] += amount;
    this.updateBox();

    for (const box of this.colliders) {
      if (!box.intersectsBox(this.playerBox)) continue;
      if (axis === 'y') {
        if (amount < 0) {
          this.position.y = box.max.y + PLAYER_HEIGHT + 0.01;
          this.onGround = true;
        } else {
          this.position.y = box.min.y - 0.01;
        }
        this.velocity.y = 0;
      } else if (amount > 0) {
        this.position[axis] = box.min[axis] - PLAYER_RADIUS - 0.001;
        this.velocity[axis] = 0;
      } else {
        this.position[axis] = box.max[axis] + PLAYER_RADIUS + 0.001;
        this.velocity[axis] = 0;
      }
      this.updateBox();
    }
  }

  /** Recomputes the player's AABB from the current position. */
  private updateBox(): void {
    this.playerBox.min.set(
      this.position.x - PLAYER_RADIUS,
      this.position.y - PLAYER_HEIGHT,
      this.position.z - PLAYER_RADIUS
    );
    this.playerBox.max.set(
      this.position.x + PLAYER_RADIUS,
      this.position.y,
      this.position.z + PLAYER_RADIUS
    );
  }

  /** Applies position and orientation to the camera. */
  private syncCamera(): void {
    this.camera.position.copy(this.position);
    this.camera.rotation.set(0, 0, 0);
    this.camera.rotateY(this.yaw);
    this.camera.rotateX(this.pitch);
  }
}
