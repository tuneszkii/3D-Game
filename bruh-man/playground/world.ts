import * as THREE from 'three';

/**
 * A static axis-aligned collider in the world.
 */
export type Collider = THREE.Box3;

/**
 * The result of building the playground world.
 */
export type World = {
  /** The three.js scene holding all meshes and lights. */
  scene: THREE.Scene;
  /** Axis-aligned boxes the player collides against. */
  colliders: Collider[];
  /** Ground level (y) the player stands on. */
  groundY: number;
};

/** Adds a box mesh to the scene and registers it as a collider. */
function addBox(
  scene: THREE.Scene,
  colliders: Collider[],
  size: [number, number, number],
  position: [number, number, number],
  color: number
): THREE.Mesh {
  const geometry = new THREE.BoxGeometry(size[0], size[1], size[2]);
  const material = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.55,
    metalness: 0.05,
    emissive: new THREE.Color(color).multiplyScalar(0.18),
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(position[0], position[1], position[2]);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);
  colliders.push(new THREE.Box3().setFromObject(mesh));
  return mesh;
}

/**
 * Builds the 3D playground: lighting, ground, and a set of platforms
 * and obstacles to walk around, climb and jump between.
 *
 * @returns the scene, its colliders and the ground height.
 */
export function createWorld(): World {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0e1220);
  scene.fog = new THREE.Fog(0x0e1220, 40, 140);

  scene.add(new THREE.AmbientLight(0xb9ccff, 1.1));

  const hemi = new THREE.HemisphereLight(0x9fc4ff, 0x2a3352, 2.2);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xfff4e0, 3.2);
  sun.position.set(24, 38, 18);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 140;
  sun.shadow.camera.left = -70;
  sun.shadow.camera.right = 70;
  sun.shadow.camera.top = 70;
  sun.shadow.camera.bottom = -70;
  scene.add(sun);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(200, 200),
    new THREE.MeshStandardMaterial({ color: 0x39415f, roughness: 0.95 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const grid = new THREE.GridHelper(200, 100, 0x4c6cff, 0x2b3355);
  (grid.material as THREE.Material).transparent = true;
  (grid.material as THREE.Material).opacity = 0.35;
  grid.position.y = 0.01;
  scene.add(grid);

  const colliders: Collider[] = [];

  // Staircase of platforms to jump up.
  for (let i = 0; i < 6; i += 1) {
    addBox(scene, colliders, [4, 0.8 + i * 0.9, 4], [-14 + i * 5, (0.8 + i * 0.9) / 2, -12], 0x3d63ff);
  }

  // Scattered pillars.
  const pillars: Array<[number, number, number]> = [
    [12, 3, 6],
    [18, 5, -6],
    [-8, 4, 12],
    [4, 2.5, 16],
    [-18, 6, 2],
  ];
  pillars.forEach(([x, h, z], i) => {
    addBox(scene, colliders, [2.4, h, 2.4], [x, h / 2, z], i % 2 === 0 ? 0xff6b6b : 0xffc857);
  });

  // Floating-ish stepping blocks.
  const steps: Array<[number, number, number]> = [
    [0, 1.2, -2],
    [3.5, 2.2, -4.5],
    [7, 3.2, -7],
  ];
  steps.forEach(([x, y, z]) => {
    addBox(scene, colliders, [2.2, 0.5, 2.2], [x, y, z], 0x2ee6a8);
  });

  // Walls forming a bounded arena.
  const half = 40;
  addBox(scene, colliders, [half * 2, 2.5, 1], [0, 1.25, -half], 0x5a67d8);
  addBox(scene, colliders, [half * 2, 2.5, 1], [0, 1.25, half], 0x5a67d8);
  addBox(scene, colliders, [1, 2.5, half * 2], [-half, 1.25, 0], 0x5a67d8);
  addBox(scene, colliders, [1, 2.5, half * 2], [half, 1.25, 0], 0x5a67d8);

  return { scene, colliders, groundY: 0 };
}
