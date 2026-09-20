import "./style.css";
import { CONFIG } from "./config";
import { scoreForLevel, unlocksForLevel } from "./game/difficulty";
import { Emitter } from "./core/emitter";
import { InputController } from "./core/input";
import { AudioEngine, type AudioState } from "./core/audio";
import { load, save } from "./core/storage";
import { Session, type GameEvents } from "./game/session";
import { CameraRig } from "./render/cameraRig";
import { createGameScene } from "./render/scene";
import { World } from "./render/world";
import { Hud, unlockSubtitle, type HudState } from "./ui/hud";
import { formatPopupText } from "./ui/popups";
import { worldToScreen, type ScreenPos } from "./ui/worldToScreen";
import { Coach } from "./ui/coach";
import { Menus, coachPending, markCoachSeen } from "./ui/menus";

/** Dev-only verification hook (openspec D11); absent in prod builds. */
declare global {
  interface Window {
    __zh?: {
      rendererInfo(): number;
      debugAddWeight(side: "left" | "right", w: number): void;
      carZ(): number;
    };
  }
}

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
  rig.resetDeathCam();

  // Dev-only verification hook (openspec D11): the headless verification pass
  // reads the draw-call budget, forces hull weight for the tilt-danger shots
  // (the true-to-sim path — Session.addWeight persists through the per-step
  // absolute weight sync) and samples car z. import.meta.env.DEV dead-code
  // eliminates this from prod builds; no gameplay API surface added.
  if (import.meta.env.DEV) {
    window.__zh = {
      rendererInfo: () => renderer.info.render.calls,
      debugAddWeight: (side, w) => session.addWeight(side, w),
      carZ: () => session.carZValue,
    };
  }

  // Persistence snapshot for this session.
  let bestScore = load("bestScore", 0);
  let bestDist = load("bestDist", 0);
  let runs = load("runs", 0);
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
    // undefined when the level unlocks nothing → banner is level-only.
    hud.toast(`LEVEL ${level}`, unlockSubtitle(unlocksForLevel(level)));
  });
  // Kill-score popups: project the victim's ~head height (y ≈ 1.6 m) to CSS
  // px and hand the HUD a preallocated position. The handler runs
  // synchronously inside the same fixed step as the kill — registerKill
  // updates scoring.multiplier before emitting — so reading it here IS the
  // at-kill value. Camera matrices are one render old (events fire before
  // renderer.render); imperceptible for a ~1 s popup. Off-screen kills
  // clamp to the viewport edge, keeping burst feedback bounded.
  const killScreen: ScreenPos = { x: 0, y: 0, offscreen: false };
  emitter.on("kill", (_type, _viaScrape, points, worldX, worldZ) => {
    worldToScreen(
      worldX,
      1.6,
      worldZ,
      camera,
      canvas.clientWidth,
      canvas.clientHeight,
      killScreen,
    );
    hud.popup(
      killScreen.x,
      killScreen.y,
      formatPopupText(points, session.scoring.multiplier),
    );
  });
  emitter.on("gameOver", () => rig.armDeathCam());

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
    // The coach must never overlap the game-over card. If both taught
    // actions landed in this same sim step, persist before clearing —
    // the tick check below won't run once coachActive is false.
    if (coachActive) {
      if (coach.done) markCoachSeen();
      coachActive = false;
      coach.hide();
    }
    menus.showGameOver(stats, newBestScore);
    hud.hide();
  });

  // --- menu actions ---------------------------------------------------------
  menus.onPlay(() => {
    audio.unlock();
    audio.uiClick();
    menus.hideAll();
    hud.show();
    rig.resetDeathCam();
    session.startRun();
    // Re-read the persisted flag on EVERY PLAY/RETRY — never a boot-time
    // snapshot, or a completion saved earlier in this page session would
    // resurrect the coach on later runs.
    if (coachPending()) {
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
  let last = performance.now();
  // Preallocated per-frame HUD snapshot: written in place, never reallocated.
  const hudSnap: HudState = {
    phase: "title",
    score: 0,
    best: 0,
    distanceM: 0,
    level: 1,
    levelProgress: 0,
    tilt: 0,
    imbalance: 0,
    weights: { left: 0, right: 0 },
    mag: { left: CONFIG.gun.magSize, right: CONFIG.gun.magSize },
    reload01: { left: 1, right: 1 },
    multiplier: 1,
  };
  hud.hide();

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
      writeHudState(hudSnap, session, bestScore, imb);
      hud.update(hudSnap);
    }
    world.update(session.carZValue);
    rig.follow(session.car.x, session.carZValue, session.speed01, dt);
    rig.tick(dt);
    renderer.render(scene, camera);

    // Coach dismissal: persist once both taught actions happened. The
    // explicit hide() is defensive — progress latches across retries, so
    // a show() racing a completion must never leave the overlay on screen.
    if (coachActive && coach.done) {
      coachActive = false;
      coach.hide();
      markCoachSeen();
    }

    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  // Detached toast layer must not leak past teardown.
  window.addEventListener("pagehide", () => hud.dispose());

  /** Writes the live HUD snapshot into `out` (preallocated). */
  function writeHudState(
    out: HudState,
    s: Session,
    best: number,
    imbalance: number,
  ): void {
    const lvl = s.level;
    const reqLo = scoreForLevel(lvl);
    const reqHi = scoreForLevel(lvl + 1);
    const progress = Math.max(
      0,
      Math.min(1, (s.scoring.score - reqLo) / (reqHi - reqLo)),
    );
    out.phase = session.phase;
    out.score = s.scoring.score;
    out.best = best;
    out.distanceM = s.scoring.distanceM;
    out.level = lvl;
    out.levelProgress = Number.isFinite(progress) ? progress : 1;
    out.tilt = -s.car.tilt; // gauge is screen-space; world tilt mirrors on screen
    out.imbalance = imbalance;
    // World-space capacity units (capacity = CONFIG.car.capacityPerSide per
    // side). Unlike mag/tilt these are NOT screen-flipped here; any display
    // that mirrors sides does so at render time.
    out.weights.left = s.car.leftWeight;
    out.weights.right = s.car.rightWeight;
    // Ammo rows are screen-space: the on-screen-left gun is gun.right (world).
    out.mag.left = s.gun.right.mag;
    out.mag.right = s.gun.left.mag;
    out.reload01.left =
      s.gun.right.reloadT <= 0 ? 1 : 1 - s.gun.right.reloadT / CONFIG.gun.reloadS;
    out.reload01.right =
      s.gun.left.reloadT <= 0
        ? 1
        : 1 - s.gun.left.reloadT / CONFIG.gun.reloadS;
    out.multiplier = s.scoring.multiplier;
  }
}

if (typeof document !== "undefined") boot();
