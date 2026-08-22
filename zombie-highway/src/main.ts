import "./style.css";
import { CONFIG } from "./config";
import { scoreForLevel } from "./game/difficulty";
import { Emitter } from "./core/emitter";
import { InputController } from "./core/input";
import { AudioEngine, type AudioState } from "./core/audio";
import { load, save } from "./core/storage";
import { Session, type GameEvents } from "./game/session";
import { CameraRig } from "./render/cameraRig";
import { createGameScene } from "./render/scene";
import { World } from "./render/world";
import { Hud, type HudState } from "./ui/hud";
import { Coach } from "./ui/coach";
import { Menus, coachPending, markCoachSeen } from "./ui/menus";

export function boot(): void {
  if (typeof document === "undefined") return;

  const canvas = document.querySelector<HTMLCanvasElement>("#game");
  const hudRoot = document.querySelector<HTMLElement>("#hud");
  if (!canvas || !hudRoot) return;

  const { scene, camera, renderer } = createGameScene(canvas);
  const world = new World(scene);
  const rig = new CameraRig(camera);
  const emitter = new Emitter<GameEvents>();
  const input = new InputController(canvas);

  const audio = new AudioEngine(load("muted", false));
  // Separate overlay roots: hud.hide() must never hide menus/coach/toasts.
  const mkRoot = (id: string): HTMLElement => {
    const node = document.createElement("div");
    node.id = id;
    document.body.append(node);
    return node;
  };
  const hud = new Hud(hudRoot);
  const menus = new Menus(mkRoot("menus"), audio);
  const coach = new Coach(mkRoot("coach"));

  // Session owns the sim and attaches every pooled mesh to the scene.
  const session = new Session({
    input,
    emitter,
    render: { scene, camera, shake: (i: number) => rig.shake(i) },
  });

  // Persistence snapshot for this session.
  let bestScore = load("bestScore", 0);
  let bestDist = load("bestDist", 0);
  let runs = load("runs", 0);
  const coachWanted = coachPending();
  let coachActive = false;

  // --- audio unlock: any first gesture on the page -------------------------
  const unlockAudio = () => {
    audio.unlock();
    document.removeEventListener("pointerdown", unlockAudio);
    document.removeEventListener("keydown", unlockAudio);
  };
  document.addEventListener("pointerdown", unlockAudio);
  document.addEventListener("keydown", unlockAudio);

  // --- input-driven coach tracking ----------------------------------------
  let steerWasIdle = true;
  const trackSteer = () => {
    const active = Math.abs(input.steer) > 0.25;
    if (active && steerWasIdle && coachActive) coach.notifySteer();
    steerWasIdle = !active;
  };

  // --- event wiring (replaces Task 9 console.log placeholders) -------------
  emitter.on("shot", () => {
    audio.shot();
    if (coachActive) coach.notifyShot();
  });
  emitter.on("attach", () => audio.attachThud());
  emitter.on("scrape", () => audio.scrape());
  emitter.on("levelUp", (level) => {
    audio.levelUpSting();
    hud.toast(`LEVEL ${level}`);
  });

  emitter.on("gameOver", (stats) => {
    audio.crashSting();
    if (stats.cause === "flip") audio.flipRiser();
    runs++;
    save("runs", runs);
    const newBestScore = stats.score > bestScore;
    if (newBestScore) {
      bestScore = stats.score;
      save("bestScore", bestScore);
    }
    if (stats.distanceM > bestDist) {
      bestDist = stats.distanceM;
      save("bestDist", bestDist);
    }
    if (newBestScore) hud.toast("NEW BEST!");
    menus.showGameOver(stats, newBestScore);
    hud.hide();
  });

  // --- menu actions ---------------------------------------------------------
  menus.onPlay(() => {
    audio.unlock();
    audio.uiClick();
    menus.hideAll();
    hud.show();
    session.startRun();
    if (coachWanted) {
      coachActive = true;
      coach.show();
    }
  });
  hud.onPause(() => session.togglePause());
  // Defensive retry: Space/Enter restart even if RETRY focus was dropped.
  const retryKey = (ev: KeyboardEvent) => {
    if (
      (ev.code === "Space" || ev.code === "Enter") &&
      menus.gameOverVisible
    ) {
      menus.retryFromKey();
    }
  };
  window.addEventListener("keydown", retryKey);

  // Boot straight into the title screen.
  menus.showTitle(bestScore);
  hud.hide();

  let last = performance.now();
  const tick = (now: number) => {
    const dt = Math.min((now - last) / 1000, CONFIG.sim.maxFrameDt);
    last = now;
    trackSteer();

    // Per-frame audio state from live sim values.
    const imb =
      (session.car.rightWeight - session.car.leftWeight) /
      CONFIG.car.capacityPerSide;
    const audioState: AudioState = {
      phase: session.phase,
      speed01: session.speed01,
      zombiesActive:
        session.phase === "running" && session.activeZombieCount > 0,
      tiltDanger:
        session.phase === "running" && Math.abs(imb) >= 0.75,
    };
    audio.update(dt, audioState);

    session.update(dt);

    if (session.phase !== "title") {
      hud.update(hudState(session, bestScore, imb));
    }
    world.update(session.carZValue);
    rig.follow(session.car.x, session.carZValue, session.speed01, dt);
    rig.tick(dt);
    renderer.render(scene, camera);

    // Coach dismissal: persist once both taught actions happened.
    if (coachActive && coach.done) {
      coachActive = false;
      markCoachSeen();
    }

    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  function hudState(s: Session, best: number, imbalance: number): HudState {
    const lvl = s.level;
    const reqLo = scoreForLevel(lvl);
    const reqHi = scoreForLevel(lvl + 1);
    const progress = Math.max(
      0,
      Math.min(1, (s.scoring.score - reqLo) / (reqHi - reqLo)),
    );
    return {
      phase: session.phase,
      score: s.scoring.score,
      best,
      distanceM: s.scoring.distanceM,
      level: lvl,
      levelProgress: Number.isFinite(progress) ? progress : 1,
      tilt: s.car.tilt,
      imbalance,
      mag: { left: s.gun.left.mag, right: s.gun.right.mag },
      reload01: {
        left: s.gun.left.reloadT <= 0 ? 1 : 1 - s.gun.left.reloadT / CONFIG.gun.reloadS,
        right:
          s.gun.right.reloadT <= 0
            ? 1
            : 1 - s.gun.right.reloadT / CONFIG.gun.reloadS,
      },
      multiplier: s.scoring.multiplier,
    };
  }
}

if (typeof document !== "undefined") boot();
