import { useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { createWorld } from './world.js';
import { PlayerController } from './player-controller.js';
import type { PlayerSnapshot } from './types.js';
import styles from './scene.module.css';

const DEBUG_COLOR = 0x2ee6a8;

/** Builds a wireframe box helper group visualizing every world collider. */
function buildColliderHelpers(colliders: readonly THREE.Box3[]): THREE.Group {
  const group = new THREE.Group();
  colliders.forEach((box) => {
    const helper = new THREE.Box3Helper(box, new THREE.Color(DEBUG_COLOR));
    group.add(helper);
  });
  return group;
}

const emptySnapshot: PlayerSnapshot = {
  position: { x: 0, y: 0, z: 0 },
  velocity: { x: 0, y: 0, z: 0 },
  speed: 0,
  stance: 'stand',
  sliding: false,
  climbing: false,
  grounded: false,
  sprinting: false,
  health: 100,
  debug: false,
};

/**
 * A first-person 3D playground with a Call of Duty-style movement kit.
 *
 * Controls: WASD move, Shift sprint, Ctrl crouch (hold while sprinting to
 * slide — release Ctrl or jump mid-slide to slide-cancel), Z prone,
 * Space jump, mouse look, Ctrl+Shift+B toggles the debug overlay.
 */
export function Scene() {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [locked, setLocked] = useState(false);
  const [fps, setFps] = useState(0);
  const [snapshot, setSnapshot] = useState<PlayerSnapshot>(emptySnapshot);

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

    const debugGroup = buildColliderHelpers(player.worldColliders);
    debugGroup.visible = false;
    scene.add(debugGroup);

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
      if (e.ctrlKey && e.shiftKey && e.code === 'KeyB') e.preventDefault();
      const toggledDebug = player.handleKey(e.code, true);
      if (toggledDebug) debugGroup.visible = player.debugEnabled;
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
      if (acc >= 0.25) {
        setFps(Math.round(frames / acc));
        setSnapshot(player.toSnapshot());
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

  const stanceLabel =
    snapshot.stance === 'stand' ? 'Standing' : snapshot.stance === 'crouch' ? 'Crouching' : 'Prone';
  const modeLabel = snapshot.climbing
    ? 'Climbing'
    : snapshot.sliding
      ? 'Sliding'
      : snapshot.sprinting
        ? 'Sprinting'
        : stanceLabel;

  return (
    <div className={styles.root} ref={containerRef}>
      <canvas className={styles.canvas} ref={canvasRef} />
      {locked && (
        <>
          <div className={styles.crosshair} />

          <div className={styles.healthBar}>
            <div className={styles.healthLabel}>HP</div>
            <div className={styles.healthTrack}>
              <div
                className={styles.healthFill}
                style={{
                  width: `${snapshot.health}%`,
                  background:
                    snapshot.health > 50
                      ? '#2ee6a8'
                      : snapshot.health > 20
                        ? '#ffc857'
                        : '#ff6b6b',
                }}
              />
            </div>
            <div className={styles.healthValue}>{Math.round(snapshot.health)}</div>
          </div>

          <div className={styles.hud}>
            <span>{fps} FPS</span>
            <span>
              x {snapshot.position.x.toFixed(1)} · y {snapshot.position.y.toFixed(1)} · z{' '}
              {snapshot.position.z.toFixed(1)}
            </span>
            <span>{modeLabel}</span>
          </div>

          {snapshot.debug && (
            <div className={styles.debugPanel}>
              <div className={styles.debugTitle}>DEBUG</div>
              <div>pos {`${snapshot.position.x.toFixed(2)}, ${snapshot.position.y.toFixed(2)}, ${snapshot.position.z.toFixed(2)}`}</div>
              <div>vel {`${snapshot.velocity.x.toFixed(2)}, ${snapshot.velocity.y.toFixed(2)}, ${snapshot.velocity.z.toFixed(2)}`}</div>
              <div>speed {snapshot.speed.toFixed(2)} m/s</div>
              <div>stance {snapshot.stance}</div>
              <div>grounded {String(snapshot.grounded)}</div>
              <div>sliding {String(snapshot.sliding)}</div>
              <div>climbing {String(snapshot.climbing)}</div>
              <div>health {snapshot.health.toFixed(0)}</div>
              <div>fps {fps}</div>
            </div>
          )}

          <div className={styles.hint}>
            WASD move · Shift sprint · Ctrl crouch/slide · Z prone · Space jump · Ctrl+Shift+B
            debug
          </div>
        </>
      )}
      {!locked && (
        <div className={styles.overlay} onClick={requestLock} role="presentation">
          <div className={styles.panel}>
            <h1 className={styles.title}>3D Playground</h1>
            <p className={styles.subtitle}>
              Sprint, slide, crouch and mantle your way across the arena.
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
                <span className={styles.key}>Shift</span>
                sprint
              </span>
              <span className={styles.keyRow}>
                <span className={styles.key}>Ctrl</span>
                crouch / slide
              </span>
              <span className={styles.keyRow}>
                <span className={styles.key}>Z</span>
                prone
              </span>
              <span className={styles.keyRow}>
                <span className={styles.key}>Space</span>
                jump
              </span>
              <span className={styles.keyRow}>
                <span className={styles.key}>Mouse</span>
                look
              </span>
              <span className={styles.keyRow}>
                <span className={styles.key}>Ctrl+Shift+B</span>
                debug
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
