import * as THREE from 'three';
import { PlayerController } from './player-controller.js';

/** Steps the controller forward by a number of fixed frames. */
function simulate(player: PlayerController, seconds: number): void {
  const step = 1 / 60;
  for (let t = 0; t < seconds; t += step) player.update(step);
}

describe('PlayerController', () => {
  const makePlayer = (colliders: THREE.Box3[] = []) =>
    new PlayerController(new THREE.PerspectiveCamera(75, 1, 0.1, 500), colliders);

  it('moves forward while W is held and stops when released', () => {
    const player = makePlayer();
    const startZ = player.worldPosition.z;

    player.handleKey('KeyW', true);
    simulate(player, 0.5);
    const movedZ = player.worldPosition.z;
    expect(movedZ).toBeLessThan(startZ);

    player.handleKey('KeyW', false);
    simulate(player, 1);
    expect(Math.abs(player.worldPosition.z - movedZ)).toBeLessThan(0.6);
  });

  it('jumps off the ground and lands back down under gravity', () => {
    const player = makePlayer();
    simulate(player, 0.2);
    const groundY = player.worldPosition.y;

    player.handleKey('Space', true);
    simulate(player, 0.25);
    expect(player.worldPosition.y).toBeGreaterThan(groundY);

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

    player.handleKey('KeyW', true);
    simulate(player, 4);

    expect(player.worldPosition.z).toBeGreaterThan(wall.max.z);
  });

  it('lands on the next staircase step instead of falling through to the ground', () => {
    // Mimics two adjacent staircase steps: the player starts on the lower
    // one (its footprint includes the spawn point) and must hop a small
    // gap onto the next, slightly taller step.
    const lowerStep = new THREE.Box3(
      new THREE.Vector3(-3, 0, 15),
      new THREE.Vector3(3, 1.7, 30)
    );
    const upperStep = new THREE.Box3(
      new THREE.Vector3(-3, 0, 7),
      new THREE.Vector3(3, 2.6, 14)
    );
    const player = makePlayer([lowerStep, upperStep]);

    // First frame resolves the player onto the lower step it spawns on.
    simulate(player, 1 / 60);
    expect(player.grounded).toBe(true);

    player.handleKey('KeyW', true);
    player.handleKey('Space', true);
    simulate(player, 1.6);
    player.handleKey('KeyW', false);
    player.handleKey('Space', false);
    simulate(player, 1.5);

    expect(player.grounded).toBe(true);
    expect(player.worldPosition.y).toBeCloseTo(upperStep.max.y + 1.7, 1);
  });
});
