/**
 * @file qa/hooks.js
 * QA param driver + window.__QA contract (see AGENTS.md). Task 6.1 is the
 * authoritative param table + the ONE consolidated screenshotReady gate doc;
 * .qa/contract_probe.mjs boots the full matrix and asserts it.
 *
 * Params (all verified by the 6.1 matrix):
 *   ?qa=1              QA mode: __QA surfaces on, service worker bypassed
 *                      (sw.js skips any URL containing qa=1), boot-timing
 *                      console.info allowed, tier auto-down disabled.
 *   &seed=N            run seed (rng.js initRunSeed); __QA.seed mirrors the
 *                      RESOLVED seed string ("N", or a time-based value when
 *                      absent). Same seed => same world layout + staged stats.
 *   &time=S|dusk|night S = seconds of fixed-step fast-forward at boot
 *                      (clamped to CONFIG.TIME_CAP); dusk|night pick the
 *                      time-of-day bake (mutually exclusive with the skip).
 *   &freeze=1          stop simulation time AFTER the ready gates (staging
 *                      settles first); rendering + grain keep running.
 *   &mode=run|drive|ride   mode preselect (default drive); only run has a
 *                      real mode this slice (drive/ride ride the stub).
 *   &scene=menu|game|paused|gameover|mode_select
 *                      menu = attract diorama; game = live gameplay boot;
 *                      paused = game + auto-pause at the ready gates;
 *                      gameover = run ended right after the ?time= skip
 *                      (boot-deterministic stats, round(CRUISE[mode] x S));
 *                      mode_select is the ACCEPTED ALIAS of menu — the menu
 *                      IS the mode-select screen (three mode cards), so it
 *                      resolves to "menu". shop is RESERVED (no screen this
 *                      slice) and, like any unknown value, falls back to
 *                      menu. __QA.scene mirrors a real machine scene only:
 *                      menu | game | paused | gameover.
 *   &staged=beauty|gauntlet   staged action setups: beauty = menu hero pose
 *                      inside the convoy chunk (CONFIG.STAGED_BEAUTY);
 *                      gauntlet = the RUN mode's conveyed tableau
 *                      (modes/run.js stagedScenarios(); requires
 *                      &scene=game&mode=run — it stages nothing in menus).
 *                      The temporary task-3.1..3.4 entity stagings retired
 *                      with task 4.3; probe-side fixtures live in
 *                      qa/entity_stage.js + qa/player_stage.js.
 *   &cam=beauty|close|side|front   QA camera override; every value is a
 *                      CONFIG.RIGS key and wins over the mode/menu rig
 *                      (main.js rigTargets).
 *   &gameplay=1        boots the world's gameplay dressing flag without a
 *                      mode — .qa/chunk_probe.mjs's menu-boot A/B (4.1).
 *   &quality=low|medium|high|ultra  tier override (wins over saved settings;
 *                      software-GL default cap is medium).
 *
 * screenshotReady gate (ONE place; applied in main.js frame() via
 * resolveReady()): ready flips true ONLY after ALL of
 *   1. warm frames   >= CONFIG.WARM_FRAMES (5) rendered frames, and
 *   2. queue drained world.pending === 0 (stream queue empty), and
 *   3. staged settle  the scene's settle time has elapsed:
 *        staged=beauty     CONFIG.STAGED_BEAUTY.settleS   1.5 s
 *        staged=gauntlet   run.js stagedScenarios().gauntlet.settleS 2.6 s
 *                          (menu-rig -> run-rig camera glide before freeze)
 *        scene=paused      CONFIG.STAGED_PAUSE.settleS    1.0 s, counted
 *                          from the staged pause landing at gates 1+2
 *                          (covers the pause overlay's UI fade + reveal)
 *        scene=gameover    CONFIG.STAGED_GAMEOVER.settleS 1.1 s, counted
 *                          from the boot endRun() (gameover overlay settle)
 *        every other scene has no settle term (0 s).
 * freeze=1 then stops simulation time but keeps rendering. Gauntlet settle
 * lives in run.js's STAGED table on purpose (QA staging constants are not
 * gameplay CONFIG — 4.3/4.4 precedent); the three shell settles live in
 * config.js next to each other.
 *
 * window.__QA = { mode, scene, seed, paused, screenshotReady, params }.
 * window.__QA_ACTIONS = [] (exists ONLY under ?qa=1): every action string
 * the InputManager emits, mirrored by input.js _emit for verification
 * (task 2.1) and future action-routing checks (task 2.2).
 * window.__QA_SFX = {} (exists ONLY under ?qa=1): every AudioManager play
 * mirrored by audio.js _count (task 5.2) — event -> sound mapping checks
 * for .qa/audio_probe.mjs; counts the play CALL regardless of the
 * context's audible state.
 */
