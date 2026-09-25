/**
 * @file main.js
 * Engine boot + application shell for ENDLESS (slice 1).
 *
 * Assembles renderer / post / sky / world / dust / menu, runs the fixed-step
 * loop (60 Hz sim + render interpolation), drives the menu dolly + attract
 * camera rigs, the shell state machine (LOADING -> MENU -> GAME with a
 * PAUSED flag -> GAMEOVER) with per-state action routing, QA hooks, resize,
 * visibility auto-pause and WebGL context-loss recovery. Zero console noise.
 */
import * as THREE from "three";
import { CONFIG, QUALITY_ORDER, detectQualityTier, getQualityPreset } from "./core/config.js";
import { initRunSeed } from "./core/rng.js";
import { materialLibrary } from "./core/assets.js";
import { createRenderer, PostPipeline, PerfMonitor, detectSoftwareGL } from "./core/renderer.js";
import { SkySystem } from "./core/sky.js";
import { InputManager } from "./core/input.js";
import { AudioManager } from "./core/audio.js";
import { loadSave, saveSettings, saveSave, recordBest } from "./core/save.js";
import { World } from "./world/world.js";
import { createRunMode } from "./modes/run.js";
import { MenuUI } from "./ui/menu.js";
import { PauseUI } from "./ui/pause.js";
import { GameoverUI } from "./ui/gameover.js";
import { HudUI } from "./ui/hud.js";
import { initQaHooks, markFrameRendered, resolveReady } from "../qa/hooks.js";

const State = { LOADING: "loading", MENU: "menu", GAME: "game", GAMEOVER: "gameover" };
const MODES = ["run", "drive", "ride"];
const nextFrame = () => new Promise((r) => requestAnimationFrame(r));

