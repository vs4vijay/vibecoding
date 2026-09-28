import * as THREE from "three";
import type { Game } from "../Game";
import type { AntVisualState } from "../player/Ant";
import { LOOP_TUNING, DEPOSIT_MOTES } from "../gameplay/ForageLoop";
import { SEED_TUNING } from "../gameplay/SpringSeeds";
import { HOPPER_TUNING } from "../enemies/Hopper";
import { scheme } from "../ui/Hints";
import type { BurstOpts } from "../gameplay/Puffs";

/**
 * Screenshot contract (tools/shoot.mjs): `window.__wb.ready / shot(name) / info()`.
 * Each shot deterministically pins the world — day time, gait phase, wind
 * phase, ant pose, camera, loop state, HUD frame — so the same seed + shot
 * name is pixel-stable. Captures COMPOSITE the WebGL canvas with the HUD
 * canvas (grab() and every motion cell), so screenshots are representative of
 * what a player sees.
 *
 * The "motion" shot is the exception to stillness: it runs the real
 * simulation for 72 fixed ticks with scripted input (and a real pickup on the
 * way) and resolves with a labeled 2×6-cell composite strip.
 *
 * The DOM-shell scenes (title / howto / paused / results-win / results-lose)
 * are the other exception: they arrange the MODE MACHINE over a pinned world
 * backdrop and resolve with `dom: true` — the harness must screenshot the
 * whole page for those, because grab() composites only the two canvases and
 * the shell is DOM (design D1/D6).
 */
export interface ShotInfo {
  name: string;
  dayTime: number;
  gaitPhase: number;
  windTime: number;
  player: [number, number, number];
  camera: [number, number, number];
  fov: number;
  /**
   * DOM-shell scenes only: the shell lives in the page, not in the canvases,
   * so the harness captures the whole page instead of calling grab().
   */
  dom?: boolean;
}

interface AntPlacement {
  x: number;
  z: number;
  yaw: number;
  speed: number;
  accel: number;
}

interface ShotDef {
  dayT: number;
  gaitPhase: number;
  windTime: number;
  fov: number;
  /** Per-shot override of the camera grass-parting uniforms (see GrassField). */
  camPush?: { radius: number; strength: number };
  /** Near-field melt strength for the grade pass (0 = off). */
  nearBlur?: number;
  /** HUD visible (default true; the anthill beauty shot hides it). */
  hud?: boolean;
  /** Loop/HUD staging, applied after the ant pose is snapped. */
  staging?: (g: Game) => void;
  ant: (g: Game) => AntPlacement;
  camera: (g: Game, antPos: THREE.Vector3) => { pos: THREE.Vector3; look: THREE.Vector3 };
}

/** Day-seconds equivalent of a time-of-day t (HUD clock consistency). */
function dayTToElapsed(t: number): number {
  const span = LOOP_TUNING.dayEndT - LOOP_TUNING.dayStartT;
  return THREE.MathUtils.clamp((t - LOOP_TUNING.dayStartT) / span, 0, 1) * LOOP_TUNING.daySeconds;
}

/**
 * Scenes that arrange the mode machine + DOM shell over a pinned world
 * backdrop instead of staging a live day (design D1/D6). shellShot() resolves
 * them with the dom-capture flag; the harness only reacts to the flag, the
 * scene knowledge lives here.
 */
const SHELL_SCENES = new Set(["title", "howto", "paused", "results-win", "results-lose"]);

/** The shell screen each scene must leave settled (fail-loudly check). */
const SHELL_SCREEN_IDS: Record<string, string> = {
  title: "screen-title",
  howto: "screen-howto",
  paused: "screen-pause",
  "results-win": "screen-win",
  "results-lose": "screen-lose",
};

const dir = (yaw: number, out: THREE.Vector3): THREE.Vector3 => out.set(Math.sin(yaw), 0, Math.cos(yaw));

const WIN_MOTES: BurstOpts = {
  count: 22,
  colorA: 0xffe9a8,
  colorB: 0xf0b452,
  speed: [0.2, 0.6],
  up: 1.0,
  gravity: 0.45,
  drag: 1.1,
  life: [0.8, 1.5],
  size: [0.014, 0.03],
};

// M3 burst palettes (matched to the live gameplay bursts they stand in for).
const CHAFF_BURST: BurstOpts = {
  count: 12,
  colorA: 0xffdf8e,
  colorB: 0xc98d3a,
  speed: [0.35, 0.9],
  up: 0.9,
  gravity: 2.6,
  drag: 1.6,
  life: [0.32, 0.5],
  size: [0.012, 0.03],
};
const DUST_BURST: BurstOpts = {
  count: 12,
  colorA: 0xc7a878,
  colorB: 0x8a6c48,
  speed: [0.25, 0.7],
  up: 0.65,
  gravity: 2.2,
  drag: 2.2,
  life: [0.28, 0.45],
  size: [0.014, 0.034],
};
const WIND_STREAK: BurstOpts = {
  count: 4,
  colorA: 0xdff2ff,
  colorB: 0xffffff,
  speed: [0.15, 0.5],
  up: 0.08,
  gravity: 0,
  drag: 2.4,
  life: [0.2, 0.38],
  size: [0.018, 0.05],
};

const _f = new THREE.Vector3();
const _side = new THREE.Vector3();
const _camPos = new THREE.Vector3();
const _look = new THREE.Vector3();
const _motionCamDir = new THREE.Vector3();
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q1 = new THREE.Quaternion();

export class ShotDirector {
  ready = false;

  constructor(private readonly game: Game) {}

  markReady(): void {
    this.ready = true;
  }

  /**
   * Race-free capture for the harness: render one frame, then composite the
   * WebGL canvas with the HUD canvas and read that back within the same task
   * — the drawing buffer is only guaranteed until the frame composites, so
   * page-level screenshots can race it (they did).
   */
  grab(): string {
    return this.composeFrame();
  }

  /** webgl + HUD composite of the current sim state, read back in-task. */
  private composeFrame(): string {
    const g = this.game;
    g.renderFrame();
    const gl = g.renderer.domElement;
    const ui = g.hud.canvas;
    if (!this.frameCanvas) this.frameCanvas = document.createElement("canvas");
    const c = this.frameCanvas;
    if (c.width !== gl.width || c.height !== gl.height) {
      c.width = gl.width;
      c.height = gl.height;
    }
    const ctx = c.getContext("2d")!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.drawImage(gl, 0, 0);
    ctx.drawImage(ui, 0, 0, c.width, c.height);
    return c.toDataURL("image/png");
  }

  private frameCanvas: HTMLCanvasElement | null = null;

  async shot(name: string): Promise<ShotInfo | string> {
    if (name === "motion") return this.motionShot();
    if (name === "touch") return this.touchShot();
    if (SHELL_SCENES.has(name)) return this.shellShot(name);
    const def = this.defFor(name);
    const g = this.game;

    g.pinned = true;
    g.followCam.setEnabled(false);
    // World captures stage a live day: pin the mode to "playing" so the DOM
    // shell (up on the boot title) never covers a world shot, and the HUD
    // renders exactly as in live play. Shell scenes set their own mode.
    g.mode = "playing";

    const cam = this.pinWorld(def);

    // Let post-fx and the env-map capture settle over a few rendered frames.
    await g.settle(6);

    return {
      name,
      dayTime: g.dayCycle.getTime(),
      gaitPhase: g.ant.gaitPhase,
      windTime: g.windTime,
      player: [g.controller.position.x, g.controller.position.y, g.controller.position.z],
      camera: [cam.position.x, cam.position.y, cam.position.z],
      fov: cam.fov,
    };
  }

