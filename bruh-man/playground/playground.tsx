import { Routes, Route } from 'react-router-dom';
import { Scene } from './scene.js';
import styles from './playground.module.css';

/**
 * Root of the 3D playground app.
 */
export function Playground() {
  return (
    <div className={styles.app}>
      <Routes>
        <Route path="/" element={<Scene />} />
      </Routes>
    </div>
  );
}
