import "./style.css";
import { createGameScene } from "./render/scene";
import { World } from "./render/world";
import { CameraRig } from "./render/cameraRig";
import { CONFIG } from "./config";

export function boot(): void {
  if (typeof document === "undefined") return;

  const canvas = document.querySelector<HTMLCanvasElement>("#game");
  if (!canvas) return;

  const { scene, camera, renderer } = createGameScene(canvas);
  const world = new World(scene);
  const rig = new CameraRig(camera);

  let last = performance.now();
  let frames = 0;
  let elapsed = 0;
  const tick = (now: number) => {
    const dt = Math.min((now - last) / 1000, CONFIG.sim.maxFrameDt);
    last = now;
    frames++;
    elapsed += dt;
    if (elapsed >= 1) {
      console.log(`fps: ${frames}`);
      frames = 0;
      elapsed = 0;
    }
    const carZ = 0; // real car state wires in with the game loop task
    world.update(carZ);
    rig.follow(0, carZ, 0.5, dt); // speed01 0.5 mid-fov until real car drives this
    rig.tick(dt);
    renderer.render(scene, camera);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

if (typeof document !== "undefined") boot();
