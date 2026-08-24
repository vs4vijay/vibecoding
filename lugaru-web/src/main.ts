import * as THREE from 'three';
import { initErrorScreen } from './ui/errorScreen';
import { InputManager } from './core/input';
import { createScene } from './render/scene';
import { ChaseCamera } from './render/camera';
import { DebugStats } from './render/debugStats';

const errors = initErrorScreen();

async function boot() {
  try {
    if (matchMedia('(pointer: coarse)').matches) {
      document.getElementById('coarse-warning')!.classList.remove('hidden');
      return;
    }

    const canvas = document.getElementById('game') as HTMLCanvasElement;
    const { renderer, scene } = createScene(canvas);

    const camera3d = new THREE.PerspectiveCamera(60, 1, 0.1, 300);
    const chaseCam = new ChaseCamera(camera3d);
    const debug = new DebugStats(document.getElementById('app')!);

    const input = new InputManager();
    input.attach(canvas);
    canvas.addEventListener('click', () => input.requestPointerLock());

    function resize() {
      const w = window.innerWidth;
      const h = window.innerHeight;
      renderer.setSize(w, h, false);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      camera3d.aspect = w / h;
      camera3d.updateProjectionMatrix();
    }
    window.addEventListener('resize', resize);
    resize();

    // Fake stationary target until the simulation lands (later tasks).
    const target = { x: 0, y: 0, z: 0 };
    let lastMs = performance.now();
    function tick(nowMs: number) {
      requestAnimationFrame(tick);
      // Clamp huge gaps (tab-away) so one frame can't fling the camera.
      const realDtMs = Math.min(nowMs - lastMs, 100);
      lastMs = nowMs;

      const frame = input.sample();
      chaseCam.update(realDtMs / 1000, target, 0, frame.lookDX, frame.lookDY);
      debug.frame(realDtMs);
      renderer.render(scene, camera3d);
    }
    requestAnimationFrame(tick);

    // Verification hook: read-only handles for browser tooling (removed when
    // the real player controller lands).
    (window as unknown as Record<string, unknown>).__lugaru = { chaseCam, debug };
  } catch (err) {
    errors.show('Failed to start', String(err));
  }
}

boot();
