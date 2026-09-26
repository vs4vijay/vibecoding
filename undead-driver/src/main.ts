import "./style.css";
import * as THREE from "three";
import { CONFIG } from "./config";
import { scoreForLevel, unlocksForLevel } from "./game/difficulty";
import { Emitter } from "./core/emitter";
import { InputController } from "./core/input";
import { AudioEngine, type AudioState } from "./core/audio";
import { load, save } from "./core/storage";
import { Session, type GameEvents } from "./game/session";
import { CameraRig } from "./render/cameraRig";
import { createGameScene } from "./render/scene";
import { createPostFx } from "./render/postfx";
import {
  appliedQuality,
  createQualityState,
  knobsForTier,
  stepQuality,
  type TierKnobs,
} from "./render/quality";
import { World } from "./render/world";
import { Hud, unlockSubtitle, type HudState } from "./ui/hud";
import { formatPopupText } from "./ui/popups";
import { worldToScreen, type ScreenPos } from "./ui/worldToScreen";
import { Coach } from "./ui/coach";
import { Menus, coachPending, markCoachSeen } from "./ui/menus";

/** Dev-only verification hook (openspec D11); absent in prod builds. */
type ZhStateInfo = {
  phase: string;
  level: number;
  carX: number;
  carZ: number;
  speed: number;
  score: number;
  distM: number;
  kills: number;
  zombies: number;
  clinging: number;
  leaping: number;
  drawCalls: number;
};
type ZhPoseInfo = { mode: string; lamp?: { x: number; z: number } };

/**
 * Structural probe of Session's private render bindings (task 1.7): exact
 * object references for the per-system draw attribution, read only inside
 * the dev-only rendererInfo() probe. Cast through `unknown` — `view` is
 * private, and the probe must not force a public API onto game/.
 */
type ZhViewProbe = {
  car: { root: THREE.Object3D };
  zombies: {
    slots: { torso: THREE.Object3D; head: THREE.Object3D; arms: THREE.Object3D[] }[];
    flash: THREE.Object3D;
  };
  obstacles: unknown;
  fx: {
    quads: { mesh: THREE.Object3D }[];
    flash: { mesh: THREE.Object3D };
  };
};

declare global {
  interface Window {
    __zh?: {
      /** Draw calls this frame + which render path is active (task 1.4). */
      rendererInfo(): ZhRendererInfo;
      debugAddWeight(side: "left" | "right", w: number): void;
      carZ(): number;
      /** Same path as pressing PLAY (starts a fresh run). */
      play(): void;
      /** Live readout for the capture harness. */
      state(): ZhStateInfo;
      /** Gates wall-clock sim advancement (running <-> paused). */
      freeze(on: boolean): string;
      /** Deterministic fixed-step advance (1/60 s each). */
      stepSim(n: number): void;
      /** Queues a shot consumed by the next step, pause state aside. */
      fire(side: "left" | "right"): void;
      /** Spawns a lurker `zRel` meters ahead of the car at lateral `x`. */
      spawnZombie(
        type: "walker" | "runner" | "brute",
        x: number,
        zRel: number,
      ): boolean;
      /** Overrides the chase camera: "side" profile, "lamp" corridor, or "chase" to restore. */
      pose(mode: "chase" | "side" | "lamp"): ZhPoseInfo;
      /**
       * Dev-only quality-controller test hook (task 1.5): pins the fps the
       * adaptive controller is fed (null restores live measurement). Does
       * not touch the sim — the game keeps running at true speed.
       */
      forceFps(fps: number | null): void;
      /**
       * Dev-only lighting hook (task 2.3): jumps the run to `level` via the
       * existing debug score hook so the mood rig's target is verifiable in
       * captures without grinding levels. Returns the reached level.
       */
      forceLevel(level: number): number;
      /**
       * Dev-only probe hook (tasks 2.1–2.3): projects a world point to CSS
       * pixels the way kill popups are anchored, so pixel probes can sample
       * exact road/zombie/lamp patches out of captures.
       */
      project(
        x: number,
        y: number,
        z: number,
      ): { x: number; y: number; offscreen: boolean };
      /** Dev-only shadow-state readout for the lighting probes (task 2.1). */
      lightDebug(): Record<string, unknown>;
    };
  }
}

/** rendererInfo() shape: frame totals + per-system draw attribution (task 1.7). */
type ZhRendererInfo = {
  calls: number;
  renderPath: "composer" | "direct";
  /** Quality controller's EMA fps (the same value its steps are gated on). */
  fps: number;
  /** Currently applied quality tier (0 = lowest). */
  tier: number;
  /** Pixel ratio currently applied to the renderer (tier scale x DPR). */
  pixelRatio: number;
  /** Draw calls attributed per system via probe-time hide-diff renders. */
  systems: {
    world: number;
    characters: number;
    fx: number;
    post: number;
    other: number;
  };
};