import { CONFIG } from "../js/core/config.js";

const NUMERIC_TAGS = { run: 1, drive: 2, ride: 3 };

export function initQaHooks() {
  const params = new URLSearchParams(window.location.search);
  const qa = params.get("qa") === "1";

  const rawTime = params.get("time");
  let time = 0;
  let timeOfDay = "dusk";
  if (rawTime === "night" || rawTime === "dusk") {
    timeOfDay = rawTime;
  } else if (rawTime !== null) {
    const t = parseFloat(rawTime);
    if (Number.isFinite(t)) time = Math.min(Math.max(t, 0), CONFIG.TIME_CAP);
  }

  // scene resolution (see header table): game|paused|gameover stage the GAME
  // state and echo raw; mode_select resolves to menu (the menu IS the
  // mode-select screen); shop is reserved and — like any unknown value —
  // falls back to menu, so __QA.scene only ever mirrors a real machine scene.
  const rawScene = params.get("scene");
  const scene =
    rawScene === "game" || rawScene === "paused" || rawScene === "gameover" ? rawScene : "menu";
  const rawMode = params.get("mode");
  const mode = NUMERIC_TAGS[rawMode] ? rawMode : "drive";
  const cam = params.get("cam");
  const staged = params.get("staged") || null;
  const freeze = params.get("freeze") === "1";

  const cfg = {
    qa,
    seed: params.get("seed"),
    time,
    timeOfDay,
    scene,
    mode,
    cam: ["beauty", "close", "side", "front"].includes(cam) ? cam : null,
    staged: staged === "beauty" || staged === "gauntlet" ? staged : null,
    freeze,
    gameplay: params.get("gameplay") === "1",
    quality: params.get("quality"),
  };

  window.__QA = {
    mode,
    scene,
    seed: cfg.seed,
    paused: false, // live PAUSED mirror; main.js setPaused() keeps it current
    screenshotReady: false,
    params: cfg,
    _warmFrames: 0,
    _ready: false,
  };

  // QA-only input trace: input.js mirrors every emitted action here. Never
  // allocated outside ?qa=1, so play has zero trace cost.
  if (qa) window.__QA_ACTIONS = [];
  // QA-only audio play mirror (5.2; audio.js _count consumes it).
  if (qa) window.__QA_SFX = {};

  return cfg;
}

/** Called by main after each rendered frame (warmup accounting). */
export function markFrameRendered() {
  const qa = window.__QA;
  if (!qa || qa._ready) return true;
  qa._warmFrames++;
  return qa._warmFrames >= CONFIG.WARM_FRAMES;
}

/**
 * Flip screenshotReady once all gates pass; idempotent.
 * @param {{queueDrained: boolean, stagedSettled: boolean}} gates
 * @returns {boolean} True the first time ready flips (caller may freeze sim).
 */
export function resolveReady(gates) {
  const qa = window.__QA;
  if (!qa || qa._ready) return false;
  if (qa._warmFrames < CONFIG.WARM_FRAMES) return false;
  if (!gates.queueDrained) return false;
  if (!gates.stagedSettled) return false;
  qa._ready = true;
  qa.screenshotReady = true;
  return true;
}