  /**
   * Pins the shared deterministic world baseline for one shot def: day time,
   * wind, ant pose, grass-parting uniforms, loop/HUD staging, hopper park and
   * the staged camera with its lens fades. World shots and shell-scene
   * backdrops share this, so what shows around the shell is exactly as
   * deterministic as a world shot. Leaves `cam` positioned; callers settle.
   */
  private pinWorld(def: ShotDef): THREE.PerspectiveCamera {
    const g = this.game;

    g.dayCycle.setTime(def.dayT);
    g.windTime = def.windTime;
    g.meadow.grass.setTime(def.windTime);
    g.meadow.grains.setTime(def.windTime);

    // Camera grass-parting override: low hero framings part a wider corridor
    // so the lens never buries the subject (the interaction, just stronger).
    const shared = g.meadow.grass.shared;
    shared.uCamRadius.value = 2.2;
    shared.uCamPush.value = 0.85;
    if (def.camPush) {
      shared.uCamRadius.value = def.camPush.radius;
      shared.uCamPush.value = def.camPush.strength;
    }
    if (g.gradePass) g.gradePass.uniforms.uNearBlur.value = def.nearBlur ?? 0;

    const place = def.ant(g);
    g.controller.teleport(place.x, place.z, place.yaw);
    g.controller.pin(place.yaw, place.speed, place.accel);
    g.ant.frozen = true;
    g.ant.setGaitTime(def.gaitPhase);
    // Idle sway/breathing clock derives from the pinned wind time so the pose
    // is identical on every run.
    g.ant.setClock((def.windTime * 7.31) % 3600);
    const state: AntVisualState = {
      pos: g.controller.position,
      yaw: g.controller.yaw,
      planarSpeed: g.controller.planarSpeed,
      forwardAccel: g.controller.forwardAccel,
      turnRate: g.controller.smoothedTurnRate,
      grounded: g.controller.grounded,
      groundY: g.controller.groundY,
    };
    g.ant.snapPose(state);
    g.meadow.grass.setPlayer(g.controller.position);

    // Deterministic loop/HUD baseline for every shot: fresh morning state with
    // the day clock matched to the pinned time-of-day, no urgency, no toast.
    g.hud.enabled = def.hud !== false;
    g.loop.stage({ phase: "playing", dayElapsed: dayTToElapsed(def.dayT), urgency: 0 });
    // Seed-pod idle pulse pinned too: its live clock counts from page boot,
    // which varies with font-load timing (the one unpinned visual otherwise).
    g.springSeeds.stageIdleClock(def.windTime % 60);
    // Deterministic hopper baseline: parked out of frame so the patrolling AI
    // (which keeps running while the page is live) can never leak into a
    // pinned frame. M3 threat shots re-stage it in their `staging`.
    g.hopper.stageDefault();
    def.staging?.(g);

    const { pos, look } = def.camera(g, g.controller.position);
    const cam = g.followCam.camera;
    cam.position.copy(pos);
    cam.lookAt(look);
    cam.fov = def.fov;
    cam.updateProjectionMatrix();
    // Lens fades (grit melt) must reflect the STAGED camera deterministically:
    // the pinned loop skips the update that normally drives them.
    g.meadow.anthill.setCamera(cam.position);
    g.meadow.anthill.applyCrumbFade();

    return cam;
  }

  /** Leaves the pinned state and hands control back to the follow camera. */
  unpin(): void {
    const g = this.game;
    g.pinned = false;
    g.ant.frozen = false;
    g.mode = "playing"; // the live day resumes; captures resolve while pinned
    // Restore the default camera-parting uniforms.
    g.meadow.grass.shared.uCamRadius.value = 2.2;
    g.meadow.grass.shared.uCamPush.value = 0.85;
    if (g.gradePass) g.gradePass.uniforms.uNearBlur.value = 0;
    g.hud.enabled = true;
    g.touchControls.forceVisible = false; // the touch scene's override ends here
    scheme.reset(); // the touch scene's latch override ends here too
    if (g.loop.phase !== "playing") g.loop.stageResetToPlaying();
    g.followCam.setEnabled(true);
    g.followCam.snap();
  }

  /**
   * The `touch` scene (design D3/D6): a live-looking mid-haul day with the
   * touch widget layer up — joystick at rest bottom-left, JUMP + ACTION
   * (THROW, since the staging carries a grain) bottom-right, pause top-right.
   * Mode stays "playing" so the HUD renders exactly as in live play, and the
   * widgets are shown via forceVisible (the scene cannot emulate a coarse
   * pointer). Resolves with the dom-capture flag: the widgets are DOM and
   * invisible to grab(). The .pinned kill-switch on #touch (and #shell)
   * collapses every widget transition, keeping the page capture byte-stable.
   */
  private async touchShot(): Promise<ShotInfo> {
    const g = this.game;
    // Same staging as the paused scene: mid-day, ant mid-field with a carried
    // grain, raised chase framing — the widgets frame around it.
    const def = this.defFor("paused");

    g.pinned = true;
    g.followCam.setEnabled(false);
    this.closeHowtoIfOpen();
    // The scene cannot emulate a coarse pointer, so it latches the hint
    // scheme to touch explicitly: HUD affordances render chips and the
    // controls line stays hidden, matching a real touch device. unpin()
    // restores the boot-detected scheme.
    scheme.set("touch");
    this.pinWorld(def);

    g.mode = "playing";
    g.touchControls.forceVisible = true;
    g.touchControls.sync();
    g.shell.sync();

    if (!g.touchControls.root.classList.contains("pinned")) {
      throw new Error(`touch shot: #touch is missing the .pinned class`);
    }
    if (g.touchControls.root.hidden) {
      throw new Error(`touch shot: the widget layer is not visible`);
    }

    // Same settle budget as world shots; .pinned already settled the DOM.
    await g.settle(6);

    const cam = g.followCam.camera;
    return {
      name: "touch",
      dayTime: g.dayCycle.getTime(),
      gaitPhase: g.ant.gaitPhase,
      windTime: g.windTime,
      player: [g.controller.position.x, g.controller.position.y, g.controller.position.z],
      camera: [cam.position.x, cam.position.y, cam.position.z],
      fov: cam.fov,
      dom: true, // capture the page — the widget layer is DOM
    };
  }

  /**
   * DOM-shell scenes (design D1/D6): pin, stage a deterministic world
   * backdrop, arrange the mode machine, settle the shell, and resolve with
   * the dom-capture flag. The harness must screenshot the WHOLE page for
   * these — grab() composites only the WebGL + HUD canvases, so the DOM
   * shell would be missing from the capture.
   */
  private async shellShot(name: string): Promise<ShotInfo> {
    const g = this.game;
    const def = this.defFor(name);

    // Pin FIRST: the .pinned class collapses every shell fade/transition to
    // its end state and the sim + wind freeze, so the arrangement below is
    // synchronous and settled by construction (a forced shell.sync() below
    // applies the class in-task, not on some future frame).
    g.pinned = true;
    g.followCam.setEnabled(false);

    // An earlier scene in the same harness session can have left the how-to
    // modal open; close it through its real control so every scene starts
    // from a clean overlay state.
    this.closeHowtoIfOpen();

    // Shared deterministic world backdrop. The def's hud flag keeps the HUD
    // dark for title/howto (the live screens own the whole display) and lit
    // for paused/results, exactly as a player sees them.
    this.pinWorld(def);

    // Mode arrangement per scene; each branch ends in shell.sync() so the
    // active screen and the .pinned class are applied before this task ends.
    switch (name) {
      case "title":
        g.mode = "title";
        g.shell.sync();
        break;
      case "howto":
        g.mode = "title";
        g.shell.sync();
        // Open through the real title control so the modal state is genuine
        // (the same path the H key and the button take).
        (document.getElementById("btn-howto-title") as HTMLButtonElement).click();
        break;
      case "paused":
        // The live path: pause() is reachable only from "playing", so stage
        // that first no matter what a previous scene left behind.
        g.mode = "playing";
        g.pause();
        g.shell.sync();
        break;
      case "results-win":
      case "results-lose":
        // The shell caches results stats on the transition INTO results; walk
        // playing → results explicitly so a second results scene in one
        // harness session re-caches (live play never revisits, captures do).
        g.mode = "playing";
        g.shell.sync();
        g.mode = "results";
        g.shell.sync();
        break;
    }

    // Fail loudly instead of capturing an unsettled or wrong screen.
    if (!g.shell.root.classList.contains("pinned")) {
      throw new Error(`shell shot "${name}": #shell is missing the .pinned class`);
    }
    const screenId = SHELL_SCREEN_IDS[name];
    const screen = document.getElementById(screenId);
    if (!screen || !screen.classList.contains("on")) {
      throw new Error(`shell shot "${name}": #${screenId} is not the settled screen`);
    }

    // Same settle budget as world shots: post-fx and the env-map re-settle
    // over the staged day time. The DOM needs none of it — .pinned already
    // jumped every fade to its end state.
    await g.settle(6);

    const cam = g.followCam.camera;
    return {
      name,
      dayTime: g.dayCycle.getTime(),
      gaitPhase: g.ant.gaitPhase,
      windTime: g.windTime,
      player: [g.controller.position.x, g.controller.position.y, g.controller.position.z],
      camera: [cam.position.x, cam.position.y, cam.position.z],
      fov: cam.fov,
      dom: true, // capture the page, not the canvas composite
    };
  }

