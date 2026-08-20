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

  it('starts in walking state', () => {
    const player =
      makePlayer();

    simulate(
      player,
      1 / 60
    );

    expect(
      player.state
    ).toBe('walking');
  });

  it('moves forward while W is held', () => {
    const player =
      makePlayer();

    const startZ =
      player.worldPosition.z;

    player.handleKey(
      'KeyW',
      true
    );

    simulate(
      player,
      0.5
    );

    expect(
      player.worldPosition.z
    ).toBeLessThan(
      startZ
    );

    expect(
      player.state
    ).toBe('walking');
  });

  it('returns to walking when movement stops', () => {
    const player =
      makePlayer();

    player.handleKey(
      'KeyW',
      true
    );

    simulate(
      player,
      0.5
    );

    player.handleKey(
      'KeyW',
      false
    );

    simulate(
      player,
      0.2
    );

    expect(
      player.state
    ).toBe('walking');
  });

  it('enters in-air state when jumping', () => {
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
      1 / 60
    );

    expect(
      player.state
    ).toBe('in-air');

    expect(
      player.grounded
    ).toBe(false);
  });

  it('lands and returns from in-air to walking', () => {
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
      player.grounded
    ).toBe(true);

    expect(
      player.state
    ).toBe('walking');
  });

  it('is blocked by a collider', () => {
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

    simulate(
      player,
      4
    );

    expect(
      player.worldPosition.z
    ).toBeGreaterThan(
      wall.max.z
    );
  });

  it('lands on the upper staircase step', () => {
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

  it('sprints faster than walking', () => {
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

    expect(
      sprinter.state
    ).toBe('sprinting');
  });

  it('tactical sprints after Shift is double-tapped', () => {
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

  it('tactical sprint uses the tactical sprint speed', () => {
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

    simulate(
      player,
      0.25
    );

    expect(
      player.state
    ).toBe(
      'tactical-sprinting'
    );

    expect(
      player.toSnapshot().speed
    ).toBeGreaterThan(
      20
    );
  });

  it('does not tactical sprint after a slow double tap', () => {
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

  it('C toggles crouch without holding the key', () => {
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
      player.height
    ).toBeCloseTo(
      1.15,
      1
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
    ).toBe('stand');
  });

  it('X enters prone', () => {
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
      player.state
    ).toBe('prone');

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

  it('X exits prone', () => {
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

    press(
      player,
      'KeyX'
    );

    simulate(
      player,
      0.5
    );

    expect(
      player.state
    ).toBe('walking');

    expect(
      player.currentStance
    ).toBe('stand');
  });

  it('starts a slide with Sprint + C', () => {
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
      player.state
    ).toBe('sliding');

    expect(
      player.isSliding
    ).toBe(true);
  });

  it('slide-cancels with C', () => {
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

  it('slide-cancels and jumps with Space', () => {
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
      player.state
    ).toBe('in-air');

    expect(
      player.grounded
    ).toBe(false);
  });

  it('Space near a climbable obstacle starts a mantle without W', () => {
    /**
     * Spawn is z=22.
     *
     * The obstacle occupies z=20..21,
     * putting the player immediately adjacent
     * to its front face.
     */
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
      makePlayer([ledge]);

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

  it('does not mantle an obstacle that is too high', () => {
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
      makePlayer([wall]);

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

  it('finishes a mantle on top of the obstacle', () => {
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
      makePlayer([ledge]);

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
    ).toBe('climbing');

    simulate(
      player,
      1
    );

    expect(
      player.state
    ).toBe('walking');

    expect(
      player.worldPosition.y
    ).toBeCloseTo(
      ledge.max.y +
        1.7,
      1
    );
  });

  it('takes moderate fall damage', () => {
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

  it('does not damage a normal jump', () => {
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

  it('respawns after a lethal fall', () => {
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

  it('returns a complete HUD snapshot', () => {
    const player =
      makePlayer();

    const snapshot =
      player.toSnapshot();

    expect(
      snapshot.position
    ).toBeDefined();

    expect(
      snapshot.velocity
    ).toBeDefined();

    expect(
      typeof snapshot.speed
    ).toBe('number');

    expect(
      snapshot.stance
    ).toBe('stand');

    expect(
      snapshot.sliding
    ).toBe(false);

    expect(
      snapshot.climbing
    ).toBe(false);

    expect(
      snapshot.grounded
    ).toBe(false);

    expect(
      snapshot.sprinting
    ).toBe(false);

    expect(
      snapshot.health
    ).toBe(100);

    expect(
      snapshot.debug
    ).toBe(false);
  });
});