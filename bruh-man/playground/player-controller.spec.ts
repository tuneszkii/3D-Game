import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { PlayerController } from './player-controller.js';

function simulate(
  player: PlayerController,
  seconds: number
): void {
  const step = 1 / 60;

  for (
    let t = 0;
    t < seconds;
    t += step
  ) {
    player.update(step);
  }
}

function press(
  player: PlayerController,
  code: string
): void {
  player.handleKey(code, true);
  player.handleKey(code, false);
}

describe('PlayerController', () => {
  const makePlayer = (
    colliders: THREE.Box3[] = []
  ) =>
    new PlayerController(
      new THREE.PerspectiveCamera(
        75,
        1,
        0.1,
        500
      ),
      colliders
    );

  it('moves forward while W is held and stops when released', () => {
    const player = makePlayer();

    const startZ =
      player.worldPosition.z;

    player.handleKey(
      'KeyW',
      true
    );

    simulate(player, 0.5);

    const movedZ =
      player.worldPosition.z;

    expect(movedZ).toBeLessThan(
      startZ
    );

    player.handleKey(
      'KeyW',
      false
    );

    simulate(player, 1);

    expect(
      Math.abs(
        player.worldPosition.z -
          movedZ
      )
    ).toBeLessThan(0.6);
  });

  it('jumps off the ground and lands back down under gravity', () => {
    const player = makePlayer();

    simulate(player, 0.2);

    const groundY =
      player.worldPosition.y;

    press(player, 'Space');

    simulate(player, 0.25);

    expect(
      player.worldPosition.y
    ).toBeGreaterThan(
      groundY
    );

    simulate(player, 3);

    expect(
      player.worldPosition.y
    ).toBeCloseTo(
      groundY,
      1
    );

    expect(
      player.grounded
    ).toBe(true);
  });

  it('is blocked by a collider instead of passing through it', () => {
    const wall =
      new THREE.Box3(
        new THREE.Vector3(
          -10,
          0,
          -6
        ),
        new THREE.Vector3(
          10,
          4,
          -5
        )
      );

    const player =
      makePlayer([wall]);

    player.handleKey(
      'KeyW',
      true
    );

    simulate(player, 4);

    expect(
      player.worldPosition.z
    ).toBeGreaterThan(
      wall.max.z
    );
  });

  it('lands on the next staircase step', () => {
    const lowerStep =
      new THREE.Box3(
        new THREE.Vector3(
          -3,
          0,
          15
        ),
        new THREE.Vector3(
          3,
          1.7,
          30
        )
      );

    const upperStep =
      new THREE.Box3(
        new THREE.Vector3(
          -3,
          0,
          7
        ),
        new THREE.Vector3(
          3,
          2.6,
          14
        )
      );

    const player =
      makePlayer([
        lowerStep,
        upperStep,
      ]);

    simulate(
      player,
      1 / 60
    );

    expect(
      player.grounded
    ).toBe(true);

    player.handleKey(
      'KeyW',
      true
    );

    press(
      player,
      'Space'
    );

    simulate(
      player,
      1.6
    );

    player.handleKey(
      'KeyW',
      false
    );

    simulate(
      player,
      1.5
    );

    expect(
      player.grounded
    ).toBe(true);

    expect(
      player.worldPosition.y
    ).toBeCloseTo(
      upperStep.max.y +
        1.7,
      1
    );
  });

  it('sprints faster than normal walking', () => {
    const walker =
      makePlayer();

    walker.handleKey(
      'KeyW',
      true
    );

    simulate(
      walker,
      1
    );

    const sprinter =
      makePlayer();

    sprinter.handleKey(
      'KeyW',
      true
    );

    sprinter.handleKey(
      'ShiftLeft',
      true
    );

    simulate(
      sprinter,
      1
    );

    expect(
      sprinter.toSnapshot().speed
    ).toBeGreaterThan(
      walker.toSnapshot().speed
    );
  });

  it('crouches when C is pressed', () => {
    const player =
      makePlayer();

    simulate(
      player,
      1 / 60
    );

    press(
      player,
      'KeyC'
    );

    simulate(
      player,
      0.25
    );

    expect(
      player.currentStance
    ).toBe('crouch');

    expect(
      player.worldPosition.y
    ).toBeLessThan(1.7);

    expect(
      player.height
    ).toBeCloseTo(
      1.15,
      1
    );
  });

  it('stands back up when C is pressed again', () => {
    const player =
      makePlayer();

    simulate(
      player,
      1 / 60
    );

    press(
      player,
      'KeyC'
    );

    simulate(
      player,
      0.25
    );

    expect(
      player.currentStance
    ).toBe('crouch');

    press(
      player,
      'KeyC'
    );

    simulate(
      player,
      0.25
    );

    expect(
      player.currentStance
    ).toBe('stand');
  });

  it('goes prone when X is pressed', () => {
    const player =
      makePlayer();

    simulate(
      player,
      1 / 60
    );

    press(
      player,
      'KeyX'
    );

    simulate(
      player,
      0.5
    );

    expect(
      player.currentStance
    ).toBe('prone');

    expect(
      player.height
    ).toBeCloseTo(
      0.55,
      1
    );
  });

  it('X toggles back out of prone', () => {
    const player =
      makePlayer();

    simulate(
      player,
      1 / 60
    );

    press(
      player,
      'KeyX'
    );

    simulate(
      player,
      0.5
    );

    expect(
      player.currentStance
    ).toBe('prone');

    press(
      player,
      'KeyX'
    );

    simulate(
      player,
      0.5
    );

    expect(
      player.currentStance
    ).toBe('stand');
  });

  it('starts a slide by pressing C while sprinting', () => {
    const player =
      makePlayer();

    player.handleKey(
      'KeyW',
      true
    );

    player.handleKey(
      'ShiftLeft',
      true
    );

    simulate(
      player,
      0.5
    );

    expect(
      player.state
    ).toBe('sprinting');

    press(
      player,
      'KeyC'
    );

    simulate(
      player,
      1 / 60
    );

    expect(
      player.isSliding
    ).toBe(true);

    expect(
      player.currentStance
    ).toBe('crouch');
  });

  it('slide-cancels when C is pressed again', () => {
    const player =
      makePlayer();

    player.handleKey(
      'KeyW',
      true
    );

    player.handleKey(
      'ShiftLeft',
      true
    );

    simulate(
      player,
      0.5
    );

    press(
      player,
      'KeyC'
    );

    simulate(
      player,
      1 / 60
    );

    expect(
      player.isSliding
    ).toBe(true);

    press(
      player,
      'KeyC'
    );

    simulate(
      player,
      1 / 60
    );

    expect(
      player.isSliding
    ).toBe(false);
  });

  it('slide-cancels and jumps when Space is pressed', () => {
    const player =
      makePlayer();

    player.handleKey(
      'KeyW',
      true
    );

    player.handleKey(
      'ShiftLeft',
      true
    );

    simulate(
      player,
      0.5
    );

    press(
      player,
      'KeyC'
    );

    simulate(
      player,
      1 / 60
    );

    expect(
      player.isSliding
    ).toBe(true);

    press(
      player,
      'Space'
    );

    simulate(
      player,
      1 / 60
    );

    expect(
      player.isSliding
    ).toBe(false);

    expect(
      player.grounded
    ).toBe(false);

    expect(
      player.worldPosition.y
    ).toBeGreaterThan(
      1.15
    );
  });

  it('tactical sprints after a quick double-tap of Shift', () => {
    const player =
      makePlayer();

    simulate(
      player,
      1 / 60
    );

    player.handleKey(
      'KeyW',
      true
    );

    player.handleKey(
      'ShiftLeft',
      true
    );

    player.handleKey(
      'ShiftLeft',
      false
    );

    simulate(
      player,
      0.1
    );

    player.handleKey(
      'ShiftLeft',
      true
    );

    expect(
      player.tacticalSprinting
    ).toBe(true);

    expect(
      player.state
    ).toBe(
      'tactical-sprinting'
    );
  });

  it('does not tactical sprint after a slow Shift double-tap', () => {
    const player =
      makePlayer();

    simulate(
      player,
      1 / 60
    );

    player.handleKey(
      'KeyW',
      true
    );

    player.handleKey(
      'ShiftLeft',
      true
    );

    player.handleKey(
      'ShiftLeft',
      false
    );

    simulate(
      player,
      0.5
    );

    player.handleKey(
      'ShiftLeft',
      true
    );

    expect(
      player.tacticalSprinting
    ).toBe(false);
  });

  it('Space near a climbable ledge starts a climb without walking into it', () => {
    const ledge =
      new THREE.Box3(
        new THREE.Vector3(
          -3,
          0,
          20
        ),
        new THREE.Vector3(
          3,
          2,
          21
        )
      );

    const player =
      makePlayer([
        ledge
      ]);

    /*
     * Spawn is at z=22, so the player is already
     * close to the ledge. No W input is required.
     */
    simulate(
      player,
      1 / 60
    );

    expect(
      player.grounded
    ).toBe(true);

    press(
      player,
      'Space'
    );

    simulate(
      player,
      1 / 60
    );

    expect(
      player.state
    ).toBe('climbing');
  });

  it('does not climb a wall that is too high', () => {
    const wall =
      new THREE.Box3(
        new THREE.Vector3(
          -3,
          0,
          20
        ),
        new THREE.Vector3(
          3,
          4,
          21
        )
      );

    const player =
      makePlayer([
        wall
      ]);

    simulate(
      player,
      1 / 60
    );

    press(
      player,
      'Space'
    );

    simulate(
      player,
      1 / 60
    );

    expect(
      player.state
    ).not.toBe(
      'climbing'
    );
  });

  it('takes fall damage from a moderate fall', () => {
    const player =
      makePlayer();

    player.worldPosition.set(
      0,
      1.7 + 6,
      0
    );

    simulate(
      player,
      2
    );

    expect(
      player.currentHealth
    ).toBeLessThan(100);

    expect(
      player.currentHealth
    ).toBeGreaterThan(0);
  });

  it('does not take damage from a normal jump', () => {
    const player =
      makePlayer();

    simulate(
      player,
      1 / 60
    );

    press(
      player,
      'Space'
    );

    simulate(
      player,
      2
    );

    expect(
      player.currentHealth
    ).toBe(100);
  });

  it('respawns at full health after a lethal fall', () => {
    const player =
      makePlayer();

    player.worldPosition.set(
      0,
      60,
      0
    );

    simulate(
      player,
      4
    );

    expect(
      player.currentHealth
    ).toBe(100);

    expect(
      player.worldPosition.y
    ).toBeCloseTo(
      1.7,
      1
    );
  });

  it('toggles debug only with Ctrl+Shift+B', () => {
    const player =
      makePlayer();

    expect(
      player.handleKey(
        'KeyB',
        true
      )
    ).toBe(false);

    expect(
      player.debugEnabled
    ).toBe(false);

    player.handleKey(
      'ControlLeft',
      true
    );

    player.handleKey(
      'ShiftLeft',
      true
    );

    expect(
      player.handleKey(
        'KeyB',
        true
      )
    ).toBe(true);

    expect(
      player.debugEnabled
    ).toBe(true);

    expect(
      player.handleKey(
        'KeyB',
        true
      )
    ).toBe(true);

    expect(
      player.debugEnabled
    ).toBe(false);
  });

  it('produces a complete snapshot for the scene HUD', () => {
    const player =
      makePlayer();

    simulate(
      player,
      1 / 60
    );

    const snapshot =
      player.toSnapshot();

    expect(
      snapshot.position
    ).toEqual({
      x: expect.any(Number),
      y: expect.any(Number),
      z: expect.any(Number),
    });

    expect(
      snapshot.velocity
    ).toEqual({
      x: expect.any(Number),
      y: expect.any(Number),
      z: expect.any(Number),
    });

    expect(
      snapshot.stance
    ).toBe('stand');

    expect(
      snapshot.health
    ).toBe(100);
  });
});