  /** Closes the how-to modal through its real BACK control if it is up. */
  private closeHowtoIfOpen(): void {
    const howto = document.getElementById("screen-howto");
    if (howto?.classList.contains("on")) {
      (document.getElementById("btn-howto-back") as HTMLButtonElement).click();
    }
  }

  /**
   * The M1 gate is "running through grass feels good" — stills can't prove
   * cadence, so this shot runs the REAL simulation: scripted input (sprint +
   * full forward held via the Input module) from a pinned start pose, stepped
   * 72 fixed ticks (1.2 s), with the chase camera and grass uniforms updated
   * per tick. The scripted sprint now also plucks the first grain it passes
   * (the real tryPickup path), so the carry bob and pickup prompt are
   * exercised. Resolves with one labeled composite strip: 2 rows × 6 cells
   * (each 640×360, HUD layer included). Top row samples every 12 ticks (lane
   * progress across the whole 1.2 s); bottom row samples every 5 ticks
   * (~83 ms — at full sprint the gait clamps to 11 Hz, so Δ5 ticks ≈ 0.9 gait
   * cycles), which shows in-cycle leg progression and certifies the
   * L1+R2+L3 vs R1+L2+R3 tripod membership per cell. Deterministic: fixed
   * start pose, fixed wind clock, fixed scripted input.
   */
  private async motionShot(): Promise<string> {
    const g = this.game;
    const FIXED_DT = 1 / 60;
    const CELL_W = 640;
    const CELL_H = 360;
    /** Top row — lane-progress sampling (existing 12-tick cadence). */
    const TOP_TICKS = [12, 24, 36, 48, 60, 72];
    /**
     * Bottom row — 5-tick cadence (~83 ms ≈ 0.9 gait cycles at full sprint,
     * which the ant reaches ~tick 15), so consecutive cells walk through the
     * stride and expose tripod membership. Window 25–50 keeps every cell at
     * full sprint AND covers the corridor-legibility hot zone (ticks 36–48).
     */
    const BOTTOM_TICKS = [25, 30, 35, 40, 45, 50];
    const CAPTURE_TICKS = [...new Set([...TOP_TICKS, ...BOTTOM_TICKS])].sort((a, b) => a - b);
    const captureSet = new Set(CAPTURE_TICKS);

    g.pinned = true; // stop the rAF loop's own simulation
    g.followCam.setEnabled(false);
    // The tick loop below drives the controller manually, and unpin hands a
    // live day back — keep the mode machine consistent (never gated here).
    g.mode = "playing";

    // Pinned world reset — identical every run. The day clock is matched to
    // the pinned 0.2 morning so the forage loop keeps the sun exactly there.
    g.dayCycle.setTime(0.2);
    g.windTime = 40;
    g.meadow.grass.setTime(g.windTime);
    g.meadow.grains.setTime(g.windTime);
    const shared = g.meadow.grass.shared;
    shared.uCamRadius.value = 2.2;
    shared.uCamPush.value = 0.85;
    if (g.gradePass) g.gradePass.uniforms.uNearBlur.value = 0.22;
    g.hud.enabled = true;
    g.loop.stage({ phase: "playing", dayElapsed: dayTToElapsed(0.2), urgency: 0 });
    g.springSeeds.stageIdleClock(40); // pod pulse pinned like the wind clock
    // The hopper must never photobomb the gait strip: park it far away and
    // invisible for the whole motion run (it is not stepped in this loop).
    g.hopper.stageDefault();

    g.controller.teleport(0, 2.2, 0.15);
    g.ant.frozen = false;
    g.ant.setGaitTime(0);
    g.ant.setClock(0);
    g.ant.snapPose({
      pos: g.controller.position,
      yaw: g.controller.yaw,
      planarSpeed: 0,
      forwardAccel: 0,
      turnRate: 0,
      grounded: true,
      groundY: g.controller.groundY,
    });

    // The sprint lane starts just below the home mound; a grain sits mid-lane
    // and the script plucks it (real pickup path, deterministic tick) so the
    // carry bob and throw prompt appear in the late cells.
    g.meadow.grains.ensureNodeNear(0.4, 4.4);
    let pickedUp = false;

    // Scripted input: sprint + full forward held for the whole lane.
    const input = g.input;
    input.move.set(0, 1);
    input.sprint = true;

    const cam = g.followCam.camera;
    const pos = new THREE.Vector3();
    const look = new THREE.Vector3();
    const fwd = new THREE.Vector3();
    const side = new THREE.Vector3();

    const placeChaseCamera = (): void => {
      pos.copy(g.controller.position);
      fwd.set(Math.sin(0.15), 0, Math.cos(0.15));
      side.set(fwd.z, 0, -fwd.x);
      cam.position.copy(pos).addScaledVector(fwd, -1.5).addScaledVector(side, 0.55).setY(pos.y + 0.7);
      const gy = g.meadow.heightAt(cam.position.x, cam.position.z) + 0.3;
      if (cam.position.y < gy) cam.position.y = gy;
      look.copy(pos).addScaledVector(fwd, 0.55).setY(pos.y + 0.12);
      cam.lookAt(look);
      cam.fov = 58;
      cam.updateProjectionMatrix();
    };

    // Capture sizing: 640×360 cells at pixel ratio 1 (HUD canvas matches).
    const size = g.renderer.getSize(new THREE.Vector2());
    const pixelRatio = g.renderer.getPixelRatio();
    g.renderer.setPixelRatio(1);
    g.renderer.setSize(CELL_W, CELL_H);
    g.composer.setSize(CELL_W, CELL_H);
    g.hud.resize(CELL_W, CELL_H, 1);
    g.puffs.setScale(CELL_H);
    g.meadow.grains.setPointScale(CELL_H);

    const cells = new Map<number, string>();
    for (let tick = 1; tick <= 72; tick++) {
      g.windTime += FIXED_DT;
      g.controller.update(FIXED_DT, 0.15);
      g.ant.update(FIXED_DT, {
        pos: g.controller.position,
        yaw: g.controller.yaw,
        planarSpeed: g.controller.planarSpeed,
        forwardAccel: g.controller.forwardAccel,
        turnRate: g.controller.smoothedTurnRate,
        grounded: g.controller.grounded,
        groundY: g.controller.groundY,
      });
      if (!pickedUp && g.meadow.grains.pickableAt(g.controller.position, LOOP_TUNING.pickupRadius)) {
        g.loop.tryPickup();
        pickedUp = true;
      }
      g.loop.update(FIXED_DT);
      g.meadow.grains.update(FIXED_DT);
      g.meadow.anthill.update(FIXED_DT);
      g.puffs.update(FIXED_DT);
      g.meadow.grass.setTime(g.windTime);
      g.meadow.grains.setTime(g.windTime);
      g.meadow.grass.setPlayer(g.controller.position);
      placeChaseCamera();
      g.meadow.anthill.setCamera(cam.position);
      g.meadow.grass.setCamera(cam.position);
      cam.getWorldDirection(_motionCamDir);
      g.meadow.grass.setCameraDir(_motionCamDir);
      g.pollen.update(g.windTime, g.controller.position, g.meadow.grass.shared.uWindDir.value, cam.position);

      if (captureSet.has(tick)) {
        cells.set(tick, this.composeFrame());
      }
    }

    // Restore input, render size and the live game.
    input.move.set(0, 0);
    input.sprint = false;
    g.renderer.setPixelRatio(pixelRatio);
    g.renderer.setSize(size.x, size.y);
    g.composer.setSize(size.x, size.y);
    this.unpin();

    // Compose the labeled 2×6 strip (top: 12-tick cadence, bottom: 5-tick).
    const strip = document.createElement("canvas");
    strip.width = CELL_W * 6;
    strip.height = CELL_H * 2;
    const ctx = strip.getContext("2d")!;
    ctx.fillStyle = "#101410";
    ctx.fillRect(0, 0, strip.width, strip.height);
    const decode = (src: string): Promise<HTMLImageElement> =>
      new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error("motion cell failed to decode"));
        img.src = src;
      });
    const tickList = [...CAPTURE_TICKS];
    const decoded = await Promise.all(tickList.map((tick) => decode(cells.get(tick)!)));
    const byTick = new Map<number, HTMLImageElement>();
    tickList.forEach((tick, i) => byTick.set(tick, decoded[i]));
    const rows = [TOP_TICKS, BOTTOM_TICKS];
    for (let row = 0; row < rows.length; row++) {
      for (let col = 0; col < rows[row].length; col++) {
        const tick = rows[row][col];
        const x = col * CELL_W;
        const y = row * CELL_H;
        ctx.drawImage(byTick.get(tick)!, x, y, CELL_W, CELL_H);
        const label = `tick ${tick} · ${(tick * FIXED_DT).toFixed(2)}s`;
        ctx.font = "600 22px system-ui, sans-serif";
        ctx.textBaseline = "top";
        ctx.lineWidth = 4;
        ctx.strokeStyle = "rgba(0,0,0,0.65)";
        ctx.strokeText(label, x + 14, y + 12);
        ctx.fillStyle = "#ffffff";
        ctx.fillText(label, x + 14, y + 12);
      }
    }
    // Row tags so the two sampling regimes are self-describing in review.
    const rowTags = [
      "every 12 ticks · lane progress",
      "every 5 ticks · ≈0.9 gait cycles per cell",
    ];
    for (let row = 0; row < rowTags.length; row++) {
      const tx = 14;
      const ty = row * CELL_H + CELL_H - 34;
      ctx.font = "600 20px system-ui, sans-serif";
      ctx.textBaseline = "top";
      ctx.lineWidth = 4;
      ctx.strokeStyle = "rgba(0,0,0,0.65)";
      ctx.strokeText(rowTags[row], tx, ty);
      ctx.fillStyle = "#ffffff";
      ctx.fillText(rowTags[row], tx, ty);
    }
    return strip.toDataURL("image/png");
  }

  info(): Record<string, unknown> {
    const g = this.game;
    return {
      ...g.diagnostics(),
      grassInstances: g.meadow.grass.instanceCount,
      seed: g.seed,
      dayTime: g.dayCycle.getTime(),
      pinned: g.pinned,
      forage: {
        phase: g.loop.phase,
        deposited: g.loop.deposited,
        quota: g.loop.quota,
        dayElapsed: Math.round(g.loop.dayElapsed * 10) / 10,
        remaining: Math.round(g.loop.remaining * 10) / 10,
        carried: g.carried.mode,
        nodesIdle: g.meadow.grains.idleCount,
        looseSeeds: g.meadow.grains.looseCount,
      },
      controls:
        "WASD/arrows move · Shift sprint · Space jump · E pick up · F throw · Q/E or mouse-drag orbit · wheel zoom · Enter restart",
    };
  }

  private defFor(name: string): ShotDef {
    switch (name) {
      case "orbit":
        return {
          // Golden low morning: the sun rides low enough to sit in frame, the
          // horizon ramp goes warm, and long shadows rake the meadow.
          dayT: 0.1,
          gaitPhase: 0,
          windTime: 40,
          fov: 52,
          // Low, near-ground framing: part a corridor around the lens only.
          camPush: { radius: 2.6, strength: 0.9 },
          ant: (g) => {
            const sy = sunYawAt(g);
            // 3/4 toward the sun so the shell catches key + rim light.
            return { x: 0, z: 0, yaw: sy + 0.55, speed: 0, accel: 0 };
          },
          camera: (g, antPos) => {
            // Sun-side composition: the camera stands opposite the sun, level
            // gaze lifted so the disc rides the upper-left third; the ant sits
            // lower-left against the glow at hero scale, with the boulder and
            // stalk silhouettes stacking a third depth layer behind.
            const sy = sunYawAt(g);
            dir(sy + Math.PI + 0.75, _f);
            _camPos.copy(antPos).addScaledVector(_f, 2.8).setY(antPos.y + 0.5);
            const groundMin = g.meadow.heightAt(_camPos.x, _camPos.z) + 0.3;
            if (_camPos.y < groundMin) _camPos.y = groundMin;
            _look.copy(antPos);
            _look.x += Math.sin(sy) * 2.2;
            _look.z += Math.cos(sy) * 2.2;
            _look.y = antPos.y + 0.55;
            return { pos: _camPos, look: _look };
          },
        };
      case "run":
        return this.runDef(1.5, 0.55, 0.7, 58);
      case "dusk": {
        // Backlit hero: the camera sits in the guaranteed-bare lens pocket,
        // the ant runs toward the low sun so its shell catches the rim light;
        // the disc rides just above the grass-line horizon.
        const camX = 0.4;
        const camZ = 6.5;
        return {
          dayT: 0.94,
          gaitPhase: 0.3,
          windTime: 77.7,
          fov: 56,
          nearBlur: 0.35,
          camPush: { radius: 2.2, strength: 0.7 },
          ant: (g) => {
            const sy = sunYawAt(g) - 0.15;
            return { x: camX + Math.sin(sy) * 2.2, z: camZ + Math.cos(sy) * 2.2, yaw: sy + 0.42, speed: 2.6, accel: 3 };
          },
          camera: (g, antPos) => {
            _camPos.set(camX, g.meadow.heightAt(camX, camZ) + 0.34, camZ);
            _look.copy(antPos).setY(antPos.y + 0.12);
            return { pos: _camPos, look: _look };
          },
        };
      }
      case "run-front":
        return {
          dayT: 0.2,
          gaitPhase: 0.3,
          windTime: 40,
          fov: 44,
          nearBlur: 0.25,
          // Facing roughly toward the sun so face/eyes catch key light.
          ant: (g) => {
            const yaw = sunYawAt(g) - 0.25;
            return { x: 0, z: 4.2, yaw, speed: 3.4, accel: 6 };
          },
          camera: (g, antPos) => {
            const yaw = sunYawAt(g) - 0.25;
            dir(yaw, _f);
            dir(yaw + 0.38, _side); // near-frontal left 3/4 — face and eyes read
            _camPos.copy(antPos).addScaledVector(_side, 1.05).setY(antPos.y + 0.24);
            _look.copy(antPos).addScaledVector(_f, 0.03).setY(antPos.y + 0.085);
            return { pos: _camPos, look: _look };
          },
        };
      case "portrait": {
        // Anatomy tuning close-up: static ant, near-frontal head shot.
        return {
          dayT: 0.2,
          gaitPhase: 0,
          windTime: 40,
          fov: 30,
          nearBlur: 0.9,
          ant: (g) => {
            const yaw = sunYawAt(g);
            return { x: 0, z: 0, yaw, speed: 0, accel: 0 };
          },
          camera: (g, antPos) => {
            const yaw = sunYawAt(g);
            dir(yaw, _f);
            dir(yaw + 0.4, _side);
            // Camera low + pitched down: the mound apex reads behind the
            // abdomen, not as a pinwheel centerpiece behind the head.
            _camPos.copy(antPos).addScaledVector(_f, 0.52).addScaledVector(_side, 0.22).setY(antPos.y + 0.1);
            _look.copy(antPos).addScaledVector(_f, 0.06).setY(antPos.y + 0.085);
            return { pos: _camPos, look: _look };
          },
        };
      }
      case "grass-closeup": {
        // Camera low inside the grass looking toward the sun; the ant parks
        // between camera and sun as a backlit silhouette.
        const camX = 0.4;
        const camZ = 6.5;
        return {
          dayT: 0.2,
          gaitPhase: 0.55,
          windTime: 21.4,
          fov: 62,
          nearBlur: 1.0,
          ant: (g) => {
            const sy = sunYawAt(g);
            return {
              x: camX + Math.sin(sy) * 1.9,
              z: camZ + Math.cos(sy) * 1.9,
              yaw: sy + 0.5,
              speed: 2.6,
              accel: 3,
            };
          },
          camera: (g, antPos) => {
            _camPos.set(camX, g.meadow.heightAt(camX, camZ) + 0.22, camZ);
            _look.set(antPos.x, g.meadow.heightAt(antPos.x, antPos.z) + 0.1, antPos.z);
            return { pos: _camPos, look: _look };
          },
        };
      }

      // --- M2: the loop -----------------------------------------------------

      case "carry": {
        // Mid-stride on the run lane hauling a grain overhead, morning light,
        // HUD showing progress + throw prompt.
        const def = this.runDef(1.5, 0.55, 0.7, 56);
        return {
          ...def,
          dayT: 0.18,
          staging: (g) => {
            g.loop.stage({
              deposited: 2,
              carryHeld: true,
              dayElapsed: dayTToElapsed(0.18),
              prompt: { key: "F", text: "throw" },
            });
          },
        };
      }
      case "deposit": {
        // Atop the mound at the hole, the sixth grain mid-plunk, flash lit.
        // Staged at dawn with the camera down the entrance bearing: the low
        // sun sits behind the lens, so hole, arc, pile and flank all bathe in
        // the same raking gold instead of drowning in crest shadow.
        return {
          dayT: 0.14,
          gaitPhase: 0,
          windTime: 40,
          fov: 46,
          ant: () => {
            // Standing on the flank just past the hole, facing it.
            return { x: -0.31, z: -0.98, yaw: 0.3, speed: 0, accel: 0 };
          },
          staging: (g) => {
            g.loop.stage({
              deposited: 5,
              depositFrac: 0.42,
              dayElapsed: dayTToElapsed(0.14),
              prompt: { key: null, text: "Deliver to the anthill" },
            });
            // The deposit reward puff, frozen mid-burst beside the flash.
            g.puffs.burst(g.meadow.anthill.holePos, DEPOSIT_MOTES, 0.16);
          },
          camera: (g, antPos) => {
            _camPos.set(-1.35, antPos.y + 1.1, -3.3);
            const groundMin = g.meadow.heightAt(_camPos.x, _camPos.z) + 0.3;
            if (_camPos.y < groundMin) _camPos.y = groundMin;
            _look.copy(g.meadow.anthill.holePos).add(_lookOffset.set(0, -0.05, 0));
            return { pos: _camPos, look: _look };
          },
        };
      }
      case "hud-early": {
        // Wide-ish gameplay framing, morning: quota counter + day track + the
        // pickup prompt all legible, mound home in the background.
        return {
          dayT: 0.15,
          gaitPhase: 0,
          windTime: 40,
          fov: 54,
          ant: (g) => {
            // Standing just off a grain node, facing it and the home mound
            // beyond — prompt + destination both read in one frame. Pulled in
            // to radius ~4.6: at the old 7.2-radius spot the M3 apple
            // photobombed the frame's right edge as a clipped red dome.
            const NX = 3.98;
            const NZ = 2.31;
            const node = g.meadow.grains.ensureNodeNear(NX, NZ);
            const ax = node.pos.x + 0.42;
            const az = node.pos.z + 0.28;
            return { x: ax, z: az, yaw: Math.atan2(node.pos.x - ax, node.pos.z - az), speed: 0, accel: 0 };
          },
          staging: (g) => {
            g.loop.stage({
              deposited: 1,
              dayElapsed: dayTToElapsed(0.15),
              prompt: { key: "E", text: "pick up grain" },
            });
          },
          camera: (g, antPos) => {
            const yaw = Math.atan2(3.98 - antPos.x, 2.31 - antPos.z);
            dir(yaw, _f);
            _side.set(_f.z, 0, -_f.x);
            _camPos.copy(antPos).addScaledVector(_f, -1.7).addScaledVector(_side, 0.42).setY(antPos.y + 0.6);
            const groundMin = g.meadow.heightAt(_camPos.x, _camPos.z) + 0.3;
            if (_camPos.y < groundMin) _camPos.y = groundMin;
            _look.copy(antPos).addScaledVector(_f, 0.6).setY(antPos.y + 0.12);
            return { pos: _camPos, look: _look };
          },
        };
      }
      case "hud-late": {
        // Same framing language at t≈0.9: urgency pulse on, hauling a grain
        // with the sun dying — throw it or run it home.
        return {
          dayT: 0.9,
          gaitPhase: 0.3,
          windTime: 77.7,
          fov: 58,
          ant: () => ({ x: 0, z: 4.2, yaw: 0.15, speed: 3.4, accel: 6 }),
          staging: (g) => {
            g.loop.stage({
              deposited: 4,
              carryHeld: true,
              dayElapsed: dayTToElapsed(0.9),
              prompt: { key: "F", text: "throw" },
            });
          },
          camera: (g, antPos) => {
            dir(0.15, _f);
            _side.set(_f.z, 0, -_f.x);
            _camPos.copy(antPos).addScaledVector(_f, -1.9).addScaledVector(_side, 0.5).setY(antPos.y + 0.85);
            const groundMin = g.meadow.heightAt(_camPos.x, _camPos.z) + 0.3;
            if (_camPos.y < groundMin) _camPos.y = groundMin;
            _look.copy(antPos).addScaledVector(_f, 0.55).setY(antPos.y + 0.12);
            return { pos: _camPos, look: _look };
          },
        };
      }
      case "win": {
        // Quota in the vault: Pip atop the mound, pile glowing, banner up.
        // Morning light down the entrance bearing keeps the mound golden.
        return {
          dayT: 0.16,
          gaitPhase: 0,
          windTime: 40,
          fov: 46,
          ant: () => ({ x: 0.42, z: -0.68, yaw: -2.6, speed: 0, accel: 0 }),
          staging: (g) => {
            g.loop.stage({ phase: "win", phaseT: 1.6, deposited: 6, dayElapsed: dayTToElapsed(0.16) });
            g.meadow.anthill.stageGlint(0.35);
            g.puffs.burst(g.meadow.anthill.holePos, WIN_MOTES, 0.9);
          },
          camera: (g, antPos) => {
            _camPos.set(-2.5, antPos.y + 1.55, -4.4);
            const groundMin = g.meadow.heightAt(_camPos.x, _camPos.z) + 0.3;
            if (_camPos.y < groundMin) _camPos.y = groundMin;
            _look.set(-0.1, g.meadow.anthill.holePos.y * 0.75, -0.45);
            return { pos: _camPos, look: _look };
          },
        };
      }
      case "lose": {
        // Sunset with the quota unmet: the light dies, the banner lands.
        return {
          dayT: 0.985,
          gaitPhase: 0,
          windTime: 77.7,
          fov: 48,
          ant: () => ({ x: 0.95, z: 1.3, yaw: -2.83, speed: 0, accel: 0 }),
          staging: (g) => {
            g.loop.stage({
              phase: "lose",
              phaseT: 2.4,
              deposited: 3,
              dayElapsed: LOOP_TUNING.daySeconds,
              duskDim: 1,
            });
          },
          camera: (g, antPos) => {
            _camPos.set(2.3, antPos.y + 0.7, 3.9);
            const groundMin = g.meadow.heightAt(_camPos.x, _camPos.z) + 0.3;
            if (_camPos.y < groundMin) _camPos.y = groundMin;
            _look.set(0.35, antPos.y + 0.15, 1.2);
            return { pos: _camPos, look: _look };
          },
        };
      }
      case "anthill": {
        // Beauty shot: the finished mound at dawn, pile grown, Pip beside the
        // hole for scale, camera down the entrance bearing with the sun
        // behind the mound's shoulder. HUD hidden — pure environment framing.
        return {
          dayT: 0.13,
          gaitPhase: 0,
          windTime: 40,
          fov: 40,
          camPush: { radius: 3.0, strength: 0.9 },
          hud: false,
          ant: () => ({ x: -0.85, z: -0.45, yaw: -2.99, speed: 0, accel: 0 }),
          staging: (g) => {
            g.loop.stage({ deposited: 6, dayElapsed: dayTToElapsed(0.13) });
          },
          camera: (g, _antPos) => {
            _camPos.set(-1.7, 1.55, -4.6);
            const groundMin = g.meadow.heightAt(_camPos.x, _camPos.z) + 0.35;
            if (_camPos.y < groundMin) _camPos.y = groundMin;
            _look.set(0, 0.5, -0.25);
            return { pos: _camPos, look: _look };
          },
        };
      }
      // --- M3: the hopper, the steal and the high route ---------------------

      case "hopper-hero": {
        // 3/4-front grasshopper beauty: half-reared alert in the mid-field
        // morning light, near blades for scale, HUD off (anthill-shot rules).
        const HX = -4.6;
        const HZ = 3.4;
        return {
          dayT: 0.15,
          gaitPhase: 0,
          windTime: 40,
          fov: 42,
          nearBlur: 0.55,
          hud: false,
          ant: (g) => {
            const sy = sunYawAt(g);
            // Park the ant a little behind the lens: keeps the shadow camera
            // and grass-parting nearby without photobombing the frame.
            const cb = sy - 0.55;
            return { x: HX + Math.sin(cb) * 3.0, z: HZ + Math.cos(cb) * 3.0, yaw: sy, speed: 0, accel: 0 };
          },
          staging: (g) => {
            const sy = sunYawAt(g);
            g.hopper.stage({
              x: HX,
              z: HZ,
              yaw: sy + 0.07, // body 3/4 to the lens, sun-side key on the shell
              state: "spot",
              stateT: 0.34, // rear ≈ 0.62 — the alert half-rear telegraph
              gaitTime: 0.13,
              anim: 2.1,
              suspicion: 0.6,
              headYaw: -0.35, // eyes toward the camera
            });
            g.hopper.threatLevel = 0; // beauty shot: no danger HUD
            g.loop.stage({ deposited: 3, dayElapsed: dayTToElapsed(0.15), urgency: 0 });
          },
          camera: (g) => {
            const sy = sunYawAt(g);
            const hy = g.meadow.heightAt(HX, HZ);
            // Camera stands sun-side, low among the blades; eye-line just
            // above frame center so the reared silhouette towers slightly.
            _camPos.set(HX + Math.sin(sy - 0.55) * 1.05, hy + 0.34, HZ + Math.cos(sy - 0.55) * 1.05);
            const groundMin = g.meadow.heightAt(_camPos.x, _camPos.z) + 0.16;
            if (_camPos.y < groundMin) _camPos.y = groundMin;
            _look.set(HX, hy + 0.18, HZ);
            return { pos: _camPos, look: _look };
          },
        };
      }
      case "hopper-chase": {
        // Chase in progress: the hauler sprints up the lane with the hopper
        // mid-hop behind, motion readable, HUD danger eye at full burn.
        return {
          dayT: 0.3,
          gaitPhase: 0.3,
          windTime: 55.5,
          fov: 62,
          ant: () => ({ x: 0, z: 4.2, yaw: 0.15, speed: 3.4, accel: 6 }),
          staging: (g) => {
            const yaw = 0.15;
            const fx = Math.sin(yaw);
            const fz = Math.cos(yaw);
            // Hopper one unit behind the ant, staggered toward the camera so
            // it reads large mid-frame between the lens and its prey.
            const hx = -fx * 1.0 + fz * 0.9;
            const hz = 4.2 - fz * 1.0 - fx * 0.9;
            const hYaw = Math.atan2(0 - hx, 4.2 - hz); // homed on the ant
            g.loop.stage({
              deposited: 1,
              carryHeld: true,
              dayElapsed: dayTToElapsed(0.3),
              urgency: 0,
              prompt: { key: "F", text: "throw" },
            });
            g.hopper.stage({
              x: hx,
              z: hz,
              yaw: hYaw,
              state: "chase",
              stateT: 0.42,
              speed: HOPPER_TUNING.chaseSpeed,
              airHeight: 0.1,
              airPitch: 0.3,
              gaitTime: 0.42,
              anim: 1.3,
              suspicion: 1,
            });
            // Fresh landing dust kicking up behind the leap.
            _v1.set(hx - fx * 0.24, g.meadow.heightAt(hx - fx * 0.24, hz - fz * 0.24) + 0.02, hz - fz * 0.24);
            g.puffs.burst(_v1, DUST_BURST, 0.1);
          },
          camera: (g, antPos) => {
            dir(0.15, _f);
            _side.set(_f.z, 0, -_f.x);
            _camPos.copy(antPos).addScaledVector(_f, -2.05).addScaledVector(_side, 1.1).setY(antPos.y + 0.8);
            const groundMin = g.meadow.heightAt(_camPos.x, _camPos.z) + 0.3;
            if (_camPos.y < groundMin) _camPos.y = groundMin;
            _look.copy(antPos).addScaledVector(_f, 0.25).setY(antPos.y + 0.09);
            return { pos: _camPos, look: _look };
          },
        };
      }
      case "steal": {
        // The snatch beat: hopper reared at the apex with the grain in its
        // mandibles, Pip knocked back mid-stumble, sting pulse + toast up.
        const HX = 4.5;
        const HZ = 5.8;
        const hy2 = 2.6; // hopper yaw
        return {
          dayT: 0.34,
          gaitPhase: 0.42,
          windTime: 62.3,
          fov: 50,
          ant: () => {
            const ax = HX + Math.sin(hy2) * 0.85;
            const az = HZ + Math.cos(hy2) * 0.85;
            return { x: ax, z: az, yaw: hy2, speed: 1.1, accel: -7.5 }; // stumbling away, leaned back
          },
          staging: (g) => {
            g.loop.stage({
              deposited: 2,
              dayElapsed: dayTToElapsed(0.34),
              urgency: 0,
              toast: "Snatched! Run next time.",
            });
            g.loop.sting = 0.8; // the GradePass red flush at full beat
            g.hopper.stage({
              x: HX,
              z: HZ,
              yaw: hy2,
              state: "snatch",
              stateT: 0.3, // just past the grab (0.23): reared high, grain held
              speed: 0,
              gaitTime: 0.2,
              anim: 2.7,
              carry: true,
            });
            // Knockback chaff still hanging around the stumbling ant.
            _v1.set(
              HX + Math.sin(hy2) * 0.95,
              g.meadow.heightAt(HX + Math.sin(hy2) * 0.95, HZ + Math.cos(hy2) * 0.95) + 0.05,
              HZ + Math.cos(hy2) * 0.95,
            );
            g.puffs.burst(_v1, CHAFF_BURST, 0.12);
          },
          camera: (g) => {
            const sy = sunYawAt(g);
            const midX = HX + Math.sin(hy2) * 0.42;
            const midZ = HZ + Math.cos(hy2) * 0.42;
            // Sun-side 3/4 pulled wider (azimuth +1.5, height up): the old
            // sy+1.25 bearing put a tall dry blade right across the rearing
            // head and the snatched grain, hiding the beat itself.
            _camPos.set(midX + Math.sin(sy + 1.5) * 1.55, 0, midZ + Math.cos(sy + 1.5) * 1.55);
            _camPos.y = g.meadow.heightAt(_camPos.x, _camPos.z) + 0.48;
            _look.set(midX, g.meadow.heightAt(midX, midZ) + 0.19, midZ);
            return { pos: _camPos, look: _look };
          },
        };
      }
      case "stunned": {
        // The recover moment: the hopper dizzy-wobbles under circling stars,
        // the dropped grain lies within reach, Pip closes in.
        const HX = -2.2;
        const HZ = 6.6;
        const hy2 = 1.9;
        return {
          dayT: 0.44,
          gaitPhase: 0,
          windTime: 47.7,
          fov: 46,
          ant: () => {
            const ab = hy2 + 2.2; // bearing hopper → ant
            const ax = HX + Math.sin(ab) * 1.15;
            const az = HZ + Math.cos(ab) * 1.15;
            return { x: ax, z: az, yaw: ab + Math.PI, speed: 0, accel: 0 }; // facing it
          },
          staging: (g) => {
            g.loop.stage({
              deposited: 2,
              dayElapsed: dayTToElapsed(0.44),
              urgency: 0,
              toast: "Stunned! Grab it back!",
            });
            g.hopper.stage({
              x: HX,
              z: HZ,
              yaw: hy2,
              state: "stunned",
              stun: true,
              stunClock: 2.0, // star orbit + body/head wobble phase
              speed: 0,
              gaitTime: 0.1,
              anim: 3.1,
            });
            // The dropped grain, where dropGrain() would have left it —
            // biased to the camera side of the hopper so the prize the ant
            // is crawling toward stays in frame.
            const sy3 = sunYawAt(g);
            const gb = sy3 - 0.55;
            _v1.set(HX + Math.sin(gb) * 0.55, 0, HZ + Math.cos(gb) * 0.55);
            _v1.y = g.meadow.heightAt(_v1.x, _v1.z) + 0.018;
            _q1.setFromAxisAngle(_upAxis, 0.7);
            g.meadow.grains.stageLoose(_v1, _q1, 1);
          },
          camera: (g) => {
            const sy = sunYawAt(g);
            const hy = g.meadow.heightAt(HX, HZ);
            _camPos.set(HX + Math.sin(sy - 0.9) * 1.6, hy + 0.46, HZ + Math.cos(sy - 0.9) * 1.6);
            const groundMin = g.meadow.heightAt(_camPos.x, _camPos.z) + 0.2;
            if (_camPos.y < groundMin) _camPos.y = groundMin;
            const ab = hy2 + 2.2;
            _look.set(HX + Math.sin(ab) * 0.5, hy + 0.16, HZ + Math.cos(ab) * 0.5);
            return { pos: _camPos, look: _look };
          },
        };
      }
      case "seed-launch": {
        // The money shot: Pip rides the spring-seed arc high over the sprawl
        // with the fallen apple ahead — solved from the seed's real ballistic
        // solution (gravity 26, no apex hang) so the still matches live play.
        const SEED = 3;
        const T = 0.42; // just past the apex: ~3.1 u up, apple ahead-below
        const arcPos = (g: Game, t: number, out: THREE.Vector3): THREE.Vector3 => {
          const sol = g.springSeeds.getSolution(SEED)!;
          return out.set(
            sol.p0.x + sol.v0.x * t,
            sol.p0.y + sol.v0.y * t - 0.5 * SEED_TUNING.gravity * t * t,
            sol.p0.z + sol.v0.z * t,
          );
        };
        return {
          dayT: 0.27,
          gaitPhase: 0.35,
          windTime: 58.4,
          fov: 58,
          ant: (g) => {
            const sol = g.springSeeds.getSolution(SEED)!;
            const vx = sol.v0.x;
            const vz = sol.v0.z;
            arcPos(g, T, _v1);
            return { x: _v1.x, z: _v1.z, yaw: Math.atan2(vx, vz), speed: Math.hypot(vx, vz), accel: 0 };
          },
          staging: (g) => {
            const sol = g.springSeeds.getSolution(SEED)!;
            arcPos(g, T, _v1);
            const vy = sol.v0.y - SEED_TUNING.gravity * T;
            // Fly the controller: real launch impulse at the arc point.
            g.controller.position.copy(_v1);
            g.controller.launch(sol.v0.x, vy, sol.v0.z);
            g.controller.groundY = g.meadow.heightAt(_v1.x, _v1.z);
            g.ant.frozen = true;
            g.ant.snapPose({
              pos: g.controller.position,
              yaw: g.controller.yaw,
              planarSpeed: Math.hypot(sol.v0.x, sol.v0.z),
              forwardAccel: 0,
              turnRate: 0,
              grounded: false,
              groundY: g.controller.groundY,
            });
            g.meadow.grass.setPlayer(g.controller.position);
            // Launch site: the stalk snapped back into recoil.
            g.springSeeds.stageFlight(SEED);
            // Wind-rush streaks trailing back down the arc.
            for (let i = 1; i <= 3; i++) {
              const t = T - i * 0.09;
              if (t <= 0) break;
              arcPos(g, t, _v1);
              _v1.y += 0.06;
              _v2.set(sol.v0.x, vy - SEED_TUNING.gravity * (T - t), sol.v0.z).multiplyScalar(-0.3);
              g.puffs.burst(_v1, { ...WIND_STREAK, velocity: _v2 }, 0.04 + i * 0.05);
            }
            g.loop.stage({ deposited: 2, dayElapsed: dayTToElapsed(0.27), urgency: 0 });
            g.hopper.stageDefault();
          },
          camera: (g, antPos) => {
            const sol = g.springSeeds.getSolution(SEED)!;
            _f.set(sol.v0.x, 0, sol.v0.z).normalize();
            _side.set(_f.z, 0, -_f.x);
            // Close side-3/4 on the outside of the arc: Pip fills the upper
            // third in profile (back -0.8, side 1.15), the look pitches down
            // the flight line swung apple-side so the apple catches the
            // lower-right third and the meadow sprawls to the horizon.
            _camPos.copy(antPos).addScaledVector(_f, -0.8).addScaledVector(_side, 1.15).setY(antPos.y + 0.5);
            _look.copy(antPos).addScaledVector(_f, 2.6).addScaledVector(_side, -0.5).setY(antPos.y - 1.25);
            return { pos: _camPos, look: _look };
          },
        };
      }
      case "ledge": {
        // High-route payoff: Pip atop the fallen apple beside the rich grain
        // patch, the whole meadow sprawled out below the crest.
        const AX = 5.79; // just off patch spot 6, on the southwest crest edge
        const AZ = -3.71;
        return {
          dayT: 0.68,
          gaitPhase: 0.2,
          windTime: 63.3,
          fov: 42,
          ant: () => ({ x: AX, z: AZ, yaw: -0.83, speed: 0, accel: 0 }), // 3/4 toward the lens
          staging: (g) => {
            g.loop.stage({
              deposited: 3,
              dayElapsed: dayTToElapsed(0.68),
              urgency: 0,
              prompt: { key: "E", text: "pick up grain" },
            });
            g.hopper.stageDefault();
          },
          camera: (g, antPos) => {
            // Crest vista from OUTSIDE the crest, pulled back and raised: the
            // old 1.0 u / +0.4 framing put the featureless near dome across
            // two thirds of the frame and hid the windfall patch behind the
            // crest line (the ears poked up as bare sticks). From 2.2 u out,
            // +1.15 up, pitched down the far slope, Pip, the patch ears and
            // the meadow sprawl land in one read.
            _v1.set(antPos.x - g.meadow.apple.center.x, 0, antPos.z - g.meadow.apple.center.z).normalize();
            _camPos.copy(antPos).addScaledVector(_v1, 2.2).setY(antPos.y + 1.15);
            const groundMin = g.meadow.heightAt(_camPos.x, _camPos.z) + 0.2;
            if (_camPos.y < groundMin) _camPos.y = groundMin;
            // Look down the patch (centroid of the windfall spots) so the ears
            // read as a prize spread on the crest, not silhouette sticks.
            _look.set(0, 0, 0);
            for (let i = 0; i < g.meadow.apple.patchSpotCount; i++) _look.add(g.meadow.apple.patchSpot(i));
            _look.divideScalar(g.meadow.apple.patchSpotCount).setY(antPos.y + 0.28);
            return { pos: _camPos, look: _look };
          },
        };
      }
      // --- B3: the DOM shell (design D1/D6) ---------------------------------
      // These scenes arrange the MODE MACHINE, not a live day: shellShot()
      // stages the world backdrop below, then flips the mode and settles the
      // shell. They resolve with the dom-capture flag because the shell is
      // DOM and invisible to the canvas grab.

      case "title": {
        // The boot diorama: Pip idle atop the home mound at dawn, camera
        // pulled back so the hero reads upper-right of frame — above the
        // centered title column on wide screens and above the logo in
        // portrait. HUD dark: a player on the title never sees the plaque.
        return {
          dayT: LOOP_TUNING.dayStartT,
          gaitPhase: 0,
          windTime: 40,
          fov: 46,
          hud: false,
          ant: () => ({ x: 0.42, z: -0.68, yaw: 0.2, speed: 0, accel: 0 }),
          camera: (g, antPos) => {
            // Raised 3/4 from the spawn side, panned past the mound so the
            // crest and its tenant sit above the title text, not behind it.
            _camPos.set(1.6, antPos.y + 1.5, 4.8);
            const groundMin = g.meadow.heightAt(_camPos.x, _camPos.z) + 0.3;
            if (_camPos.y < groundMin) _camPos.y = groundMin;
            _look.set(-0.9, -0.15, -0.5);
            return { pos: _camPos, look: _look };
          },
        };
      }
      case "howto":
        // The title diorama with the how-to modal up: same backdrop, same
        // hidden HUD (shellShot opens the modal through the real control).
        return this.defFor("title");
      case "paused": {
        // A mid-haul moment frozen by the pause gate: the chase view raised
        // and pitched down the lane so the hauler reads BELOW the centered
        // panel (wide) / beneath it (portrait) instead of behind it, quota
        // progress + carried grain on the HUD exactly as play left them.
        return {
          dayT: 0.3,
          gaitPhase: 0.3,
          windTime: 40,
          fov: 58,
          ant: () => ({ x: 0, z: 4.2, yaw: 0.15, speed: 3.4, accel: 6 }),
          staging: (g) => {
            g.loop.stage({
              deposited: 2,
              carryHeld: true,
              dayElapsed: dayTToElapsed(0.3),
              urgency: 0,
            });
          },
          camera: (g, antPos) => {
            dir(0.15, _f);
            _side.set(_f.z, 0, -_f.x);
            _camPos
              .copy(antPos)
              .addScaledVector(_f, -2.2)
              .addScaledVector(_side, 0.5)
              .setY(antPos.y + 2.1);
            const groundMin = g.meadow.heightAt(_camPos.x, _camPos.z) + 0.3;
            if (_camPos.y < groundMin) _camPos.y = groundMin;
            _look.copy(antPos).addScaledVector(_f, 2.0).setY(antPos.y);
            return { pos: _camPos, look: _look };
          },
        };
      }
      case "results-win": {
        // The celebration behind the results panel: the win beat's framing
        // pulled back and panned so mound + Pip read clear of the centered
        // parchment, morning gold behind it. Stats are end-of-day plausible.
        return {
          dayT: 0.16,
          gaitPhase: 0,
          windTime: 40,
          fov: 50,
          ant: () => ({ x: 0.42, z: -0.68, yaw: -2.6, speed: 0, accel: 0 }),
          staging: (g) => {
            g.loop.stage({ phase: "win", phaseT: 1.6, deposited: 6, dayElapsed: 95 });
            g.meadow.anthill.stageGlint(0.35);
            g.puffs.burst(g.meadow.anthill.holePos, WIN_MOTES, 0.9);
          },
          camera: (g, antPos) => {
            _camPos.set(-3.4, antPos.y + 2.1, -6.2);
            const groundMin = g.meadow.heightAt(_camPos.x, _camPos.z) + 0.3;
            if (_camPos.y < groundMin) _camPos.y = groundMin;
            // Panned right of the mound: mound + Pip + the full pile land in
            // the left third, beside the centered parchment instead of
            // behind it (portrait crops them behind the panel — there the
            // wash + sky read as the celebration backdrop).
            _look.set(-1.4, g.meadow.anthill.holePos.y * 0.9, 1.55);
            return { pos: _camPos, look: _look };
          },
        };
      }
      case "results-lose": {
        // The dusk defeat behind the panel: the lose beat pulled wider, the
        // forlorn ant panned off-center under the dying light.
        return {
          dayT: 0.985,
          gaitPhase: 0,
          windTime: 77.7,
          fov: 52,
          ant: () => ({ x: 0.95, z: 1.3, yaw: -2.83, speed: 0, accel: 0 }),
          staging: (g) => {
            g.loop.stage({
              phase: "lose",
              phaseT: 2.4,
              deposited: 3,
              dayElapsed: LOOP_TUNING.daySeconds,
              duskDim: 1,
            });
          },
          camera: (g, antPos) => {
            _camPos.set(3.2, antPos.y + 1.1, 5.4);
            const groundMin = g.meadow.heightAt(_camPos.x, _camPos.z) + 0.3;
            if (_camPos.y < groundMin) _camPos.y = groundMin;
            // Panned right of the forlorn ant so she reads in the left third
            // beside the panel, under the dying light (portrait keeps the
            // dusk vista as the backdrop).
            _look.set(2.2, antPos.y + 0.3, 0.5);
            return { pos: _camPos, look: _look };
          },
        };
      }
      default:
        throw new Error(`unknown shot "${name}"`);
    }
  }

  /** Low chase camera behind-left of a sprinting ant. */
  private runDef(
    back: number,
    leftOff: number,
    up: number,
    fov: number,
    over: Partial<{ dayT: number; windTime: number }> = {},
  ): ShotDef {
    return {
      dayT: over.dayT ?? 0.2,
      gaitPhase: 0.3,
      windTime: over.windTime ?? 40,
      fov,
      ant: () => ({ x: 0, z: 4.2, yaw: 0.15, speed: 3.4, accel: 6 }),
      camera: (_g, antPos) => {
        dir(0.15, _f);
        _side.set(_f.z, 0, -_f.x); // ant's left
        _camPos
          .copy(antPos)
          .addScaledVector(_f, -back)
          .addScaledVector(_side, leftOff)
          .setY(antPos.y + up);
        _look.copy(antPos).addScaledVector(_f, 0.55).setY(antPos.y + 0.12);
        return { pos: _camPos, look: _look };
      },
    };
  }
}

/** Horizontal bearing of the sun for the currently pinned day time. */
function sunYawAt(g: Game): number {
  const d = g.dayCycle.sunDir;
  return Math.atan2(d.x, d.z);
}

const _lookOffset = new THREE.Vector3();
const _upAxis = new THREE.Vector3(0, 1, 0);
