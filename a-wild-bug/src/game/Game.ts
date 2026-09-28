import * as THREE from "three";
import { PMREMGenerator } from "three";
import { DayCycle } from "./world/DayCycle";
import { Sky } from "./world/Sky";
import { Meadow } from "./world/Meadow";
import { Pollen } from "./world/Pollen";
import { Input } from "./player/Input";
import { PlayerController } from "./player/PlayerController";
import { Ant } from "./player/Ant";
import { FollowCamera } from "./camera/FollowCamera";
import { ForageLoop } from "./gameplay/ForageLoop";
import { CarriedGrain } from "./gameplay/CarriedGrain";
import { Puffs } from "./gameplay/Puffs";
import { SpringSeeds } from "./gameplay/SpringSeeds";
import { Hopper } from "./enemies/Hopper";
import { Hud } from "./ui/Hud";
import { Shell } from "./ui/Shell";
import { TouchControls } from "./ui/TouchControls";
import { Teach } from "./ui/Teach";
import { HINTS, scheme } from "./ui/Hints";
import { Audio, type SfxName } from "./audio/Audio";
import { createComposer } from "./render/Post";
import { ShotDirector } from "./debug/ShotDirector";
import type { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import type { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";

const FIXED_DT = 1 / 60;
const MAX_FRAME_DT = 0.25; // clamp after tab switches so the loop never spirals
/** Resume-grace countdown (72 fixed steps): enough to reorient, short to skip. */
const RESUME_GRACE_SECONDS = 1.2;

/** Screen-flow mode wrapping the day; ForageLoop stays the day authority (design D2). */
export type GameMode = "title" | "playing" | "paused" | "results";

/** Scratch for draining accumulated camera-drag while the sim is gated. */
const _dragScratch = new THREE.Vector2();

/**
 * Game shell: owns the renderer, fixed-timestep simulation, day cycle wiring,
 * the forage loop and the screenshot contract. Simulation runs in fixed steps;
 * rendering uses the latest state; the HUD redraws from sim state on a 2D
 * canvas so captures can composite both layers deterministically. A mode
 * machine (title/playing/paused/results, plus a resume-grace sub-state) wraps
 * the day: while not playing, the fixed step, wind and camera all hold so the
 * world reads as a frozen diorama behind menus (design D2).
 */
export class Game {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly dayCycle = new DayCycle();
  readonly seed: number = (() => {
    const raw = new URLSearchParams(window.location.search).get("seed");
    const n = raw ? Number.parseInt(raw, 10) : NaN;
    return Number.isFinite(n) ? n : 1337;
  })();
  readonly meadow: Meadow;
  readonly sky = new Sky();
  readonly pollen: Pollen;
  readonly input: Input;
  readonly controller: PlayerController;
  readonly ant: Ant;
  readonly followCam: FollowCamera;
  readonly puffs: Puffs;
  readonly carried: CarriedGrain;
  readonly springSeeds: SpringSeeds;
  readonly hopper: Hopper;
  readonly loop: ForageLoop;
  readonly hud: Hud;
  readonly shell: Shell;
  readonly touchControls: TouchControls;
  /** First-day teaching hints (onboarding spec): armed on a fresh save only. */
  readonly teach: Teach;
  /** Scheme-aware hint copy (design D5): the table + the latched detector. */
  readonly hints = HINTS;
  readonly scheme = scheme;
  /** Procedural audio (design D4): inert until the first user gesture. */
  readonly audio: Audio;
  readonly composer: EffectComposer;
  readonly shotDirector: ShotDirector;
  readonly gradePass: ShaderPass | null;

  pinned = false;
  windTime = 40;

  /**
   * The one gate between live gameplay event sites and the synthesizer
   * (design D4): staging (`loop.stage`) never routes through the event hooks,
   * and pinned captures drop everything here, so a pinned frame can never
   * schedule sound (task 8.5).
   */
  private readonly onSfx = (name: SfxName): void => {
    if (!this.pinned) this.audio.sfx(name);
  };

  /** Screen-flow mode: boot lands on the title with the sim gated. */
  mode: GameMode = "title";
  /** Seconds left in the resume-grace countdown (0 = not in grace). */
  get graceRemaining(): number {
    return this.graceLeft;
  }
  private graceLeft = 0;

  private readonly sun = new THREE.DirectionalLight(0xffffff, 2.4);
  private readonly rim = new THREE.DirectionalLight(0xffffff, 0.4);
  private readonly hemi = new THREE.HemisphereLight(0xbfd8f0, 0x4c6c2e, 0.8);
  private readonly pmrem: PMREMGenerator;
  private envRT: THREE.WebGLRenderTarget | null = null;
  private envTime = -1;

  private accumulator = 0;
  private lastTime = -1;
  private running = false;
  private firstFrameDone = false;
  private fontsReady = false;
  private static readonly _camDir = new THREE.Vector3();

  // Diagnostics.
  private frameMsAvg = 16.7;
  /** Rolling average of one stepFixed() body (ms) — audio-cost probe seam. */
  private stepMsAvg = 0;
  private readonly info = { fps: 0, frameMs: 0, drawCalls: 0, triangles: 0 };

  /** Additive diagnostics: EMA duration of one fixed sim step (ms). */
  get stepMs(): number {
    return this.stepMsAvg;
  }

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.info.autoReset = false;
    container.appendChild(this.renderer.domElement);

    this.scene.fog = new THREE.Fog(0xb4d8ea, 8, 86);
    this.dayCycle.setTime(0.12); // the forage loop owns time from here on

    // Audio (design D4): created before the shell/touch layers so their
    // controls can read toggle state; the context itself waits for a gesture.
    this.audio = new Audio(this.seed);

    this.meadow = new Meadow(this.seed);
    this.scene.add(this.meadow.group);
    this.scene.add(this.sky.mesh);

    this.hemi.position.set(0, 20, 0);
    this.scene.add(this.hemi);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 90;
    this.sun.shadow.camera.left = -20;
    this.sun.shadow.camera.right = 20;
    this.sun.shadow.camera.top = 20;
    this.sun.shadow.camera.bottom = -20;
    this.sun.shadow.bias = -0.00025;
    this.sun.shadow.normalBias = 0.03;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);
    this.rim.castShadow = false;
    this.scene.add(this.rim);

    this.input = new Input(this.renderer.domElement);
    // Keyboard pause (task 4.4): Esc/P request a pause through the seam; the
    // guard inside pause() keeps it a no-op from menus and the paused state,
    // so it never double-fires with the shell's own Esc/P handling.
    this.input.onPauseRequested = () => this.pause();
    this.controller = new PlayerController(this.meadow, this.input);
    this.ant = new Ant((x, z) => this.meadow.heightAt(x, z));
    this.scene.add(this.ant.group);

    this.followCam = new FollowCamera(this.controller, this.input, (x, z) => this.meadow.heightAt(x, z), window.innerWidth / window.innerHeight);

    this.pollen = new Pollen(this.seed ^ 0x5bf03635);
    this.scene.add(this.pollen.points);

    this.puffs = new Puffs();
    this.puffs.setGround((x, z) => this.meadow.heightAt(x, z));
    this.scene.add(this.puffs.points);

    this.carried = new CarriedGrain(
      this.meadow.grains.grainGeo,
      this.meadow.grains.grainMat,
      (x, z) => this.meadow.heightAt(x, z),
    );
    this.scene.add(this.carried.mesh);

    // Spring seeds contribute their stalk tops to the walkable heightfield
    // (Meadow.heightAt composes them), so the ant rides the sprout.
    this.springSeeds = new SpringSeeds(
      {
        meadow: this.meadow,
        controller: this.controller,
        puffs: this.puffs,
        isPlaying: () => this.loop.phase === "playing",
        onLaunch: () => {
          this.loop.announce("Launched! Ride the arc.");
          this.onSfx("launch");
        },
      },
      this.seed ^ 0x2f6a89d1,
    );
    this.meadow.springSeeds = this.springSeeds;
    this.scene.add(this.springSeeds.group);

    this.loop = new ForageLoop({
      dayCycle: this.dayCycle,
      controller: this.controller,
      ant: this.ant,
      input: this.input,
      followCam: this.followCam,
      grains: this.meadow.grains,
      anthill: this.meadow.anthill,
      carried: this.carried,
      puffs: this.puffs,
      onSfx: this.onSfx,
    });
    this.hopper = new Hopper(
      {
        meadow: this.meadow,
        controller: this.controller,
        ant: this.ant,
        loop: this.loop,
        grains: this.meadow.grains,
        carried: this.carried,
        puffs: this.puffs,
        onSfx: this.onSfx,
      },
      this.seed ^ 0x6f3b9a27,
    );
    this.scene.add(this.hopper.group);
    // Restarting the day resets the whole meadow: grains, pile, seeds, hopper.
    this.loop.onDayStart = () => {
      this.hopper.startDay();
      this.springSeeds.reset();
    };
    this.loop.startDay();

    this.hud = new Hud();
    container.appendChild(this.hud.canvas);
    // First-day teaching (tasks 7.1/7.2): reads wb.taught at boot to decide
    // whether the teaching run happens; beginDay() (the one day-start seam
    // below) consumes it and persists the flag. Never ticks while pinned.
    this.teach = new Teach({
      controller: this.controller,
      grains: this.meadow.grains,
      carried: this.carried,
      loop: this.loop,
    });
    // The DOM shell owns title/pause/results/how-to (design D1); it reads the
    // mode machine once per frame in frame() and appends itself to #shell.
    this.shell = new Shell(this);
    // The touch widget layer (design D3) feeds the same Input surface; it
    // hides itself whenever the mode leaves live play.
    this.touchControls = new TouchControls(this);
    this.syncOverlaySizes();

    // The storybook face for the HUD ships as a bundled woff2; captures wait
    // for it so pinned frames never show a fallback-font flash.
    void Promise.all([
      document.fonts.load('800 32px "Baloo 2"'),
      document.fonts.load('700 32px "Baloo 2"'),
      document.fonts.load('600 32px "Baloo 2"'),
    ])
      .catch(() => undefined)
      .then(() => document.fonts.ready)
      .then(() => {
        this.fontsReady = true;
      });

    this.pmrem = new PMREMGenerator(this.renderer);
    this.composer = createComposer(this.renderer, this.scene, this.followCam.camera);
    this.gradePass = (this.composer.passes.find((p) => (p as ShaderPass).uniforms?.uDuskLift !== undefined) as ShaderPass) ?? null;

    this.shotDirector = new ShotDirector(this);
    (window as unknown as { __wb: ShotDirector }).__wb = this.shotDirector;
    // Debug handle for harness tooling (not used by the game itself).
    (window as unknown as { __wbGame?: Game }).__wbGame = this;

    window.addEventListener("resize", this.onResize);
    document.addEventListener("visibilitychange", this.onVisibilityChange);
  }

  /** Renders `frames` more animation frames before resolving (harness use). */
  settle(frames: number): Promise<void> {
    return new Promise((resolve) => {
      const tick = () => (frames-- <= 0 ? resolve() : requestAnimationFrame(tick));
      requestAnimationFrame(tick);
    });
  }

  /** Renders exactly one frame now (harness motion capture): webgl + HUD. */
  renderFrame(): void {
    this.syncFrame();
    this.composer.render();
    this.renderHud();
  }

  /** HUD redraw from sim state — pure, deterministic (no wall clock). */
  private renderHud(): void {
    // Title (unpinned): the DOM shell owns the screen — keep the quota plaque
    // and toast from peeking through the scrim. Pinned captures render the
    // HUD exactly as always: world shots stage live days and expect it.
    if (!this.pinned && this.mode === "title") {
      this.hud.clear();
      return;
    }
    this.hud.render({
      loop: this.loop,
      uiClock: this.windTime,
      dayT: this.dayCycle.getTime(),
      width: this.hud.canvas.width,
      height: this.hud.canvas.height,
      scheme: scheme.get(),
      threat: this.hopper.threatCue(this.followCam.camera),
      // Teaching hint pill: only while the day is live (never over results).
      teach: this.loop.phase === "playing" ? this.teach.display : null,
      // The capture kill-switch gates reduced-motion flattening: pinned
      // frames render under the pinned contract no matter the user setting.
      pinned: this.pinned,
    });
  }

  private syncOverlaySizes(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const dpr = this.renderer.getPixelRatio();
    this.hud.resize(w, h, dpr);
    const bufferH = h * dpr;
    this.puffs.setScale(bufferH);
    this.meadow.grains.setPointScale(bufferH);
    this.hopper.setPointScale(bufferH);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    requestAnimationFrame(this.frame);
  }

  private frame = (nowMs: number) => {
    const now = nowMs / 1000;
    let frameDt = this.lastTime < 0 ? FIXED_DT : now - this.lastTime;
    this.lastTime = now;
    frameDt = Math.min(frameDt, MAX_FRAME_DT);
    const frameMs = frameDt * 1000;
    this.frameMsAvg += (frameMs - this.frameMsAvg) * 0.1;

    if (!this.pinned) {
      if (this.mode === "playing") {
        this.windTime += frameDt;

        this.accumulator += frameDt;
        // The results flip can happen mid-burst (win/lose resolves inside a
        // step); re-check the mode so no step runs after it.
        while (this.mode === "playing" && this.accumulator >= FIXED_DT) {
          this.stepFixed(FIXED_DT);
          this.accumulator -= FIXED_DT;
        }

        this.followCam.update(frameDt);
      } else {
        this.stepGated(frameDt);
      }
    }

    // Pollen is a pure function of (windTime, focus, wind), so running it in
    // pinned shots too keeps captures pixel-stable.
    this.pollen.update(this.windTime, this.controller.position, this.meadow.grass.shared.uWindDir.value, this.followCam.camera.position);

    this.syncFrame();

    this.renderer.info.reset();
    this.composer.render();
    this.renderHud();
    this.shell.sync();
    this.touchControls.sync();
    this.info.drawCalls = this.renderer.info.render.calls;
    this.info.triangles = this.renderer.info.render.triangles;
    this.info.frameMs = this.frameMsAvg;
    this.info.fps = 1000 / this.frameMsAvg;

    if (!this.firstFrameDone && this.fontsReady) {
      this.firstFrameDone = true;
      this.shotDirector.markReady();
    }
    requestAnimationFrame(this.frame);
  };

  /**
   * One gated frame (title / paused / results, or the resume grace): wind,
   * sim and camera all hold so the world reads as a frozen diorama behind
   * menus (design D2). Input events still fire while gated, so the queues are
   * drained here — otherwise a pause-time Space, or a stale Enter mashed
   * during the win moment, would fire the instant play resumes. The one
   * exception: on results, Enter (or a quick tap) restarts the day, keeping
   * the old win/lose behavior whose in-loop consumer no longer steps.
   */
  private stepGated(frameDt: number): void {
    const confirm = this.input.consumeConfirm();
    this.input.consumeJump();
    this.input.consumeInteract();
    this.input.consumeThrow();
    this.input.consumeDrag(_dragScratch);
    this.input.consumeWheel();
    if (this.mode === "results" && confirm) {
      this.restartDay();
      return;
    }
    if (this.graceLeft > 0) {
      // Resume grace counts down on the fixed-step clock while the sim stays
      // fully gated; resume() activated again mid-count skips it.
      this.accumulator += frameDt;
      while (this.accumulator >= FIXED_DT) {
        this.accumulator -= FIXED_DT;
        this.graceLeft -= FIXED_DT;
        if (this.graceLeft <= 0) {
          this.enterPlaying();
          break;
        }
      }
    }
  }

  // --- mode machine (design D2) ------------------------------------------------

  /** Title → day: a fresh day from dawn via the one reset path. */
  startDayFromTitle(): void {
    if (this.mode !== "title") return;
    this.beginDay();
  }

  /**
   * The ONE day-start seam (tasks 7.1/7.2): every path that actually begins a
   * day (title start, pause restart, results retry) funnels here, so `wb.taught`
   * is written exactly when play begins — never on boot, title visits, or the
   * quit-to-title dawn restage — and the teaching run is consumed once.
   */
  private beginDay(): void {
    this.loop.startDay();
    this.teach.beginDay();
    this.enterPlaying();
  }

  /** Pause is reachable only from live play — menus wrap the day, not vice versa. */
  pause(): void {
    if (this.mode !== "playing") return;
    this.mode = "paused";
    this.accumulator = 0;
    this.graceLeft = 0;
  }

  /**
   * Leaves pause into the resume grace: the sim stays gated through a short
   * fixed-step countdown so the player can reorient. A second activation
   * while the countdown runs skips it and restores live play immediately.
   * The same path serves the visibility auto-pause.
   */
  resume(): void {
    if (this.mode !== "paused") return;
    if (this.graceLeft > 0) {
      this.enterPlaying();
    } else {
      this.graceLeft = RESUME_GRACE_SECONDS;
      this.accumulator = 0;
    }
  }

  /** Retry shared by the pause menu and the results screens (one reset path). */
  restartDay(): void {
    if (this.mode !== "paused" && this.mode !== "results") return;
    this.beginDay();
  }

  /** Ends the day and returns to the held dawn world behind the title. */
  quitToTitle(): void {
    if (this.mode !== "paused" && this.mode !== "results") return;
    this.loop.startDay(); // restage the dawn diorama no matter when we quit
    this.graceLeft = 0;
    this.accumulator = 0;
    this.mode = "title";
  }

  private enterPlaying(): void {
    // Drop anything queued while gated so a stale Enter/Space from the menus
    // can't fire the instant play resumes (e.g. an Enter-started day must not
    // hand a queued confirm to the win screen later on).
    this.input.consumeConfirm();
    this.input.consumeJump();
    this.input.consumeInteract();
    this.input.consumeThrow();
    this.graceLeft = 0;
    this.accumulator = 0;
    this.mode = "playing";
  }

  private onVisibilityChange = (): void => {
    // Auto-pause only from live play; document.hidden is read at event time
    // so a harness-stubbed flag behaves exactly like the real one.
    if (document.hidden && this.mode === "playing") this.pause();
  };

  /**
   * One fixed simulation step. Order matters: the controller moves, the seeds
   * watch for a landing (and may launch), the loop reads the fresh pose for
   * pickup/deposit/throw, then the hopper reacts to the moved ant and the
   * freshly-integrated grain flight (hit → stun).
   */
  stepFixed(dt: number): void {
    const stepStart = performance.now();
    // Input reaches the controller only in live play: mode gating keeps
    // menus input-clean, and during winMoment the ant freezes mid-pose (per
    // spec — the celebration keeps stepping, the steering does not).
    if (this.mode === "playing" && this.loop.phase === "playing") {
      this.controller.update(dt, this.followCam.yaw);
    }
    this.ant.update(dt, {
      pos: this.controller.position,
      yaw: this.controller.yaw,
      planarSpeed: this.controller.planarSpeed,
      forwardAccel: this.controller.forwardAccel,
      turnRate: this.controller.smoothedTurnRate,
      grounded: this.controller.grounded,
      groundY: this.controller.groundY,
    });
    this.springSeeds.tickClock(dt);
    this.springSeeds.update(dt);
    // The forage loop reads the fresh controller pose (pickup/deposit
    // triggers) and drives the carried grain from the posed carry anchor.
    this.loop.update(dt);
    // First-day teaching ticks with the sim (onboarding spec): frozen with
    // pause/menus, never run while pinned (captures never step the sim).
    if (this.loop.phase === "playing") this.teach.tick(dt);
    // Win/lose flip the screen to results once the moment resolves. Checked
    // here rather than in a phase setter because ShotDirector staging writes
    // loop.phase directly while pinned and must not trigger transitions.
    if (this.mode === "playing" && (this.loop.phase === "win" || this.loop.phase === "lose")) {
      this.accumulator = 0;
      this.mode = "results";
    }
    this.hopper.update(dt);
    this.meadow.grains.update(dt);
    this.meadow.anthill.update(dt);
    this.puffs.update(dt);
    this.stepMsAvg += (performance.now() - stepStart - this.stepMsAvg) * 0.05;
  }

  /** Pushes day-cycle state into lights, sky, fog, grass and exposure. */
  private syncFrame(): void {
    const d = this.dayCycle;
    this.sky.sync(d);

    // Lose-state dimming: the light dies as Hopper's shadow falls — but the
    // ambient floor stays high enough that the ant reads as the forlorn
    // subject instead of being crushed to black.
    const dim = this.loop.duskDim;
    this.hemi.color.copy(d.hemiSkyColor);
    this.hemi.groundColor.copy(d.hemiGroundColor);
    this.hemi.intensity = d.hemiIntensity * (1 - 0.22 * dim);

    const antPos = this.controller.position;
    this.sun.color.copy(d.sunColor);
    this.sun.intensity = d.sunIntensity * (1 - 0.6 * dim);
    this.sun.position.copy(antPos).addScaledVector(d.sunDir, 38);
    this.sun.target.position.copy(antPos);
    this.sun.target.updateMatrixWorld();

    this.rim.color.copy(d.rimColor);
    this.rim.intensity = d.rimIntensity * (1 - 0.3 * dim);
    this.rim.position.copy(antPos).addScaledVector(d.rimDir, 12);

    const fog = this.scene.fog as THREE.Fog;
    fog.color.copy(d.horizonColor);
    fog.near = d.fogNear;
    fog.far = d.fogFar * (1 - 0.25 * dim);
    this.renderer.toneMappingExposure = d.exposure * (1 - 0.14 * dim);
    if (this.gradePass) {
      // Dusk/dawn shadow-floor lift: 0 at noon, 1 at the day edges. The
      // sun-timer urgency adds a warm bias, the lose state a heavy one.
      const base = Math.pow(1 - Math.sin(d.getTime() * Math.PI), 2);
      const urgency = this.loop.phase === "playing" ? this.loop.urgency : 0;
      const pulse = 0.5 + 0.5 * Math.sin(this.windTime * 6.6);
      this.gradePass.uniforms.uDuskLift.value = base + urgency * (0.1 + 0.12 * pulse) + dim * 0.62;
      // The snatch "sting": a brief radial smear + red-amber edge flush that
      // decays in the loop's fixed step (0 while calm, so old frames are stable).
      this.gradePass.uniforms.uSting.value = this.loop.sting;
    }

    const grass = this.meadow.grass;
    grass.setTime(this.windTime);
    grass.setPlayer(antPos);
    grass.setCamera(this.followCam.camera.position);
    this.followCam.camera.getWorldDirection(Game._camDir);
    grass.setCameraDir(Game._camDir);
    grass.syncSun(d.sunDir, d.sunColor);
    this.meadow.grains.setTime(this.windTime);
    this.meadow.grains.syncSun(d.sunDir, d.sunColor);
    this.meadow.anthill.setCamera(this.followCam.camera.position);

    this.maybeRegenEnv();
  }

  /** IBL from the sky dome; regenerated only when time-of-day moved. */
  private maybeRegenEnv(): void {
    if (this.envRT && Math.abs(this.dayCycle.getTime() - this.envTime) < 0.04) return;
    this.envTime = this.dayCycle.getTime();
    const rt = this.pmrem.fromScene(this.sky.envScene, 0.04, 0.1, 800);
    this.scene.environment = rt.texture;
    this.scene.environmentIntensity = 0.55;
    this.envRT?.dispose();
    this.envRT = rt;
  }

  diagnostics(): { fps: number; frameMs: number; drawCalls: number; triangles: number } {
    return { ...this.info };
  }

  private onResize = (): void => {
    this.followCam.camera.aspect = window.innerWidth / window.innerHeight;
    this.followCam.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.composer.setSize(window.innerWidth, window.innerHeight);
    this.syncOverlaySizes();
    const size = this.renderer.getSize(new THREE.Vector2());
    if (this.gradePass) this.gradePass.uniforms.uTexel.value.set(1 / size.x, 1 / size.y);
  };
}