export function boot(): void {
  if (typeof document === "undefined") return;

  const canvas = document.querySelector<HTMLCanvasElement>("#game");
  const hudRoot = document.querySelector<HTMLElement>("#hud");
  if (!canvas || !hudRoot) return;

  const { scene, camera, renderer, lighting } = createGameScene(canvas);
  // Post chain (task 1.4): composer render path; CONFIG.quality.postFx is the
  // master bypass back to direct renderer.render, checked per frame below.
  const postfx = createPostFx(renderer, scene, camera);

  // ── Adaptive quality (task 1.5, design D7) ───────────────────────────────
  // The controller is PURE (render/quality.ts, node-tested); this side only
  // APPLIES its outputs. State + knob scratch are preallocated; per-frame
  // work is a few number writes, and renderer/composer writes fire only on
  // actual tier changes (never per frame — setPixelRatio reallocates).
  const qualityState = createQualityState();
  const qualityKnobs: TierKnobs = {
    pixelRatioScale: 0,
    postEnabled: false,
    particleDensity: 0,
    shadowMapSize: 0,
    shadowsOn: false,
  };
  let appliedTier = qualityState.tier;
  let postOn = false;
  /** Dev-only fps override fed to the controller (see __zh.forceFps). */
  let forcedFps: number | null = null;
  /** Last completed frame's totals, for the rendererInfo probe. */
  let frameCalls = 0;
  let framePath: "composer" | "direct" = "direct";

  const applyPixelRatio = (): void => {
    const ratio =
      Math.min(window.devicePixelRatio || 1, CONFIG.quality.maxPixelRatio) *
      qualityKnobs.pixelRatioScale;
    renderer.setPixelRatio(ratio);
    appliedQuality.pixelRatio = ratio;
  };

  /** Pushes one tier's knobs to renderer/composer + the appliedQuality store. */
  const applyQualityTier = (tier: number): void => {
    appliedTier = tier;
    knobsForTier(tier, qualityKnobs);
    applyPixelRatio();
    // Master switch wins: postFx off forces the direct path at every tier.
    postOn = CONFIG.quality.postFx && qualityKnobs.postEnabled;
    postfx.setEnabled(postOn);
    // Shadow map SIZE + capability are consumed by the car-following sun
    // (task 2.1) via the lighting rig; the rig disposes the old shadow map
    // and recompiles materials only when the value actually flips.
    renderer.shadowMap.enabled = qualityKnobs.shadowsOn;
    lighting.applyQuality();
    appliedQuality.tier = tier;
    appliedQuality.pixelRatioScale = qualityKnobs.pixelRatioScale;
    appliedQuality.postEnabled = postOn;
    appliedQuality.particleDensity = qualityKnobs.particleDensity;
    appliedQuality.shadowMapSize = qualityKnobs.shadowMapSize;
    appliedQuality.shadowsOn = qualityKnobs.shadowsOn;
    if (import.meta.env.DEV) {
      console.info(
        `[quality] tier ${tier} — pxRatio ${appliedQuality.pixelRatio.toFixed(2)}, ` +
          `post ${postOn ? "on" : "bypassed"}, particles x${qualityKnobs.particleDensity}, ` +
          `shadows ${qualityKnobs.shadowsOn ? `${qualityKnobs.shadowMapSize}px` : "off"}`,
      );
    }
  };
  applyQualityTier(qualityState.tier); // boot at startTier

  // Mirror renderer resizes into the composer. scene.ts's own listener
  // registered first, so by the time this runs the renderer is already
  // resized — and we re-apply the tier's resolution scale on top of the
  // unscaled DPR that scene.ts's listener just set.
  const onPostResize = () => {
    applyPixelRatio();
    postfx.setPixelRatio(renderer.getPixelRatio());
    postfx.setSize(window.innerWidth, window.innerHeight);
  };
  window.visualViewport?.addEventListener("resize", onPostResize);
  window.addEventListener("resize", onPostResize);
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
  // and the tools/capture.mjs harness read the draw-call budget / sim state,
  // force hull weight for the tilt-danger shots (the true-to-sim path —
  // Session.addWeight persists through the per-step absolute weight sync),
  // step the sim deterministically, choreograph zombie scenarios, and pose
  // the camera for fixed-framing evidence shots. import.meta.env.DEV
  // dead-code eliminates this from prod builds; no gameplay API surface
  // added — everything here reads state or drives existing sim entry points.
  if (import.meta.env.DEV) {
    // Probe-time render target (4x4 offscreen): probe renders must not
    // disturb the displayed frame. Lazily allocated on first probe — this
    // code path is dev-hooks-only and costs nothing in steady state.
    let probeTarget: THREE.WebGLRenderTarget | null = null;
    // Preallocated out-param for the __zh.project probe hook.
    const projOut: ScreenPos = { x: 0, y: 0, offscreen: false };
    window.__zh = {
      rendererInfo: () => {
        // Frame totals from the last COMPLETED frame — reading
        // renderer.info here directly would be corrupted by a prior probe's
        // own renders (double-probe safety).
        const calls = frameCalls;
        // Per-system attribution (task 1.7): probe-time multi-pass counting.
        // Each bucket is hidden for one direct offscreen render; the draw-call
        // delta attributes that bucket's calls. Same camera/frustum, so counts
        // match the composer's scene pass; post = composer overhead. Dev-probe
        // only — zero cost when not probed. Visibility is fully restored; the
        // 4x4 target keeps the displayed canvas untouched (no flicker frame).
        const prevTarget = renderer.getRenderTarget();
        if (!probeTarget) probeTarget = new THREE.WebGLRenderTarget(4, 4);
        renderer.setRenderTarget(probeTarget);

        // world: recycled road segments + skyline + camera-riding sky dome.
        const worldBucket: THREE.Object3D[] = [world.group, camera];
        const skyline = (world as unknown as { skyline?: THREE.Object3D })
          .skyline;
        if (skyline) worldBucket.push(skyline);
        const charBucket: THREE.Object3D[] = [];
        const fxBucket: THREE.Object3D[] = [];
        const view = (session as unknown as { view: ZhViewProbe | null }).view;
        if (view) {
          // characters: the car rig + the five shared horde InstancedMeshes
          // (torso/head/armL/armR + telegraph flash). Obstacle meshes are
          // deliberately unattributed — they land in `other` via residual.
          charBucket.push(
            view.car.root,
            view.zombies.flash,
            view.zombies.slots[0].torso,
            view.zombies.slots[0].head,
            view.zombies.slots[0].arms[0],
            view.zombies.slots[0].arms[1],
          );
          // fx: pooled particle quads + the muzzle flash quad.
          for (const q of view.fx.quads) fxBucket.push(q.mesh);
          fxBucket.push(view.fx.flash.mesh);
        }

        const probeRender = (): number => {
          renderer.info.reset();
          renderer.render(scene, camera);
          return renderer.info.render.calls;
        };
        const diffBucket = (objs: THREE.Object3D[]): number => {
          const saved = objs.map((o) => o.visible);
          for (const o of objs) o.visible = false;
          const without = probeRender();
          objs.forEach((o, i) => {
            o.visible = saved[i];
          });
          return Math.max(0, all - without);
        };
        const all = probeRender();
        const worldCalls = diffBucket(worldBucket);
        const charCalls = diffBucket(charBucket);
        const fxCalls = diffBucket(fxBucket);
        renderer.setRenderTarget(prevTarget);
        const post =
          framePath === "composer" ? Math.max(0, calls - all) : 0;
        return {
          calls,
          renderPath: framePath,
          fps: qualityState.ema,
          tier: appliedQuality.tier,
          pixelRatio: renderer.getPixelRatio(),
          systems: {
            world: worldCalls,
            characters: charCalls,
            fx: fxCalls,
            post,
            // Residual: obstacles + anything unattributed — keeps the sum
            // honest even if a binding reference goes stale.
            other: Math.max(0, all - worldCalls - charCalls - fxCalls),
          },
        };
      },
      debugAddWeight: (side, w) => session.addWeight(side, w),
      carZ: () => session.carZValue,
      play: () => startRunAction(),
      state: () => {
        let clinging = 0;
        let leaping = 0;
        for (const z of session.zombies.all()) {
          if (z.state === "clinging") clinging++;
          else if (z.state === "leaping") leaping++;
        }
        return {
          phase: session.phase,
          level: session.level,
          carX: session.car.x,
          carZ: session.carZValue,
          speed: session.car.speed,
          score: session.scoring.score,
          distM: session.scoring.distanceM,
          kills: session.scoring.kills,
          zombies: session.activeZombieCount,
          clinging,
          leaping,
          drawCalls: renderer.info.render.calls,
        };
      },
      freeze: (on) => {
        if (on && session.phase === "running") session.phase = "paused";
        else if (!on && session.phase === "paused") session.phase = "running";
        return session.phase;
      },
      stepSim: (n) => session.debugStep(n),
      fire: (side) => session.debugFire(side),
      spawnZombie: (type, x, zRel) =>
        session.zombies.spawnLurker(type, x, session.carZValue + zRel) !==
        null,
      pose: (mode) => {
        if (mode === "chase") {
          rig.holdPose = false;
          return { mode };
        }
        const cx = session.car.x;
        const cz = session.carZValue;
        rig.holdPose = true;
        if (mode === "side") {
          // Perpendicular profile: ~5.4 m off the hull, hub height, car
          // center in frame — full 4.4 m silhouette with road context.
          // (Closer/lower reads worse: the dark hull melts into the asphalt.)
          camera.position.set(cx + 5.4, 1.5, cz - 0.4);
          camera.lookAt(cx, 0.75, cz + 0.2);
          return { mode };
        }
        // Lamp corridor: yaw toward the nearest streetlamp ahead so pole,
        // head and the road it pools are framed with the car low in frame.
        // (Baseline scene has lamp geometry only — no pool/beam yet.)
        const lamp = world.nearestLampAhead(cz + 6);
        camera.position.set(cx + lamp.x * 0.3, 2.3, cz - 8);
        camera.lookAt(lamp.x * 0.55, 4.4, lamp.z + 4);
        return { mode, lamp: { x: lamp.x, z: lamp.z } };
      },
      // Quality-controller test hook (task 1.5): pins the fps the adaptive
      // controller sees so tier steps are verifiable in-browser without
      // real load. Stays a dev-only hook (documented in the __zh surface).
      forceFps: (fps) => {
        forcedFps = fps;
      },
      // Lighting hooks (tasks 2.1–2.3): forceLevel reuses Session's existing
      // debug score hook — no new game-side surface; project anchors pixel
      // probes to exact world points through the same worldToScreen path as
      // kill popups. Both dev-only (inside import.meta.env.DEV).
      forceLevel: (level) => {
        const target = scoreForLevel(Math.max(1, Math.floor(level)));
        if (target > session.scoring.score) {
          session.debugAddScore(target - session.scoring.score);
        }
        return session.level;
      },
      project: (x, y, z) => {
        camera.updateMatrixWorld();
        camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
        worldToScreen(x, y, z, camera, canvas.clientWidth, canvas.clientHeight, projOut);
        return { x: projOut.x, y: projOut.y, offscreen: projOut.offscreen };
      },
      // Shadow-state readout for the lighting pixel probes (dev-only).
      lightDebug: () => {
        const s = lighting.sun;
        return {
          pos: s.position.toArray().map((v) => +v.toFixed(2)),
          target: s.target.position.toArray().map((v) => +v.toFixed(2)),
          intensity: +s.intensity.toFixed(2),
          castShadow: s.castShadow,
          mapSize: [s.shadow.mapSize.x, s.shadow.mapSize.y],
          hasMap: !!s.shadow.map,
          ortho: {
            left: s.shadow.camera.left,
            right: s.shadow.camera.right,
            near: s.shadow.camera.near,
            far: s.shadow.camera.far,
          },
          rendererShadowMap: renderer.shadowMap.enabled,
        };
      },
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
  // Named so the __zh.play() capture hook drives the identical path.
  const startRunAction = (): void => {
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
  };
  menus.onPlay(startRunAction);
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
    const rawDt = (now - last) / 1000;
    const dt = Math.min(rawDt, CONFIG.sim.maxFrameDt);
    last = now;
    trackSteer();

    // Adaptive quality (task 1.5): the pure controller runs every frame on
    // measured fps (or the dev forceFps override); applying a tier touches
    // renderer/composer only when the tier actually changes. Allocation-free.
    const measuredFps =
      forcedFps ?? (rawDt > 0 ? 1 / rawDt : CONFIG.quality.fpsTarget);
    stepQuality(qualityState, measuredFps, dt);
    if (qualityState.tier !== appliedTier) {
      applyQualityTier(qualityState.tier);
    }

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
    // Lighting rig (tasks 2.1–2.3): car-following shadow frustum + level
    // mood damp. Reads only sim state; allocation-free.
    lighting.setLevel(session.level);
    lighting.update(session.car.x, session.carZValue, dt);
    rig.follow(session.car.x, session.carZValue, session.speed01, dt);
    rig.tick(dt);
    // renderer.info.autoReset is off (composer runs several internal renders
    // per frame) — reset here so draw-call reads cover the WHOLE frame under
    // either path. postOn honors BOTH the tier's post knob and the
    // CONFIG.quality.postFx master bypass (task 1.5).
    renderer.info.reset();
    if (postOn) postfx.render();
    else renderer.render(scene, camera);
    frameCalls = renderer.info.render.calls;
    framePath = postOn ? "composer" : "direct";

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