export async function boot() {
  // ---- QA params, save, seed, tier --------------------------------------
  const qa = initQaHooks();
  const params = new URLSearchParams(window.location.search);
  const save = loadSave();

  // Quality: saved settings fill the gap; ?quality= wins and persists.
  let tier = detectQualityTier(params);
  if (!qa.quality && save.settings.quality && QUALITY_ORDER.includes(save.settings.quality)) {
    tier = save.settings.quality;
  }
  let preset = getQualityPreset(tier);

  const seed = initRunSeed(params);
  window.__QA.seed = String(seed);

  const loadFill = document.getElementById("load-fill");
  const setProgress = (frac) => {
    if (loadFill) loadFill.style.width = `${Math.round(frac * 100)}%`;
    if (qa.qa) console.info(`[boot] stage ${frac} ${performance.now() | 0}ms`); // boot timing (QA only)
  };

  // ---- renderer / scene --------------------------------------------------
  const canvas = document.getElementById("gl");
  let renderer;
  try {
    renderer = createRenderer(canvas, preset);
  } catch {
    const fail = document.getElementById("boot-fail");
    if (fail) fail.style.display = "grid";
    return; // no WebGL — stay silent, show notice
  }

  // Software rasterizers (SwiftShader/llvmpipe captures) stall seconds per
  // shader program, so cap the DEFAULT tier at medium there: no SMAA, 1024
  // shadows, cheap texture sets. An explicit ?quality= override still wins.
  const softwareGL = detectSoftwareGL(renderer);
  if (softwareGL) {
    window.__QA.softwareGL = true;
    if (!qa.quality && QUALITY_ORDER.indexOf(tier) > QUALITY_ORDER.indexOf("medium")) {
      tier = "medium";
      preset = getQualityPreset(tier);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, preset.pixelRatioCap));
    }
  }
  if (qa.quality) saveSettings(save, { quality: tier });
  let frozen = false; // set by context loss; sim halts, page stays alive
  canvas.addEventListener("webglcontextlost", (e) => {
    e.preventDefault();
    frozen = true;
  });
  let post;
  canvas.addEventListener("webglcontextrestored", () => {
    if (post) post.dispose();
    post = new PostPipeline(renderer, scene, camera, preset);
    frozen = false;
    lastTime = performance.now();
  });
  setProgress(0.15);
  await nextFrame();

  materialLibrary.init(renderer, preset, softwareGL);
  const scene = new THREE.Scene();
  setProgress(0.3);
  await nextFrame();

  const sky = new SkySystem(scene, renderer, preset, qa.timeOfDay);
  sky.attachCityTexture(materialLibrary.canvas("city"));
  if (qa.timeOfDay === "night") {
    materialLibrary.get("emissiveStrip").emissiveIntensity = 2.6;
  }

  const camera = new THREE.PerspectiveCamera(
    CONFIG.RIGS.menu.fov,
    window.innerWidth / window.innerHeight,
    0.3,
    1600,
  );
  camera.position.set(0, CONFIG.RIGS.menu.up, 8);

  // ---- state machine + dolly sim (declared before first world.update) ----
  let state = State.LOADING;
  let mode = qa.mode;
  const staged = qa.staged === "beauty";
  const stagedStart = performance.now();
  const stagedPause = qa.scene === "paused"; // ?scene=paused: stage a paused run
  let stagedPauseAt = 0; // when the staged pause landed (fade-settle gate below)
  let stagedGameOver = false; // ?scene=gameover: staged run ends after the time skip
  let stagedGameOverAt = 0; // when that run ended (fade-settle gate below)
  let runStats = null; // run summary; set by endRun(), cleared on a fresh GAME

  let dollyZ = staged ? CONFIG.STAGED_BEAUTY.z : CONFIG.START_Z;
  let prevDollyZ = dollyZ;
  let runStartZ = dollyZ; // fresh-run baseline for the distance stat (endRun)
  let simTime = 0;
  let speed = CONFIG.CRUISE.menu;
  let accumulator = 0;
  let lastTime = performance.now();
  let paused = false; // PAUSED overlay flag; meaningful inside GAME only
  let qaShell = null; // QA-only state-machine handle, assigned under ?qa=1
  const FIXED = CONFIG.FIXED_DT; // declared before fastForward's boot call

  // Mode surface (design 2): the shell routes gameplay actions and fixed/
  // render ticks through activeMode. RUN is the real mode (task 4.3); DRIVE
  // and RIDE stay on the no-op stub until their slices land. The stub reads
  // focus null so the shell's dolly advance keeps driving those scenes.
  const modeStub = {
    handleAction: () => {},
    fixedUpdate: () => {},
    update: () => {},
  };
  const runMode = createRunMode();
  let activeMode = modeStub;
  let activeModeName = null;

  /**
   * Swap the active mode (design 2). Entering RUN constructs/attaches its
   * systems and flips the world's gameplay flag (world restreams on the next
   * update); leaving it releases everything and restreams the attract window.
   * Beauty stays mode-free: it is a menu-diorama stage, not a run.
   */
  function activateMode(next) {
    if (staged || next === activeModeName) return;
    if (activeModeName === "run") runMode.exit();
    activeModeName = next;
    if (next === "run") {
      activeMode = runMode;
      runMode.enter({
        scene,
        world,
        input,
        audio,
        save,
        hud: modeHud, // 5.1: the mode pushes score.snapshot() per render tick
        seed,
        staged: qa.staged,
        startZ: dollyZ, // fresh runs continue from the dolly (retry keeps z)
        endRun,
      });
      if (qa.qa) window.__QA_RUN = runMode.systems();
    } else {
      activeMode = modeStub;
      if (qa.qa) window.__QA_RUN = null;
    }
    // HUD placement follows the active mode (design decision 7); a stub has
    // none, which keeps the HUD hidden in DRIVE/RIDE scenes entirely.
    hudUI.setLayout(activeMode.hudLayout ? activeMode.hudLayout() : null);
  }

  setProgress(0.5);
  await nextFrame();

  // ---- world + post + perf ----------------------------------------------
  const world = new World(scene, materialLibrary, seed, preset, qa.timeOfDay);
  setProgress(0.8);
  await nextFrame();

  post = new PostPipeline(renderer, scene, camera, preset);
  const perf = new PerfMonitor({
    tier,
    autoDown: !qa.qa, // deterministic captures: no mid-shot tier changes
    onTierDown: () => stepDownTier(),
  });
  // QA-only draw-call audit hook (.qa/draw_audit.mjs): the probe needs live
  // renderer/scene/camera references to count renderer.info calls per
  // material group; the chunk/spawn probes also drive the world from here
  // (activation callbacks + placement streams). Never exists outside ?qa=1.
  if (qa.qa) window.__QA_AUDIT = { scene, camera, renderer, world };
  // Task 4.1 QA gate (?gameplay=1): boots with the gameplay dressing flag
  // set (shoulder-shifted wrecks) without a mode — the menu-boot A/B in
  // .qa/chunk_probe.mjs. 4.3's RUN mode owns the real setGameplay(true/false)
  // at enter/exit — attract boots never set it.
  if (qa.qa && qa.gameplay) world.setGameplay(true);
  world.update(0, dollyZ); // stream the initial window before frame 1

  // ---- shell wiring ------------------------------------------------------
  const menuUI = new MenuUI({
    onSelect: (nextMode) => enterGame(nextMode),
  });
  // Pause screen (task 2.3): pure view of the paused flag; the buttons land
  // on the shell's existing paths (setPaused / fresh-run enterGame / quit).
  const pauseUI = new PauseUI({
    onResume: () => setPaused(false),
    onRestart: () => enterGame(mode), // fresh-run path; the pooled reset is the retry path (2.4)
    onQuit: () => enterMenu(),
  });
  // Gameover screen (task 2.4): pure view of runStats + the mode's previous
  // best (the recordBest/currency/saveSave writes live in endRun, task 2.5 —
  // the screen itself stays display-only). Buttons land on the shell's
  // existing paths (retryRun / enterMenu).
  const gameoverUI = new GameoverUI({
    onRetry: () => retryRun(),
    onMenu: () => enterMenu(),
  });
  // HUD (task 5.1): pure view of the GAME state + the mode's live ledger.
  // The touch pause chip emits the shell's EXISTING `pause` action — the
  // exact routeAction path Esc takes (design 6; 2.3's pointerup/click
  // ordering note holds: the tap action lands before the click, under the
  // old flag). Placement class comes from the mode's hudLayout() — no
  // layout (stub modes) = never shown.
  const hudUI = new HudUI({ onPause: () => routeAction("pause") });
  const modeHud = { update: (stats) => hudUI.update(stats) }; // mode ctx surface (4.3)
  const gameui = document.getElementById("gameui");
  const backBtn = document.getElementById("back-btn");
  const modeLabel = document.getElementById("mode-label");
  backBtn.addEventListener("click", () => enterMenu());

  const audio = new AudioManager();
  const input = new InputManager({ onAction: routeAction });
  // 5.2 QA handle (?qa=1 rule as above): audio_probe reads the instance
  // (master gain, ctx state) and round-trips voices for the heap check.
  if (qa.qa) window.__QA_AUDIT.audio = audio;

  // ---- shell wiring (continued): action routing by state (design 6) -------
  /**
   * Route one action by shell state. Esc is dual-emitted ("pause" then
   * "back", input.js): inside GAME "pause" toggles the pause flag and "back"
   * is consumed — a live run is never exited by Esc (game-shell spec).
   */
  function routeAction(action) {
    audio.unlock();
    audio.resume();
    if (action === "pointer") return;
    if (action.startsWith("mode-")) {
      const nextMode = MODES[Number(action.slice(5)) - 1];
      if (!nextMode) return;
      if (state === State.GAMEOVER) return; // retry keeps the dead run's mode
      if (state === State.MENU) audio.ui(); // select tick (5.2; live in-game switches stay silent)
      menuUI.setMode(nextMode);
      if (state === State.GAME) setMode(nextMode);
      return;
    }
    if (state === State.MENU) {
      if (action === "confirm") menuUI.confirm(); // gameplay keys inert here
      return;
    }
    if (state === State.GAMEOVER) {
      if (action === "jump" || action === "confirm") retryRun(); // Space/Enter
      else if (action === "back") enterMenu(); // Esc leaves the gameover screen
      return;
    }
    // state === GAME
    if (action === "pause") {
      setPaused(!paused);
      return;
    }
    if (action === "back") return; // consumed: Esc pauses, never exits
    if (paused) return; // gameplay actions ignored while paused
    activeMode.handleAction(action);
    if (qaShell && qaShell.routed.length < 256) qaShell.routed.push(action);
  }

  // ---- shell wiring (continued): state transitions ------------------------
  function setMode(next) {
    mode = next;
    save.lastMode = next;
    modeLabel.textContent = next.toUpperCase();
    if (state === State.GAME) speed = staged ? 0 : CONFIG.CRUISE[next];
    activateMode(next); // swaps the Mode surface when the active one changes
  }

  /** Enter a fresh GAME (menu select, pause restart, retry). */
  function enterGame(nextMode) {
    audio.ui(); // start/restart/retry confirm (5.2); boot stagings stay silent (no ctx yet)
    setMode(nextMode);
    state = State.GAME;
    clearPause();
    gameoverUI.show(false); // a fresh run leaves any dead run's screen behind
    runStats = null;
    runStartZ = dollyZ;
    speed = staged ? 0 : CONFIG.CRUISE[nextMode];
    if (activeMode.restart) activeMode.restart(dollyZ); // fresh-run path (4.3)
    menuUI.show(false);
    gameui.classList.add("on");
    gameui.classList.add("live"); // live run: the Esc·MENU chip's affordance is false there (Esc pauses, 2.2)
    hudUI.show(true); // the HUD is a GAME-state view (game-shell spec)
    saveSettings(save, { lastMode: nextMode });
  }

  /**
   * GAMEOVER confirm -> fresh GAME, same mode. Pooled reset (design risk
   * note "instant retry"): world.reset() despawns every active chunk while
   * the pools keep their geometry; the next world.update re-streams the
   * window around the (untouched) dolly from the run seed — no rebuild, no
   * allocation spike, sub-millisecond next frame.
   */
  function retryRun() {
    if (state !== State.GAMEOVER) return;
    world.reset();
    // Respawn runway (task 7.2): retry re-streams the SAME seeded layout, so
    // keeping the death-spot z would re-die on frame 1 against the hazard
    // that just ended the run. Skip to the next chunk boundary — each chunk
    // start is guaranteed clear by the spawn insets (CONFIG.RUN.
    // retrySkipChunks) — and hold the rig there for a clean cut (no 40 m
    // catch-up swoosh).
    dollyZ =
      (Math.floor(dollyZ / CONFIG.CHUNK_LEN) + CONFIG.RUN.retrySkipChunks) * CONFIG.CHUNK_LEN;
    prevDollyZ = dollyZ;
    rigTargets(dollyZ, rigPos, rigLook);
    camera.position.copy(rigPos);
    camera.lookAt(rigLook);
    enterGame(mode);
  }

  /**
   * Shell-level death path: the active mode reports the run ended (task 4.3
   * consumes this; QA drives it via __QA_SHELL.endRun). The world keeps
   * rendering with the dolly halted — the death-reveal framing — while the
   * gameover screen shows the run's stats against the mode's previous best.
   */
  function endRun(stats) {
    if (state !== State.GAME) return;
    const prevBest = save.best[mode] || 0; // view keeps the PREVIOUS best (2.4 contract)
    runStats = { distance: Math.max(0, Math.round(dollyZ - runStartZ)), pickups: 0, score: 0, ...stats };
    state = State.GAMEOVER;
    clearPause();
    // Persistence (task 2.5, design 9): best + pickup currency in exactly ONE
    // localStorage write per death. recordBest() saves internally when it
    // improves, so the currency credit is applied to the in-memory save
    // first and piggybacks on that write; with no improvement the explicit
    // saveSave() below is the single write. No other path persists a run.
    save.currency += Math.max(0, Math.floor(runStats.pickups || 0)) * CONFIG.SCORE.pickupValue;
    if (!recordBest(save, mode, runStats.distance)) saveSave(save);
    gameoverUI.setStats(runStats, prevBest);
    gameoverUI.show(true);
    gameui.classList.remove("live"); // GAMEOVER: Esc really does quit — the chip's affordance is true again
    hudUI.show(false); // GAMEOVER hides the HUD (game-shell spec)
  }

  function enterMenu() {
    audio.ui(); // quit/menu confirm (5.2; boot never routes through here)
    state = State.MENU;
    clearPause(); // quit from the pause screen must not leak the flag into MENU
    if (activeModeName === "run") {
      runMode.exit(); // releases the run's systems + restreams attract dressing
      activeModeName = null;
      activeMode = modeStub;
      if (qa.qa) window.__QA_RUN = null;
    }
    gameoverUI.show(false);
    hudUI.setLayout(null); // HUD exists only while a mode supplies its layout
    speed = staged ? 0 : CONFIG.CRUISE.menu;
    gameui.classList.remove("on");
    gameui.classList.remove("live");
    menuUI.show(true);
    menuUI.setBests(save.best); // per-card lines (footer stays cross-mode)
    menuUI.setBest(Math.max(save.best.run, save.best.drive, save.best.ride));
  }

  /**
   * PAUSED flag (design decision 1): fixed sim halts, rendering continues.
   * State-gated — outside GAME the flag has no meaning and stays false.
   * The pause screen is a pure view of this flag (hide/show only).
   */
  function setPaused(on) {
    if (state !== State.GAME || paused === on) return;
    paused = on;
    if (!on) audio.ui(); // resume confirm (5.2); pausing itself stays silent
    if (window.__QA) window.__QA.paused = on;
    pauseUI.show(on);
  }

  /**
   * Leave GAME (fresh run / death / quit): the flag means nothing outside
   * GAME, and a leaked true would freeze the attract sim (simFrozen reads it
   * in any state). Keeps the QA mirror + pause screen in lockstep.
   */
  function clearPause() {
    paused = false;
    if (window.__QA) window.__QA.paused = false;
    pauseUI.show(false);
  }

  if (qa.scene === "game" || stagedPause) {
    enterGame(qa.mode);
  } else if (qa.scene === "gameover") {
    stagedGameOver = true;
    enterGame(qa.mode);
  } else {
    menuUI.setMode(MODES.includes(save.lastMode) ? save.lastMode : "drive");
    state = State.MENU;
  }

  // QA-only state-machine handle (task 2.2): probes drive death/retry/quit
  // and read live sim numbers. Never exists outside ?qa=1 (same rule as
  // __QA_AUDIT); tasks 2.3/2.4/4.3 consume the same surface.
  if (qa.qa) {
    qaShell = window.__QA_SHELL = {
      state: () => state,
      paused: () => paused,
      stats: () => runStats,
      dolly: () => ({ z: dollyZ, prevZ: prevDollyZ, simTime, speed }),
      routed: [], // gameplay actions delivered to the active mode
      endRun: (stats) => endRun(stats),
      retry: () => retryRun(),
      quit: () => enterMenu(),
      frames: 0,
    };
  }

  // ---- camera rigs --------------------------------------------------------
  const rigPos = new THREE.Vector3().copy(camera.position);
  const rigLook = new THREE.Vector3(0, 1.3, 40);
  const tmpPos = new THREE.Vector3();
  const tmpLook = new THREE.Vector3();
  let curFov = CONFIG.RIGS.menu.fov;

  /**
   * Compute rig targets for the render dolly position. CONFIG rig comes from
   * ?cam override, else the mode rig in game (the active mode's cameraRig()
   * when it supplies one — RUN's lane-following run rig; task 4.3), else the
   * mode/menu CONFIG rig. staged=beauty overrides everything with the fixed
   * hero pose inside the convoy chunk.
   */
  function rigTargets(renderZ, outPos, outLook) {
    if (staged) {
      const S = CONFIG.STAGED_BEAUTY;
      const t = simTime;
      outPos.set(S.pos[0] + Math.sin(t * 0.1) * 0.12, S.pos[1] + Math.sin(t * 0.23) * 0.04, S.pos[2]);
      outLook.set(S.look[0], S.look[1], S.look[2]);
      return S.fov;
    }
    // GAMEOVER holds the mode rig so the death-reveal framing never snaps.
    const inGame = state === State.GAME || state === State.GAMEOVER;
    const key = qa.cam || (inGame ? mode : "menu");
    const rig = (inGame && !qa.cam && activeMode.cameraRig && activeMode.cameraRig())
      || CONFIG.RIGS[key] || CONFIG.RIGS.menu;
    const t = simTime;
    // Attract lane offset (round-4): drive/run/ride rigs travel offset from
    // the centreline (laneX0) with a slow ±driftAmp sine (~11 s period), so
    // the dolly passes wrecks at varied lateral distance and the framing is
    // asymmetric; the menu rig has no lane terms and stays centred.
    const lane = (rig.laneX0 || 0) + (rig.driftAmp ? Math.sin(t * rig.driftT) * rig.driftAmp : 0);
    const sway = lane + Math.sin(t * rig.swayT) * rig.swayX;
    const bob = Math.sin(t * 0.5) * rig.bobY;
    outPos.set(sway, rig.up + bob, renderZ - rig.back);
    outLook.set(sway * 0.4, rig.lookUp, renderZ + rig.lookAhead);
    return rig.fov;
  }

  function updateCamera(renderZ, dt) {
    const targetFov = rigTargets(renderZ, tmpPos, tmpLook);
    const k = 1 - Math.exp(-dt * 5.5);
    rigPos.lerp(tmpPos, dt > 0 ? k : 0);
    rigLook.lerp(tmpLook, dt > 0 ? k : 0);
    camera.position.copy(rigPos);
    camera.lookAt(rigLook);
    camera.rotation.z += Math.sin(simTime * 0.3) * 0.004; // breath-level roll
    if (dt > 0 && Math.abs(curFov - targetFov) > 0.01) {
      curFov += (targetFov - curFov) * k;
      camera.fov = curFov;
      camera.updateProjectionMatrix();
    } else if (curFov !== targetFov && dt === 0) {
      // Frozen (QA warmup): snap once so warmup frames are final.
      curFov = targetFov;
      camera.fov = targetFov;
      camera.updateProjectionMatrix();
    }
  }

  // ---- simulation ---------------------------------------------------------
  function fixedUpdate(dt) {
    prevDollyZ = dollyZ;
    if (state === State.GAME) {
      activeMode.fixedUpdate(dt); // the real mode owns its focus (design 2)
      const fz = activeMode.focus;
      if (fz !== null && fz !== undefined) dollyZ = fz; // mode-owned focus z
      else dollyZ += speed * dt; // shell dolly (attract / stub modes)
    }
    simTime += dt;
  }

  function fastForward(seconds) {
    const steps = Math.round(Math.min(seconds, CONFIG.TIME_CAP) / FIXED);
    for (let i = 0; i < steps; i++) {
      fixedUpdate(FIXED);
      if (i % 8 === 0) world.update(FIXED, dollyZ);
    }
    prevDollyZ = dollyZ;
    world.update(FIXED, dollyZ);
  }

  if (qa.time > 0) fastForward(qa.time);
  if (stagedGameOver) {
    stagedGameOverAt = performance.now(); // rAF `now` shares this time origin
    endRun(); // ?scene=gameover: deterministic stats from the staged cruise
  }

  // ---- quality step-down --------------------------------------------------
  let lastStepAt = 0;
  function stepDownTier() {
    const now = performance.now();
    if (now - lastStepAt < 5000) return;
    lastStepAt = now;
    const idx = QUALITY_ORDER.indexOf(tier);
    if (idx <= 0) return;
    tier = QUALITY_ORDER[idx - 1];
    preset = getQualityPreset(tier);
    perf.setTier(tier);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, preset.pixelRatioCap));
    renderer.shadowMap.enabled = preset.shadowsEnabled;
    sky.applyPreset(preset);
    world.maxChunksAhead = preset.maxChunksAhead;
    post.dispose();
    post = new PostPipeline(renderer, scene, camera, preset);
    onResize();
  }

  // ---- resize / visibility ------------------------------------------------
  function onResize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
    post.setSize(w, h);
  }
  window.addEventListener("resize", onResize);
  document.addEventListener("visibilitychange", () => {
    // Hide pauses; returning STAYS paused — the overlay waits for an explicit
    // RESUME (game-shell spec). rawDt is clamped and unused while paused, so
    // no lastTime surgery is needed on return.
    if (state !== State.GAME || !document.hidden) return; // the flag lives inside GAME
    setPaused(true); // auto-pause on tab hide
  });

  // ---- main loop ----------------------------------------------------------
  let readyFired = false;

  function frame(now) {
    requestAnimationFrame(frame);
    const rawDt = Math.min((now - lastTime) / 1000, CONFIG.MAX_FRAME_DT);
    lastTime = now;
    perf.frame(now);
    if (qaShell) qaShell.frames++;

    const simFrozen = frozen || paused || (qa.freeze && readyFired);
    if (!simFrozen) {
      accumulator += rawDt;
      let steps = 0;
      while (accumulator >= FIXED && steps < CONFIG.MAX_STEPS_PER_FRAME) {
        fixedUpdate(FIXED);
        accumulator -= FIXED;
        steps++;
      }
      if (steps === CONFIG.MAX_STEPS_PER_FRAME) accumulator = 0; // spiral guard
      world.update(rawDt, dollyZ);
    }

    // Fixed sim + interpolated render (bible rule 5).
    const alpha = accumulator / FIXED;
    const renderZ = prevDollyZ + (dollyZ - prevDollyZ) * alpha;
    if (state === State.GAME && !simFrozen) activeMode.update(rawDt, alpha);
    updateCamera(renderZ, simFrozen ? 0 : rawDt);
    world.dust.update(simFrozen ? 0 : rawDt, camera.position.x, camera.position.z);
    sky.update(camera, camera.position.x, camera.position.z, simFrozen ? 0 : rawDt, simTime);

    const grade = post.gradeUniforms;
    if (grade) grade.uTime.value = simTime; // frozen sim keeps grain stable

    renderer.info.reset();
    post.render();
    perf.stats(renderer.info.render.calls, renderer.info.render.triangles);
    world.setDrawCalls(renderer.info.render.calls);

    const warm = markFrameRendered();
    // staged=gauntlet (mode staging, task 4.3): settle covers the menu-rig ->
    // run-rig camera glide, so a freeze=1 capture holds the SETTLED framing.
    const gauntStaged = activeModeName === "run" && qa.staged === "gauntlet";
    const baseSettled =
      (!staged || now - stagedStart >= CONFIG.STAGED_BEAUTY.settleS * 1000) &&
      (!gauntStaged || now - stagedStart >= runMode.stagedScenarios().gauntlet.settleS * 1000);
    if (stagedPause && !readyFired && !paused && warm && baseSettled && world.pending === 0) {
      stagedPauseAt = now; // stage at the old ready-flip point, then…
      setPaused(true);
    }
    // …and screenshotReady waits out staged overlays' UI fades so captures
    // see them settled (?scene=paused / ?scene=gameover only; every other
    // scene gates exactly as before).
    const stagedSettled =
      baseSettled &&
      (!stagedPause || (paused && now - stagedPauseAt >= CONFIG.STAGED_PAUSE.settleS * 1000)) &&
      (!stagedGameOver || now - stagedGameOverAt >= CONFIG.STAGED_GAMEOVER.settleS * 1000);
    if (resolveReady({ queueDrained: world.pending === 0, stagedSettled })) {
      readyFired = true;
      // Freeze captures hold the flash bursts at full fade (gauntlet staging).
      if (activeMode.onReady) activeMode.onReady(dollyZ);
    }
  }

  // ---- go live ------------------------------------------------------------
  onResize();
  setProgress(1);
  await nextFrame();
  await nextFrame();
  if (state === State.GAME || state === State.GAMEOVER) {
    gameui.classList.add("on");
    modeLabel.textContent = mode.toUpperCase();
    if (state === State.GAME) hudUI.show(true); // gameover boots stay HUD-free
  } else {
    menuUI.setBests(save.best); // per-card lines before first reveal
    menuUI.setBest(Math.max(save.best.run, save.best.drive, save.best.ride)); // cold-boot footer (was enterMenu-only)
    menuUI.show(true);
  }
  document.getElementById("loading").classList.remove("on");
  lastTime = performance.now();
  requestAnimationFrame(frame);

  // PWA: register the shell SW only outside QA captures.
  if (!qa.qa && "serviceWorker" in navigator) {
    const secure = location.protocol === "https:" || ["localhost", "127.0.0.1"].includes(location.hostname);
    // Relative: the game mounts under a subpath (monorepo Pages site).
    if (secure) navigator.serviceWorker.register("./sw.js").catch(() => {});
  }

  void input;
}

boot().catch((e) => {
  // Surface boot failures in QA reports (pageerror), never silently.
  window.__QA = window.__QA || { screenshotReady: false, mode: "none", scene: "boot", seed: "?" };
  window.__QA.bootError = String(e?.stack || e);
  throw e;
});
