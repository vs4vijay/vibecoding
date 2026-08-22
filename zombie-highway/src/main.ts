import "./style.css";
import { Emitter } from "./core/emitter";
import { InputController } from "./core/input";
import { CONFIG } from "./config";
import { Session } from "./game/session";
import type { GameEvents } from "./game/session";
import { CameraRig } from "./render/cameraRig";
import { createGameScene } from "./render/scene";
import { World } from "./render/world";

export function boot(): void {
  if (typeof document === "undefined") return;

  const canvas = document.querySelector<HTMLCanvasElement>("#game");
  if (!canvas) return;

  const { scene, camera, renderer } = createGameScene(canvas);
  const world = new World(scene);
  const rig = new CameraRig(camera);
  const emitter = new Emitter<GameEvents>();
  const input = new InputController(canvas);

  // Session owns the sim and attaches every pooled mesh to the scene.
  const session = new Session({
    input,
    emitter,
    render: { scene, camera, shake: (i: number) => rig.shake(i) },
  });

  emitter.on("gameOver", (stats) => {
    // Restart on any input after a wreck; Escape/P still toggles pause.
    const retry = () => {
      offFire();
      offPause();
      session.startRun();
    };
    const offFire = input.onFire(retry);
    const offPause = input.onPause(retry);
    console.log(
      `game over: ${stats.cause} score=${stats.score} dist=${stats.distanceM} kills=${stats.kills}`,
    );
  });
  emitter.on("levelUp", (level) => console.log(`level ${level}`));

  session.startRun();

  let last = performance.now();
  const tick = (now: number) => {
    const dt = Math.min((now - last) / 1000, CONFIG.sim.maxFrameDt);
    last = now;
    session.update(dt);
    const carZ = session.carZValue;
    world.update(carZ);
    rig.follow(session.car.x, carZ, session.speed01, dt);
    rig.tick(dt);
    renderer.render(scene, camera);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

if (typeof document !== "undefined") boot();
