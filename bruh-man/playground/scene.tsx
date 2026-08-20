import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';

import * as THREE from 'three';

import { createWorld } from './world.js';
import { PlayerController } from './player-controller.js';

import type {
  PlayerSnapshot,
} from './types.js';

import styles from './scene.module.css';

const DEBUG_COLOR = 0x2ee6a8;

function buildColliderHelpers(
  colliders: readonly THREE.Box3[]
): THREE.Group {
  const group =
    new THREE.Group();

  colliders.forEach(
    (box) => {
      const helper =
        new THREE.Box3Helper(
          box,
          new THREE.Color(
            DEBUG_COLOR
          )
        );

      group.add(helper);
    }
  );

  return group;
}

const emptySnapshot:
  PlayerSnapshot = {
    position: {
      x: 0,
      y: 0,
      z: 0,
    },

    velocity: {
      x: 0,
      y: 0,
      z: 0,
    },

    speed: 0,

    stance: 'stand',

    sliding: false,

    climbing: false,

    grounded: false,

    sprinting: false,

    health: 100,

    debug: false,

    canMantle: false
  };

export function Scene() {
  const containerRef =
    useRef<HTMLDivElement>(
      null
    );

  const canvasRef =
    useRef<HTMLCanvasElement>(
      null
    );

  const [locked, setLocked] =
    useState(false);

  const [fps, setFps] =
    useState(0);

  const [snapshot, setSnapshot] =
    useState<PlayerSnapshot>(
      emptySnapshot
    );

  const requestLock =
    useCallback(() => {
      canvasRef.current?.requestPointerLock();
    }, []);

  useEffect(() => {
    const canvas =
      canvasRef.current;

    const container =
      containerRef.current;

    if (
      !canvas ||
      !container
    ) {
      return undefined;
    }

    const renderer =
      new THREE.WebGLRenderer({
        canvas,
        antialias: true,
        preserveDrawingBuffer: true,
      });

    renderer.setPixelRatio(
      Math.min(
        window.devicePixelRatio,
        2
      )
    );

    renderer.shadowMap.enabled =
      true;

    renderer.shadowMap.type =
      THREE.PCFShadowMap;

    const camera =
      new THREE.PerspectiveCamera(
        75,
        1,
        0.1,
        500
      );

    const {
      scene,
      colliders,
    } = createWorld();

    const player =
      new PlayerController(
        camera,
        colliders
      );

    /**
     * The controller and debug renderer
     * intentionally share the exact same
     * collider objects.
     */
    const debugGroup =
      buildColliderHelpers(
        player.worldColliders
      );

    debugGroup.visible =
      player.debugEnabled;

    scene.add(
      debugGroup
    );

    const resize = () => {
      const width =
        container.clientWidth;

      const height =
        container.clientHeight;

      renderer.setSize(
        width,
        height,
        false
      );

      camera.aspect =
        width /
        Math.max(
          height,
          1
        );

      camera.updateProjectionMatrix();
    };

    resize();

    const observer =
      new ResizeObserver(
        resize
      );

    observer.observe(
      container
    );

    const onKeyDown = (
      event: KeyboardEvent
    ) => {
      /**
       * Don't let Space scroll the page.
       */
      if (
        event.code ===
        'Space'
      ) {
        event.preventDefault();
      }

      /**
       * Don't let the debug shortcut
       * trigger browser behavior.
       */
      if (
        event.ctrlKey &&
        event.shiftKey &&
        event.code ===
          'KeyB'
      ) {
        event.preventDefault();
      }

      const debugChanged =
        player.handleKey(
          event.code,
          true
        );

      if (debugChanged) {
        debugGroup.visible =
          player.debugEnabled;
      }
    };

    const onKeyUp = (
      event: KeyboardEvent
    ) => {
      player.handleKey(
        event.code,
        false
      );
    };

    const onMouseMove = (
      event: MouseEvent
    ) => {
      if (
        document.pointerLockElement !==
        canvas
      ) {
        return;
      }

      player.handleLook(
        event.movementX,
        event.movementY
      );
    };

    const onLockChange =
      () => {
        const isLocked =
          document.pointerLockElement ===
          canvas;

        setLocked(
          isLocked
        );

        if (!isLocked) {
          player.releaseKeys();
        }
      };

    window.addEventListener(
      'keydown',
      onKeyDown
    );

    window.addEventListener(
      'keyup',
      onKeyUp
    );

    document.addEventListener(
      'mousemove',
      onMouseMove
    );

    document.addEventListener(
      'pointerlockchange',
      onLockChange
    );

    const clock =
      new THREE.Clock();

    let frames = 0;
    let accumulatedTime = 0;

    let raf = 0;

    const loop = () => {
      raf =
        requestAnimationFrame(
          loop
        );

      const delta =
        clock.getDelta();

      player.update(
        delta
      );

      renderer.render(
        scene,
        camera
      );

      frames += 1;

      accumulatedTime +=
        delta;

      if (
        accumulatedTime >=
        0.25
      ) {
        setFps(
          Math.round(
            frames /
              accumulatedTime
          )
        );

        setSnapshot(
          player.toSnapshot()
        );

        frames = 0;
        accumulatedTime = 0;
      }
    };

    loop();

    return () => {
      cancelAnimationFrame(
        raf
      );

      observer.disconnect();

      window.removeEventListener(
        'keydown',
        onKeyDown
      );

      window.removeEventListener(
        'keyup',
        onKeyUp
      );

      document.removeEventListener(
        'mousemove',
        onMouseMove
      );

      document.removeEventListener(
        'pointerlockchange',
        onLockChange
      );

      scene.traverse(
        (object) => {
          const mesh =
            object as THREE.Mesh;

          if (
            mesh.geometry
          ) {
            mesh.geometry.dispose();
          }

          const material =
            mesh.material as
              | THREE.Material
              | THREE.Material[]
              | undefined;

          if (
            Array.isArray(
              material
            )
          ) {
            material.forEach(
              (item) =>
                item.dispose()
            );
          } else {
            material?.dispose();
          }
        }
      );

      renderer.dispose();
    };
  }, []);

  const stanceLabel =
    snapshot.stance ===
    'stand'
      ? 'Standing'
      : snapshot.stance ===
          'crouch'
        ? 'Crouching'
        : 'Prone';

  const modeLabel =
    snapshot.climbing
      ? 'Climbing'
      : snapshot.sliding
        ? 'Sliding'
        : snapshot.sprinting
          ? 'Sprinting'
          : stanceLabel;

  return (
    <div
      className={styles.root}
      ref={containerRef}
    >
      <canvas
        className={styles.canvas}
        ref={canvasRef}
      />

      {locked && (
        <>
          <div
            className={
              styles.crosshair
            }
          />

                    {snapshot.canMantle && (
            <div
              className={
                styles.mantlePrompt
              }
            >
              <span
                className={
                  styles.mantleKey
                }
              >
                SPACE
              </span>

              <span
                className={
                  styles.mantleLabel
                }
              >
                MANTLE
              </span>
            </div>
          )}

          <div
            className={
              styles.healthBar
            }
          >
            <div
              className={
                styles.healthLabel
              }
            >
              HP
            </div>

            <div
              className={
                styles.healthTrack
              }
            >
              <div
                className={
                  styles.healthFill
                }
                style={{
                  width:
                    `${snapshot.health}%`,

                  background:
                    snapshot.health >
                    50
                      ? '#2ee6a8'
                      : snapshot.health >
                          20
                        ? '#ffc857'
                        : '#ff6b6b',
                }}
              />
            </div>

            <div
              className={
                styles.healthValue
              }
            >
              {Math.round(
                snapshot.health
              )}
            </div>
          </div>

          <div
            className={
              styles.hud
            }
          >
            <span>
              {fps} FPS
            </span>

            <span>
              x{' '}
              {snapshot.position.x.toFixed(
                1
              )}
              {' · y '}
              {snapshot.position.y.toFixed(
                1
              )}
              {' · z '}
              {snapshot.position.z.toFixed(
                1
              )}
            </span>

            <span>
              {modeLabel}
            </span>
          </div>

          {snapshot.debug && (
            <div
              className={
                styles.debugPanel
              }
            >
              <div
                className={
                  styles.debugTitle
                }
              >
                DEBUG
              </div>

              <div>
                state{' '}
                {modeLabel}
              </div>

              <div>
                pos{' '}
                {`${snapshot.position.x.toFixed(
                  2
                )}, ${snapshot.position.y.toFixed(
                  2
                )}, ${snapshot.position.z.toFixed(
                  2
                )}`}
              </div>

              <div>
                vel{' '}
                {`${snapshot.velocity.x.toFixed(
                  2
                )}, ${snapshot.velocity.y.toFixed(
                  2
                )}, ${snapshot.velocity.z.toFixed(
                  2
                )}`}
              </div>

              <div>
                speed{' '}
                {snapshot.speed.toFixed(
                  2
                )}{' '}
                m/s
              </div>

              <div>
                stance{' '}
                {snapshot.stance}
              </div>

              <div>
                grounded{' '}
                {String(
                  snapshot.grounded
                )}
              </div>

              <div>
                sprinting{' '}
                {String(
                  snapshot.sprinting
                )}
              </div>

              <div>
                sliding{' '}
                {String(
                  snapshot.sliding
                )}
              </div>

              <div>
                climbing{' '}
                {String(
                  snapshot.climbing
                )}
              </div>

              <div>
                health{' '}
                {snapshot.health.toFixed(
                  0
                )}
              </div>

              <div>
                fps {fps}
              </div>
            </div>
          )}

          <div
            className={
              styles.hint
            }
          >
            WASD move · Shift sprint ·
            Shift×2 tactical sprint ·
            C crouch / slide / cancel ·
            X prone ·
            Space jump / mantle / slide-cancel ·
            Mouse look · Ctrl+Shift+B debug
          </div>
        </>
      )}

      {!locked && (
        <div
          className={
            styles.overlay
          }
          onClick={
            requestLock
          }
          role="presentation"
        >
          <div
            className={
              styles.panel
            }
          >
            <h1
              className={
                styles.title
              }
            >
              3D Playground
            </h1>

            <p
              className={
                styles.subtitle
              }
            >
              COD-inspired
              movement sandbox.
            </p>

            <div
              className={
                styles.keys
              }
            >
              <span
                className={
                  styles.keyRow
                }
              >
                <span
                  className={
                    styles.key
                  }
                >
                  W A S D
                </span>
                move
              </span>

              <span
                className={
                  styles.keyRow
                }
              >
                <span
                  className={
                    styles.key
                  }
                >
                  Shift
                </span>
                sprint
              </span>

              <span
                className={
                  styles.keyRow
                }
              >
                <span
                  className={
                    styles.key
                  }
                >
                  Shift × 2
                </span>
                tactical sprint
              </span>

              <span
                className={
                  styles.keyRow
                }
              >
                <span
                  className={
                    styles.key
                  }
                >
                  C
                </span>
                crouch
              </span>

              <span
                className={
                  styles.keyRow
                }
              >
                <span
                  className={
                    styles.key
                  }
                >
                  Sprint + C
                </span>
                slide
              </span>

              <span
                className={
                  styles.keyRow
                }
              >
                <span
                  className={
                    styles.key
                  }
                >
                  C
                </span>
                slide cancel
              </span>

              <span
                className={
                  styles.keyRow
                }
              >
                <span
                  className={
                    styles.key
                  }
                >
                  X
                </span>
                prone
              </span>

              <span
                className={
                  styles.keyRow
                }
              >
                <span
                  className={
                    styles.key
                  }
                >
                  Space
                </span>
                jump / mantle
              </span>

              <span
                className={
                  styles.keyRow
                }
              >
                <span
                  className={
                    styles.key
                  }
                >
                  Mouse
                </span>
                look
              </span>

              <span
                className={
                  styles.keyRow
                }
              >
                <span
                  className={
                    styles.key
                  }
                >
                  Ctrl+Shift+B
                </span>
                debug
              </span>
            </div>

            <button
              type="button"
              className={
                styles.cta
              }
              onClick={
                requestLock
              }
            >
              Click to play
            </button>
          </div>
        </div>
      )}
    </div>
  );
}