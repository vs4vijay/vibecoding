import * as THREE from 'three';
import { initErrorScreen } from './ui/errorScreen';
import { InputManager } from './core/input';
import { FixedLoop } from './core/loop';
import { createScene } from './render/scene';
import { ChaseCamera } from './render/camera';
import { DebugStats } from './render/debugStats';
import { SPECIES } from './data/species';
import { buildRig } from './actors/skeleton';
import { ClipPlayer } from './actors/clips';
import { CharacterController } from './actors/controller';

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
    // F3 overlay is a dev-only aid; excluded from production builds.
    const debug = import.meta.env.DEV
      ? new DebugStats(document.getElementById('app')!)
      : null;

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

    // Player rabbit: rig on the scene, kinematics on a fixed 60Hz sim loop.
    const rig = buildRig(SPECIES.rabbit);
    scene.add(rig.root);
    const player = new CharacterController(rig, SPECIES.rabbit, new ClipPlayer(rig));

    // One input sample per rendered frame; the fixed sim loop shares it.
    // Edges (jump press) self-limit: the first step consumes them.
    let frame: ReturnType<InputManager['sample']> | null = null;
    const simLoop = new FixedLoop(1000 / 60, (stepMs) => {
      if (frame) player.update(stepMs, frame, !input.isLocked, chaseCam.yaw);
    });

    let lastMs = performance.now();
    function tick(nowMs: number) {
      requestAnimationFrame(tick);
      // Clamp huge gaps (tab-away) so one frame can't fling the camera.
      const realDtMs = Math.min(nowMs - lastMs, 100);
      lastMs = nowMs;

      frame = input.sample();
      simLoop.advance(realDtMs);
      chaseCam.update(realDtMs / 1000, rig.root.position, player.heading, frame.lookDX, frame.lookDY);
      debug?.frame(realDtMs);
      renderer.render(scene, camera3d);
    }
    requestAnimationFrame(tick);

    if (import.meta.env.DEV) {
      // Verification hook: read-only handles for browser tooling. Dev
      // builds only — tree-shaken from production.
      (window as unknown as Record<string, unknown>).__lugaru = {
        chaseCam,
        debug,
        player,
        rig,
      };
    }
  } catch (err) {
    errors.show('Failed to start', String(err));
  }
}

boot();
