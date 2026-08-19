import { MemoryRouter } from 'react-router-dom';
import { Playground } from './playground.js';
import { Scene } from './scene.js';

/** The full app, routed as it runs in production. */
export const PlaygroundBasic = () => {
  return (
    <MemoryRouter>
      <Playground />
    </MemoryRouter>
  );
};

/** Just the 3D scene, rendered standalone without the router. */
export const SceneOnly = () => {
  return (
    <div style={{ height: '60vh', minHeight: 360 }}>
      <Scene />
    </div>
  );
};
