import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';

import { PlayerController } from './player-controller.js';

/** Steps the controller forward by a number of fixed frames. */
function simulate(player: PlayerController, seconds: number): void {
  const step = 1 / 60;

  for (let t = 0; t < seconds; t += step) {
    player.update(step);
  }
}

function makePlayer(colliders: THREE.Box3[] = []): PlayerController {
  return new PlayerController(
    new THREE.PerspectiveCamera(75, 1, 0.1, 500),
    colliders
  );
}

/**
 * Resolves the player's initial gravity/ground state.
 */
function settle(player: PlayerController): void {
  simulate(player, 1 / 60);
}

describe('PlayerController', () => {
  it('moves forward while W is held and stops accelerating when released', () => {
    const player = makePlayer();

    settle(player);

    const startZ = player.worldPosition.z;

    player.handleKey('KeyW', true);
    simulate(player, 0.5);

    const movedZ = player.worldPosition.z;

    expect(movedZ).toBeLessThan(startZ);

    player.handleKey('KeyW', false);
    simulate(player, 1);

    /*
     * The controller uses velocity smoothing, so the player may coast
     * slightly after releasing W. It should not continue moving indefinitely.
     */
    expect(Math.abs(player.worldPosition.z - movedZ)).toBeLessThan(1.5);
  });

  it('jumps from the ground and lands again under gravity', () => {
    const player = makePlayer();

    settle(player);

    const groundY = player.worldPosition.y;

    player.handleKey('Space', true);
    simulate(player, 1 / 60);

    player.handleKey('Space', false);

    simulate(player, 0.25);

    expect(player.worldPosition.y).toBeGreaterThan(groundY);

    simulate(player, 3);

    expect(player.grounded).toBe(true);
    expect(player.worldPosition.y).toBeCloseTo(groundY, 1);
  });

  it('does not repeatedly jump while Space is held', () => {
    const player = makePlayer();

    settle(player);

    const groundY = player.worldPosition.y;

    player.handleKey('Space', true);

    simulate(player, 0.2);

    const firstJumpHeight = player.worldPosition.y;

    /*
     * Space remains held, but the controller should only consume the
     * initial press once.
     */
    simulate(player, 0.2);

    expect(player.worldPosition.y).not.toBeGreaterThan(
      firstJumpHeight + 2
    );

    player.handleKey('Space', false);

    simulate(player, 3);

    expect(player.worldPosition.y).toBeCloseTo(groundY, 1);
  });

  it('is blocked by a collider instead of passing through it', () => {
    const wall = new THREE.Box3(
      new THREE.Vector3(-10, 0, -6),
      new THREE.Vector3(10, 4, -5)
    );

    const player = makePlayer([wall]);

    settle(player);

    player.handleKey('KeyW', true);
    simulate(player, 4);

    player.handleKey('KeyW', false);

    expect(player.worldPosition.z).toBeGreaterThan(
      wall.max.z
    );
  });

  it('lands on a staircase step instead of falling through it', () => {
    const lowerStep = new THREE.Box3(
      new THREE.Vector3(-3, 0, 15),
      new THREE.Vector3(3, 1.7, 30)
    );

    const upperStep = new THREE.Box3(
      new THREE.Vector3(-3, 0, 7),
      new THREE.Vector3(3, 2.6, 14)
    );

    const player = makePlayer([
      lowerStep,
      upperStep,
    ]);

    settle(player);

    expect(player.grounded).toBe(true);

    /*
     * Jump forward toward the upper step.
     */
    player.handleKey('KeyW', true);
    player.handleKey('Space', true);

    simulate(player, 1 / 60);

    player.handleKey('Space', false);

    simulate(player, 1.6);

    player.handleKey('KeyW', false);

    simulate(player, 1);

    expect(player.grounded).toBe(true);

    expect(player.worldPosition.y).toBeCloseTo(
      upperStep.max.y + 1.7,
      1
    );
  });

  it('moves faster while sprinting than while walking', () => {
    const walker = makePlayer();

    settle(walker);

    walker.handleKey('KeyW', true);
    simulate(walker, 1);

    const walkDistance = Math.abs(
      walker.worldPosition.z - 22
    );

    const sprinter = makePlayer();

    settle(sprinter);

    sprinter.handleKey('KeyW', true);
    sprinter.handleKey('ShiftLeft', true);

    simulate(sprinter, 1);

    const sprintDistance = Math.abs(
      sprinter.worldPosition.z - 22
    );

    expect(sprintDistance).toBeGreaterThan(
      walkDistance
    );
  });

  it('enters normal sprinting when Shift is held while moving forward', () => {
    const player = makePlayer();

    settle(player);

    player.handleKey('KeyW', true);
    player.handleKey('ShiftLeft', true);

    simulate(player, 0.25);

    expect(player.state).toBe('sprinting');
    expect(player.tacticalSprinting).toBe(false);
  });

  it('activates tactical sprint when Shift is double-tapped', () => {
    const player = makePlayer();

    settle(player);

    player.handleKey('KeyW', true);

    player.handleKey('ShiftLeft', true);
    player.handleKey('ShiftLeft', false);

    /*
     * A second press immediately after the first is inside the
     * tactical sprint double-tap window.
     */
    player.handleKey('ShiftLeft', true);

    simulate(player, 1 / 60);

    expect(player.tacticalSprinting).toBe(true);
    expect(player.state).toBe('tactical-sprinting');
  });

  it('automatically falls back to normal sprint after tactical sprint expires', () => {
    const player = makePlayer();

    settle(player);

    player.handleKey('KeyW', true);

    player.handleKey('ShiftLeft', true);
    player.handleKey('ShiftLeft', false);
    player.handleKey('ShiftLeft', true);

    simulate(player, 1 / 60);

    expect(player.tacticalSprinting).toBe(true);

    simulate(player, 1.25);

    expect(player.tacticalSprinting).toBe(false);
    expect(player.state).toBe('sprinting');
  });

  it('does not activate tactical sprint without forward movement', () => {
    const player = makePlayer();

    settle(player);

    player.handleKey('ShiftLeft', true);
    player.handleKey('ShiftLeft', false);
    player.handleKey('ShiftLeft', true);

    simulate(player, 0.1);

    expect(player.tacticalSprinting).toBe(false);
  });

  it('enters crouch when C is pressed without sprinting', () => {
    const player = makePlayer();

    settle(player);

    player.handleKey('KeyC', true);
    simulate(player, 0.1);

    expect(player.state).toBe('crouching');
    expect(player.height).toBeLessThan(1.7);
  });

  it('toggles crouch back to standing when C is pressed again', () => {
    const player = makePlayer();

    settle(player);

    player.handleKey('KeyC', true);
    player.handleKey('KeyC', false);

    simulate(player, 0.1);

    expect(player.state).toBe('crouching');

    player.handleKey('KeyC', true);
    player.handleKey('KeyC', false);

    simulate(player, 0.2);

    expect(player.state).toBe('walking');
    expect(player.height).toBeCloseTo(1.7, 1);
  });

  it('starts a slide by tapping C while sprinting', () => {
    const player = makePlayer();

    settle(player);

    player.handleKey('KeyW', true);
    player.handleKey('ShiftLeft', true);

    simulate(player, 0.5);

    expect(player.state).toBe('sprinting');

    player.handleKey('KeyC', true);
    player.handleKey('KeyC', false);

    simulate(player, 1 / 60);

    expect(player.sliding).toBe(true);
    expect(player.state).toBe('sliding');
  });

  it('starts a slide from tactical sprint', () => {
    const player = makePlayer();

    settle(player);

    player.handleKey('KeyW', true);

    player.handleKey('ShiftLeft', true);
    player.handleKey('ShiftLeft', false);
    player.handleKey('ShiftLeft', true);

    simulate(player, 1 / 60);

    expect(player.tacticalSprinting).toBe(true);

    player.handleKey('KeyC', true);
    player.handleKey('KeyC', false);

    simulate(player, 1 / 60);

    expect(player.sliding).toBe(true);
  });

  it('does not require C to remain held during a slide', () => {
    const player = makePlayer();

    settle(player);

    player.handleKey('KeyW', true);
    player.handleKey('ShiftLeft', true);

    simulate(player, 0.5);

    player.handleKey('KeyC', true);
    player.handleKey('KeyC', false);

    simulate(player, 0.2);

    expect(player.sliding).toBe(true);

    /*
     * C is no longer held, but the slide remains active.
     */
    simulate(player, 0.2);

    expect(player.sliding).toBe(true);
  });

  it('naturally exits the slide after the slide duration', () => {
    const player = makePlayer();

    settle(player);

    player.handleKey('KeyW', true);
    player.handleKey('ShiftLeft', true);

    simulate(player, 0.5);

    player.handleKey('KeyC', true);
    player.handleKey('KeyC', false);

    simulate(player, 1 / 60);

    expect(player.sliding).toBe(true);

    simulate(player, 1);

    expect(player.sliding).toBe(false);
  });

  it('slide-cancels when C is tapped during a slide', () => {
    const player = makePlayer();

    settle(player);

    player.handleKey('KeyW', true);
    player.handleKey('ShiftLeft', true);

    simulate(player, 0.5);

    player.handleKey('KeyC', true);
    player.handleKey('KeyC', false);

    simulate(player, 1 / 60);

    expect(player.sliding).toBe(true);

    player.handleKey('KeyC', true);
    player.handleKey('KeyC', false);

    simulate(player, 1 / 60);

    expect(player.sliding).toBe(false);
  });

  it('slide-cancels and jumps when Space is pressed during a slide', () => {
    const player = makePlayer();

    settle(player);

    player.handleKey('KeyW', true);
    player.handleKey('ShiftLeft', true);

    simulate(player, 0.5);

    player.handleKey('KeyC', true);
    player.handleKey('KeyC', false);

    simulate(player, 1 / 60);

    expect(player.sliding).toBe(true);

    const slideCancelY = player.worldPosition.y;

    player.handleKey('Space', true);
    simulate(player, 1 / 60);
    player.handleKey('Space', false);

    expect(player.sliding).toBe(false);

    simulate(player, 0.1);

    expect(player.worldPosition.y).toBeGreaterThan(
      slideCancelY
    );
  });

  it('preserves horizontal momentum when slide-canceling', () => {
    const player = makePlayer();

    settle(player);

    player.handleKey('KeyW', true);
    player.handleKey('ShiftLeft', true);

    simulate(player, 0.5);

    player.handleKey('KeyC', true);
    player.handleKey('KeyC', false);

    simulate(player, 1 / 60);

    expect(player.sliding).toBe(true);

    const beforeCancelZ = player.worldPosition.z;

    player.handleKey('KeyC', true);
    player.handleKey('KeyC', false);

    simulate(player, 0.1);

    expect(player.worldPosition.z).toBeLessThan(
      beforeCancelZ
    );
  });

  it('enters prone when X is pressed', () => {
    const player = makePlayer();

    settle(player);

    player.handleKey('KeyX', true);
    player.handleKey('KeyX', false);

    simulate(player, 0.2);

    expect(player.prone).toBe(true);
    expect(player.state).toBe('prone');
    expect(player.height).toBeLessThan(1.0);
  });

  it('toggles out of prone when X is pressed again', () => {
    const player = makePlayer();

    settle(player);

    player.handleKey('KeyX', true);
    player.handleKey('KeyX', false);

    simulate(player, 0.2);

    expect(player.prone).toBe(true);

    player.handleKey('KeyX', true);
    player.handleKey('KeyX', false);

    simulate(player, 0.2);

    expect(player.prone).toBe(false);
    expect(player.state).toBe('walking');
  });

  it('allows C to exit prone', () => {
    const player = makePlayer();

    settle(player);

    player.handleKey('KeyX', true);
    player.handleKey('KeyX', false);

    simulate(player, 0.2);

    expect(player.prone).toBe(true);

    player.handleKey('KeyC', true);
    player.handleKey('KeyC', false);

    simulate(player, 0.2);

    expect(player.prone).toBe(false);
  });

  it('does not allow X to enter prone while airborne', () => {
    const player = makePlayer();

    settle(player);

    player.handleKey('Space', true);
    simulate(player, 1 / 60);
    player.handleKey('Space', false);

    player.handleKey('KeyX', true);
    player.handleKey('KeyX', false);

    simulate(player, 0.1);

    expect(player.prone).toBe(false);
  });

  it('does not climb simply by walking into a climbable wall', () => {
    const wall = new THREE.Box3(
      new THREE.Vector3(-3, 0, -5),
      new THREE.Vector3(3, 2, -4)
    );

    const player = makePlayer([wall]);

    settle(player);

    player.handleKey('KeyW', true);
    simulate(player, 4);

    player.handleKey('KeyW', false);

    /*
     * Walking into the wall should leave us on the near side.
     * Climbing requires an explicit Space press.
     */
    expect(player.state).not.toBe('climbing');
    expect(player.worldPosition.z).toBeGreaterThan(wall.max.z);
  });

  it('climbs when Space is pressed near a climbable wall', () => {
    const wall = new THREE.Box3(
      new THREE.Vector3(-3, 0, -5),
      new THREE.Vector3(3, 2, -4)
    );

    const player = makePlayer([wall]);

    settle(player);

    /*
     * Approach the wall without pressing Space.
     */
    player.handleKey('KeyW', true);
    simulate(player, 4);
    player.handleKey('KeyW', false);

    expect(player.state).not.toBe('climbing');
    expect(player.worldPosition.z).toBeGreaterThan(wall.max.z);

    const beforeClimbY = player.worldPosition.y;

    /*
     * Explicit Space input triggers the mantle.
     */
    player.handleKey('Space', true);
    simulate(player, 1 / 60);
    player.handleKey('Space', false);

    expect(player.state).toBe('climbing');

    simulate(player, 0.4);

    expect(player.state).not.toBe('climbing');
    expect(player.worldPosition.y).toBeGreaterThan(
      beforeClimbY
    );
  });

  it('uses Space for a normal jump when no climbable wall is nearby', () => {
    const player = makePlayer();

    settle(player);

    const groundY = player.worldPosition.y;

    player.handleKey('Space', true);
    simulate(player, 1 / 60);
    player.handleKey('Space', false);

    simulate(player, 0.2);

    expect(player.state).not.toBe('climbing');
    expect(player.worldPosition.y).toBeGreaterThan(
      groundY
    );
  });

  it('does not climb an obstacle that is too tall', () => {
    const wall = new THREE.Box3(
      new THREE.Vector3(-3, 0, -5),
      new THREE.Vector3(3, 4, -4)
    );

    const player = makePlayer([wall]);

    settle(player);

    player.handleKey('KeyW', true);
    simulate(player, 4);
    player.handleKey('KeyW', false);

    const beforeY = player.worldPosition.y;

    player.handleKey('Space', true);
    simulate(player, 1 / 60);
    player.handleKey('Space', false);

    expect(player.state).not.toBe('climbing');

    simulate(player, 0.2);

    expect(player.worldPosition.y).toBeGreaterThanOrEqual(
      beforeY
    );
  });

  it('clears movement input when releaseKeys is called', () => {
    const player = makePlayer();

    settle(player);

    player.handleKey('KeyW', true);
    player.handleKey('ShiftLeft', true);

    simulate(player, 0.5);

    const zAfterSprint = player.worldPosition.z;

    player.releaseKeys();

    simulate(player, 1);

    /*
     * The controller may coast due to velocity smoothing, but it should
     * not continue receiving forward input.
     */
    expect(player.worldPosition.z).toBeGreaterThan(
      zAfterSprint - 1.5
    );
  });

  it('updates camera orientation when mouse look is applied', () => {
    const camera = new THREE.PerspectiveCamera(
      75,
      1,
      0.1,
      500
    );

    const player = new PlayerController(camera, []);

    const initialRotationY = camera.rotation.y;

    player.handleLook(100, 0);
    player.update(1 / 60);

    expect(camera.rotation.y).not.toBe(
      initialRotationY
    );
  });
});