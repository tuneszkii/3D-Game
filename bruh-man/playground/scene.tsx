import { useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { createWorld } from './world.js';
import { PlayerController } from './player-controller.js';
import styles from './scene.module.css';

/**
 * A first-person 3D playground.
 *
 * Controls: WASD to move, Space to jump, mouse to look around.
 * Click the canvas to capture the pointer, press Esc to release it.
 */
export function Scene() {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [locked, setLocked] = useState(false);
  const [fps, setFps] = useState(0);
  const [pos, setPos] = useState({ x: 0, y: 0, z: 0 });

  const requestLock = useCallback(() => {
    canvasRef.current?.requestPointerLock();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return undefined;

    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      preserveDrawingBuffer: true,
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;

    const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 500);
    const { scene, colliders } = createWorld();
    const player = new PlayerController(camera, colliders);

    const resize = () => {
      const { clientWidth: w, clientHeight: h } = container;
      renderer.setSize(w, h, false);
      camera.aspect = w / Math.max(h, 1);
      camera.updateProjectionMatrix();
    };
    resize();

    const observer = new ResizeObserver(resize);
    observer.observe(container);

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space') e.preventDefault();
      player.handleKey(e.code, true);
    };
    const onKeyUp = (e: KeyboardEvent) => player.handleKey(e.code, false);
    const onMouseMove = (e: MouseEvent) => {
      if (document.pointerLockElement !== canvas) return;
      player.handleLook(e.movementX, e.movementY);
    };
    const onLockChange = () => {
      const isLocked = document.pointerLockElement === canvas;
      setLocked(isLocked);
      if (!isLocked) player.releaseKeys();
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('pointerlockchange', onLockChange);

    const clock = new THREE.Clock();
    let frames = 0;
    let acc = 0;
    let raf = 0;

    const loop = () => {
      raf = requestAnimationFrame(loop);
      const delta = clock.getDelta();
      player.update(delta);
      renderer.render(scene, camera);

      frames += 1;
      acc += delta;
      if (acc >= 0.5) {
        setFps(Math.round(frames / acc));
        const p = player.worldPosition;
        setPos({ x: p.x, y: p.y, z: p.z });
        frames = 0;
        acc = 0;
      }
    };
    loop();

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('pointerlockchange', onLockChange);
      scene.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
        else mat?.dispose();
      });
      renderer.dispose();
    };
  }, []);

  return (
    <div className={styles.root} ref={containerRef}>
      <canvas className={styles.canvas} ref={canvasRef} />
      {locked && (
        <>
          <div className={styles.crosshair} />
          <div className={styles.hud}>
            <span>{fps} FPS</span>
            <span>
              x {pos.x.toFixed(1)} · y {pos.y.toFixed(1)} · z {pos.z.toFixed(1)}
            </span>
          </div>
          <div className={styles.hint}>WASD move · Space jump · Esc release cursor</div>
        </>
      )}
      {!locked && (
        <div className={styles.overlay} onClick={requestLock} role="presentation">
          <div className={styles.panel}>
            <h1 className={styles.title}>3D Playground</h1>
            <p className={styles.subtitle}>
              Run around, climb the steps and jump between the blocks.
            </p>
            <div className={styles.keys}>
              <span className={styles.keyRow}>
                <span className={styles.key}>W</span>
                <span className={styles.key}>A</span>
                <span className={styles.key}>S</span>
                <span className={styles.key}>D</span>
                move
              </span>
              <span className={styles.keyRow}>
                <span className={styles.key}>Space</span>
                jump
              </span>
              <span className={styles.keyRow}>
                <span className={styles.key}>Mouse</span>
                look
              </span>
            </div>
            <button type="button" className={styles.cta} onClick={requestLock}>
              Click to play
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
