/**
 * @file main.js
 * Engine boot + application shell.
 *
 * Responsibilities:
 *  - renderer / scene / post pipeline / sky / camera / world / run assembly
 *  - state machine: LOADING -> MENU -> PLAYING -> GAMEOVER
 *  - fixed-timestep game loop (60 Hz sim) with render interpolation
 *  - resize + visibilitychange handling
 *  - DOM shell (menu / HUD / game over) with localStorage persistence; the
 *    optional backend is reached only through the service-worker relay
 *    (core/api.js) and degrades silently to localStorage-only mode
 *  - QA driver integration (?qa/?seed/?time/?freeze/?cam/?hud/?quality)
 *
 * The loading screen hides as soon as the engine is ready — never waits on
 * any network.
 */
import * as THREE from "three";
import {
  CONFIG,
  QUALITY_ORDER,
  detectQualityTier,
  getQualityPreset,
} from "./core/config.js";
import { initRunSeed } from "./core/rng.js";
import { materialLibrary } from "./core/assets.js";
import { createRenderer, PostPipeline, PerfMonitor } from "./core/renderer.js";
import { SkySystem } from "./core/sky.js";
import { InputManager } from "./core/input.js";
import { detectScheme, latchTouch, currentScheme } from "./core/scheme.js";
import { AudioManager } from "./core/audio.js";
import { ChaseCamera } from "./game/camera.js";
import { RunController } from "./game/run.js";
import { VfxSystem } from "./game/vfx.js";
import { coachShouldRun, createCoach } from "./game/coach.js";
import { World } from "./world/world.js";
import { getApiChannel } from "./core/api.js";
import { initQaHooks, markFrameRendered } from "./qa/hooks.js";

const State = {
  LOADING: "loading",
  MENU: "menu",
  PLAYING: "playing",
  GAMEOVER: "gameover",
};

// ------------------------------------------------------------
// D4: safe-resume grace (task 3.3) — duration + pure decision
// rules. Kept top-level and side-effect-free so QA probes can
// exercise the exact arming/gating logic without a DOM or the
// frame loop; single-constant tuning, like CONFIG-adjacent knobs.
// ------------------------------------------------------------

/** Grace duration in real-time seconds (never run time). */
const GRACE_SECONDS = 1.2;

/**
 * Should un-pausing arm the resume grace? Only a live PLAYING run that was
 * actually paused qualifies. `wasPaused` is what keeps showGameOver() safe:
 * its setPaused(false) runs while state is still PLAYING, but `paused` was
 * already false there (death only happens inside a sim step, which never
 * runs while paused). isFrozen/isQa hard-disable arming for deterministic
 * captures and QA autostart — belt-and-braces on top of "they never pause".
 */
function graceNeedsArm(stateVal, wasPaused, isFrozen, isQa) {
  return !isFrozen && !isQa && stateVal === State.PLAYING && wasPaused === true;
}

/**
 * May the fixed-step sim advance? While the resume grace runs, the PLAYING
 * branch is skipped exactly as when paused — distance/time cannot drift
 * because nothing steps at all.
 */
function simCanStep(stateVal, isPaused, graceRemaining) {
  return stateVal === State.PLAYING && !isPaused && graceRemaining <= 0;
}

// ------------------------------------------------------------
// Task 4.1: powerup chip constants + pure write rule. POWERUP_DURATION_S
// must equal what run.collectPowerup() actually grants (pickups.onCollect
// passes 10 and the default is 10 — run.js exports no constant, so the
// number is pinned here next to the drain math that depends on it and the
// smoke test asserts the two sources agree). Per D5 the HUD reads the
// sim's public run.powerups timers directly — zero plumbing, getStats()
// stays score/coins/multiplier-only — and jetpack gets NO chip (data-only
// stub; a chip would lie).
// ------------------------------------------------------------

/** Seconds a collected powerup lasts (matches run.js collectPowerup). */
const POWERUP_DURATION_S = 10;
/** Below this fraction of the duration the chip gets the low pulse. */
const POWERUP_LOW_FRAC = 0.25;

/**
 * One powerup chip's per-frame state write (pure DOM output — no sim reads).
 * Visibility is a plain `secs > 0` comparison, so it is settled under
 * ?freeze with zero animation dependence. The drain fill reuses the
 * grace-bar pattern: transform scaleX, quantized to 1/100 steps so settled
 * frames stop writing. `data-low` (opacity pulse) is decoration only — the
 * shrinking bar is the honest remaining-time signal.
 *
 * @param {HTMLElement} chip The .pu-chip root (.hidden class + data-low).
 * @param {HTMLElement} fill The .pu-fill drain bar child.
 * @param {{on: boolean, fill: number, low: boolean}} st Persistent per-chip
 *        write cache (last on / 1-100 fill step / low flag) — no allocation.
 * @param {number} secs Seconds remaining on this powerup's sim timer.
 * @param {number} duration The duration the sim granted (denominator).
 */
function writePuChip(chip, fill, st, secs, duration) {
  const on = secs > 0;
  if (on !== st.on) {
    st.on = on;
    chip.classList.toggle("hidden", !on);
  }
  if (!on) {
    // Expiry: park the bar full and drop any low pulse so the next collect
    // starts clean (cache-guarded — settled frames write nothing).
    if (st.fill !== 100) {
      st.fill = 100;
      fill.style.transform = "scaleX(1)";
    }
    if (st.low) {
      st.low = false;
      chip.removeAttribute("data-low");
    }
    return;
  }
  const step = Math.round((Math.min(secs, duration) / duration) * 100);
  if (step !== st.fill) {
    st.fill = step;
    fill.style.transform = "scaleX(" + step / 100 + ")";
  }
  const low = secs <= duration * POWERUP_LOW_FRAC;
  if (low !== st.low) {
    st.low = low;
    if (low) chip.setAttribute("data-low", "");
    else chip.removeAttribute("data-low");
  }
}

const LS_KEYS = {
  highScore: "late_again_high_score",
  lastRun: "late_again_last_run",
  totalCoins: "late_again_total_coins",
  games: "late_again_games",
  username: "late_again_username",
  muted: "late_again_muted",
  // D6 audio settings (missing key = on; main.js owns the writes).
  music: "late_again_music",
  sfx: "late_again_sfx",
  // D8 first-run teaching flag: "0" = brand-new save (coach runs), "1" =
  // taught. MISSING key = existing save = already taught (never re-teach).
  tutored: "late_again_tutored",
};

function lsInt(key, fallback = 0) {
  try {
    const v = parseInt(localStorage.getItem(key) || "", 10);
    return Number.isFinite(v) ? v : fallback;
  } catch {
    return fallback;
  }
}

function lsGet(key, fallback = "") {
  try {
    return localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}

function lsSet(key, value) {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    /* storage unavailable — degrade silently */
  }
}

export function boot() {
  // ------------------------------------------------------------
  // QA params + seed + quality tier
  // ------------------------------------------------------------
  const qa = initQaHooks();
  const params = new URLSearchParams(window.location.search);
  const seed = initRunSeed(params);
  let tier = detectQualityTier(params);
  let preset = getQualityPreset(tier);

  // D1: input-scheme detection BEFORE the first screen renders — boot-time
  // coarse-pointer guess (touch | keys) lands on <html data-scheme>. The
  // first real touchstart re-latches hybrid devices via latchTouch() below.
  detectScheme();

  // ------------------------------------------------------------
  // Renderer / scene / camera
  // ------------------------------------------------------------
  const canvas = document.getElementById("gameCanvas");
  const renderer = createRenderer(canvas, preset);
  materialLibrary.init(renderer);

  const scene = new THREE.Scene();
  const sky = new SkySystem(scene, renderer, preset);

  const camera = new THREE.PerspectiveCamera(
    CONFIG.FOV_BASE,
    window.innerWidth / window.innerHeight,
    0.1,
    600,
  );
  const chaseCam = new ChaseCamera(camera);
  if (qa.cam) chaseCam.setMode(qa.cam);

  let post = new PostPipeline(renderer, scene, camera, preset, { bloom: !qa.nobloom });

  // ------------------------------------------------------------
  // World + gameplay
  // ------------------------------------------------------------
  const world = new World(scene, materialLibrary, seed, preset);
  // AudioManager applies its persisted mute/music/sfx boot state itself
  // (localStorage); main.js owns persisting every later change.
  const audio = new AudioManager();

  const run = new RunController({
    scene,
    lib: materialLibrary,
    seed,
    preset,
    onGameOver: showGameOver,
    onDeath: () => chaseCam.addTrauma(0.7),
  });
  run.godMode = qa.qa; // QA runs never die so screenshots capture gameplay

  // WAVE 5: game-feel layer. VFX subscribes to the run event bus; audio
  // plays SFX off the same events (both consumers are fixed-step driven so
  // ?freeze stays deterministic and the headless capture stays silent).
  const vfx = new VfxSystem(scene, seed, run.events);
  run.events.on("coin", () => audio.play("coin"));
  run.events.on("jump", () => audio.play("jump"));
  run.events.on("roll", () => audio.play("roll"));
  run.events.on("lane", () => audio.play("lane"));
  run.events.on("crash", () => audio.play("crash"));
  // Task 4.1: collect feedback. The audio sting + the world VFX ring (see
  // vfx.js powerupRing, wired to this same event) fire for EVERY type —
  // that pair is also the whole jetpack collect feedback, since D5 gives
  // jetpack no chip. magnet/x2 additionally pop their HUD chip (one-shot
  // entrance; the chip's visibility itself is settled by updateHud from
  // run.powerups on the same frame).
  run.events.on("powerup", (type) => {
    audio.play("powerup");
    if (type === "magnet" && els.chipMagnet) popBadge(els.chipMagnet);
    else if (type === "x2" && els.chipX2) popBadge(els.chipX2);
  });
  run.events.on("land", (impact) => {
    if (impact > 11) chaseCam.addTrauma(Math.min(0.22, (impact - 11) * 0.02));
  });

  // Mute toggle (M): independent of gameplay input so it works in menus too.
  // Persistence stays with the caller (audio.js owns only runtime state).
  window.addEventListener("keydown", (e) => {
    if (e.code !== "KeyM" || e.repeat) return;
    toggleMute();
  });

  // ------------------------------------------------------------
  // DOM shell
  // ------------------------------------------------------------
  const els = {
    hud: document.getElementById("hud"),
    menu: document.getElementById("menu-screen"),
    gameover: document.getElementById("gameover-screen"),
    loading: document.getElementById("loading-screen"),
    score: document.getElementById("score-value"),
    coins: document.getElementById("coins-value"),
    multiplierDisplay: document.getElementById("multiplier-display"),
    multiplier: document.getElementById("multiplier-value"),
    combo: document.getElementById("combo-display"),
    comboValue: document.getElementById("combo-value"),
    // Task 4.1 powerup chips — pre-created in index.html (magnet + x2 only;
    // D5: no jetpack chip). Fills are cached too: updateHud writes their
    // transforms directly, never queries.
    chipMagnet: document.getElementById("chip-magnet"),
    chipMagnetFill: document.querySelector("#chip-magnet .pu-fill"),
    chipX2: document.getElementById("chip-x2"),
    chipX2Fill: document.querySelector("#chip-x2 .pu-fill"),
    muteBtn: document.getElementById("mute-btn"),
    pauseOverlay: document.getElementById("pause-overlay"),
    resumeBtn: document.getElementById("resume-btn"),
    pauseBtn: document.getElementById("pause-btn"),
    pauseRestartBtn: document.getElementById("pause-restart-btn"),
    pauseMenuBtn: document.getElementById("pause-menu-btn"),
    // D4 resume-grace overlay (not part of #hud; hidden-class managed in
    // armGrace/clearGrace only).
    resumeGrace: document.getElementById("resume-grace"),
    graceNumeral: document.getElementById("grace-numeral"),
    graceBar: document.getElementById("grace-bar"),
    // Task 3.4 screen-transition roots — .screen-enter replayed on show.
    menuContainer: document.querySelector(".menu-container"),
    resultsPanel: document.querySelector(".results-panel"),
    pausePanel: document.querySelector(".pause-panel"),
    // Scheme-aware hint slots (D1) — text filled by applyHints().
    swipeText: document.querySelector(".swipe-text"),
    pauseHint: document.querySelector(".pause-hint"),
    resultsHint: document.getElementById("results-hint"),
    goScore: document.getElementById("go-score"),
    goDistance: document.getElementById("go-distance"),
    goCoins: document.getElementById("go-coins"),
    goBest: document.getElementById("go-best"),
    goDuration: document.getElementById("go-duration"),
    goGap: document.getElementById("go-gap"),
    newHigh: document.getElementById("new-high-score"),
    menuStats: document.getElementById("menu-stats"),
    menuHighScore: document.getElementById("menu-high-score"),
    menuCoins: document.getElementById("menu-coins"),
    menuGames: document.getElementById("menu-games"),
    leaderboardPanel: document.getElementById("leaderboard-panel"),
    leaderboardList: document.getElementById("leaderboard-list"),
    musicToggle: document.getElementById("music-toggle"),
    musicToggleLabel: document.getElementById("music-toggle-label"),
    sfxToggle: document.getElementById("sfx-toggle"),
    sfxToggleLabel: document.getElementById("sfx-toggle-label"),
    // D8 teaching toast (task 7.2) — lives inside #hud so ?hud=0 hides it
    // with the rest of the run UI; main.js owns its hidden class.
    hintToast: document.getElementById("hint-toast"),
    // Task 7.3 how-to-play review: menu button + non-blocking overlay.
    howtoBtn: document.getElementById("howto-btn"),
    howtoPanel: document.getElementById("howto-panel"),
    howtoCloseBtn: document.getElementById("howto-close-btn"),
    howtoTouchSection: document.getElementById("howto-touch-section"),
    howtoKeysSection: document.getElementById("howto-keys-section"),
    howtoTouchList: document.getElementById("howto-touch-list"),
    howtoKeysList: document.getElementById("howto-keys-list"),
    username: document.getElementById("username-input"),
    playBtn: document.getElementById("play-btn"),
    retryBtn: document.getElementById("retry-btn"),
    menuBtn: document.getElementById("menu-btn"),
  };

  // WAVE 6: deterministic captures must never animate — freeze every CSS
  // animation/transition so the 5 warmup frames stay bit-identical.
  if (qa.freeze) document.documentElement.classList.add("qa-freeze");

  let state = State.LOADING;
  let paused = false;
  // D4: resume-grace countdown, seconds of REAL time remaining (0 = none).
  // The frame loop freezes the sim while it runs; skip inputs zero it.
  let graceT = 0;
  let freezeMode = false;
  let lastUsername = lsGet(LS_KEYS.username);
  let runStartedAt = 0;

  function setState(next) {
    state = next;
    const show = (el, on) => el && el.classList.toggle("hidden", !on);
    show(els.menu, next === State.MENU);
    if (next === State.MENU) playScreenEnter(els.menuContainer); // task 3.4
    show(els.hud, next === State.PLAYING && qa.hud);
    show(els.gameover, next === State.GAMEOVER);
    if (next === State.GAMEOVER) playScreenEnter(els.resultsPanel); // task 3.4
    show(els.pauseOverlay, next === State.PLAYING && paused && qa.hud);
  }

  function refreshMenuStats() {
    els.menuHighScore.textContent = lsInt(LS_KEYS.highScore).toLocaleString();
    els.menuCoins.textContent = lsInt(LS_KEYS.totalCoins).toLocaleString();
    els.menuGames.textContent = lsInt(LS_KEYS.games).toLocaleString();
    els.menuStats.classList.remove("hidden");
  }

  // ------------------------------------------------------------
  // HUD (cached DOM writes; transform/opacity-only animations)
  // ------------------------------------------------------------
  let lastScore = -1;
  let lastCoins = -1;
  let lastMult = -1;
  let comboStreak = 0;
  let comboLastDistance = -Infinity;
  let comboShown = false;
  let lastComboShownValue = -1;

  // Task 4.1 powerup-chip write caches (persistent, mutated in place by
  // writePuChip — zero per-frame allocation). `fill` is the last 1/100
  // scale step written; -1 = "unknown, force a write".
  const magnetChipState = { on: false, fill: -1, low: false };
  const x2ChipState = { on: false, fill: -1, low: false };

  // Coin-streak combo: purely UI-level (sim untouched, deterministic under
  // ?freeze because the window is measured in run.distance, which is frozen).
  const COMBO_MIN = 10; // coins before the popup shows
  const COMBO_WINDOW_M = 45; // streak breaks after ~2 s without a pickup

  /** Restart a one-shot pop animation on an element. */
  function popBadge(el) {
    el.classList.remove("pop");
    void el.offsetWidth; // force reflow so the animation restarts
    el.classList.add("pop");
  }

  /**
   * Task 3.4: (re-)play the shared .screen-enter entrance on a screen root.
   * Purely presentational — remove -> forced reflow -> re-add restarts the
   * CSS animation on every show (same trick as popBadge). The keyframes
   * start FROM the offset and end AT identity, so under .qa-freeze /
   * reduced motion (animations killed) the element just renders settled.
   */
  function playScreenEnter(el) {
    if (!el) return;
    el.classList.remove("screen-enter");
    void el.offsetWidth; // force reflow so the animation restarts
    el.classList.add("screen-enter");
  }

  function updateHud() {
    if (state !== State.PLAYING || !qa.hud) return;
    const s = run.getStats();
    if (s.score !== lastScore) {
      lastScore = s.score;
      els.score.textContent = s.score.toLocaleString();
    }
    if (s.coins !== lastCoins) {
      lastCoins = s.coins;
      els.coins.textContent = s.coins.toLocaleString();
    }
    if (s.multiplier !== lastMult) {
      lastMult = s.multiplier;
      els.multiplier.textContent = String(s.multiplier);
      if (s.multiplier > 1) {
        els.multiplierDisplay.classList.remove("hidden");
        popBadge(els.multiplierDisplay);
      } else {
        els.multiplierDisplay.classList.add("hidden");
      }
    }
    const comboActive =
      comboStreak >= COMBO_MIN &&
      run.distance - comboLastDistance < COMBO_WINDOW_M;
    if (comboActive) {
      if (!comboShown) {
        comboShown = true;
        els.combo.classList.remove("hidden");
      }
      if (comboStreak !== lastComboShownValue) {
        lastComboShownValue = comboStreak;
        els.comboValue.textContent = String(comboStreak);
        popBadge(els.combo);
      }
    } else if (comboShown) {
      comboShown = false;
      lastComboShownValue = -1;
      els.combo.classList.add("hidden");
    }
    // Task 4.1: active-powerup chips. Timers are read straight off the
    // sim's public run.powerups (D5 zero-plumbing); jetpack is simply never
    // read here — it has no chip. Jetpack timer can never be faked.
    if (els.chipMagnet && els.chipMagnetFill) {
      writePuChip(els.chipMagnet, els.chipMagnetFill, magnetChipState, run.powerups.magnet, POWERUP_DURATION_S);
    }
    if (els.chipX2 && els.chipX2Fill) {
      writePuChip(els.chipX2, els.chipX2Fill, x2ChipState, run.powerups.x2, POWERUP_DURATION_S);
    }
  }

  // Combo streak wiring (UI-level; the sim/rng are untouched). "reset"
  // re-syncs every cache so a fresh run never shows stale values.
  run.events.on("reset", () => {
    lastScore = -1;
    lastCoins = -1;
    lastMult = -1;
    comboStreak = 0;
    comboLastDistance = -Infinity;
    comboShown = false;
    lastComboShownValue = -1;
    if (els.combo) els.combo.classList.add("hidden");
    // Task 4.1/4.2: chips hidden + caches invalidated so the fresh run's
    // first updateHud() rewrites every value from scratch (the reset event
    // fires before _initSimState zeroes run.powerups, so the caches — not
    // the timers — are the source of truth here).
    magnetChipState.on = false;
    magnetChipState.fill = -1;
    magnetChipState.low = false;
    x2ChipState.on = false;
    x2ChipState.fill = -1;
    x2ChipState.low = false;
    if (els.chipMagnet) {
      els.chipMagnet.classList.add("hidden");
      els.chipMagnet.removeAttribute("data-low");
    }
    if (els.chipX2) {
      els.chipX2.classList.add("hidden");
      els.chipX2.removeAttribute("data-low");
    }
    if (els.chipMagnetFill) els.chipMagnetFill.style.transform = "scaleX(1)";
    if (els.chipX2Fill) els.chipX2Fill.style.transform = "scaleX(1)";
    // Task 7.2: a fresh run never inherits a stale teaching toast (timer
    // dropped so it cannot re-hide mid-run-after-next).
    if (toastTimer) {
      clearTimeout(toastTimer);
      toastTimer = 0;
    }
    if (els.hintToast) els.hintToast.classList.add("hidden");
  });
  run.events.on("coin", () => {
    comboStreak += 1;
    comboLastDistance = run.distance;
  });

  // ------------------------------------------------------------
  // Game flow
  // ------------------------------------------------------------
  function startRun() {
    const username = (els.username.value || lastUsername || "player").trim() || "player";
    lastUsername = username;
    lsSet(LS_KEYS.username, username);
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();

    // D8 (task 7.1): one coach per not-yet-tutored run, from a FRESH LS
    // read — after a coached run ends (any way), the flag reads "1" and
    // later runs get coach = null. `run` doubles as the queries object:
    // its nearestJumpable/nearestOverhead are the read-only pass-throughs.
    coach = coachShouldRun(lsGet(LS_KEYS.tutored))
      ? createCoach({
          shouldRun: true,
          queries: run,
          showHint: (kind) => showToast(COACH_COPY[kind][currentScheme()]),
        })
      : null;

    run.start(); // emits "reset" -> vfx clears itself + HUD caches re-sync below
    world.reset();
    // Restore gameplay light levels (menu showcase boost removed).
    sky.hemi.intensity = 0.62;
    sky.sun.intensity = 4.6;
    world.update(0, run.curr.z);
    const pose = run.renderPose(1);
    run.updateRender(1, 0);
    vfx.advanceFixed(0, simInfo()); // seed the speed-line band for z=0 (opacity 0)
    chaseCam.snapTo(pose);
    sky.update(camera, pose.x, pose.z);
    paused = false;
    clearGrace(); // restart (e.g. from pause) must not resume into a stale countdown
    runStartedAt = performance.now();
    accumulator = 0;
    input.enable();
    audio.startMusic(); // lazy: no-op until the first user gesture created the ctx
    setState(State.PLAYING);
    updateHud();
  }

  /**
   * Fixed-step snapshot for the VFX layer (sim data only — deterministic).
   * @returns {{x: number, y: number, z: number, speed: number, phase: string, coinNear: object|null}}
   */
  function simInfo() {
    return {
      x: run.curr.x,
      y: run.curr.y,
      z: run.curr.z,
      speed: run.speed,
      phase: run.phase,
      coinNear: run.coinNear,
    };
  }

  /**
   * Animated count-up for a results value (rAF, ease-out cubic).
   * Instant under ?freeze (determinism) and for zero targets.
   */
  function startCountUp(el, target, ms, fmt) {
    if (!el) return;
    if (el._countRaf) cancelAnimationFrame(el._countRaf);
    if (qa.freeze || target <= 0) {
      el.textContent = fmt(target);
      return;
    }
    const t0 = performance.now();
    const tick = (now) => {
      const k = Math.min(1, (now - t0) / ms);
      const eased = 1 - Math.pow(1 - k, 3);
      el.textContent = fmt(Math.round(target * eased));
      if (k < 1) el._countRaf = requestAnimationFrame(tick);
      else el._countRaf = 0;
    };
    el._countRaf = requestAnimationFrame(tick);
  }

  /** Loading screen: quick fade for interactive boots, instant for QA captures. */
  function hideLoadingScreen() {
    if (!els.loading) return;
    if (qa.qa || qa.freeze) {
      els.loading.classList.add("hidden");
      return;
    }
    els.loading.classList.add("fading");
    setTimeout(() => els.loading.classList.add("hidden"), 360);
  }

  /**
   * Task 5.1: run duration as M:SS — minutes unbounded (a 61-minute run
   * reads 61:01, no hour rollover). Written straight to textContent, NOT
   * counted up: a ticking clock reads oddly on a results card, and a plain
   * write is instant + deterministic under ?freeze.
   */
  function fmtDuration(secs) {
    const s = Math.max(0, Math.floor(secs));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  }

  /**
   * Task 5.1/5.2: the pure results-banner decision, extracted so it can be
   * probed in isolation. Keeps the existing strict > rule (equaling the
   * best is NOT a new best); `gap` is the losing margin against a REAL
   * best — 0 whenever the line must hide (new best, tie, or first run
   * where high is still 0).
   */
  function resultsContext(score, high) {
    const isHigh = score > high;
    return { isHigh, gap: !isHigh && high > 0 ? high - score : 0 };
  }

  function showGameOver(stats) {
    input.disable();
    setPaused(false);
    markTutored(); // D8: a coached run teaches by ANY ending (death here)
    const duration = runStartedAt > 0 ? (performance.now() - runStartedAt) / 1000 : 0;
    // ?freeze captures must be byte-identical: performance.now() jitter around
    // a whole-second boundary would flip the mm:ss digit, so frozen results
    // pin the displayed duration to the fast-forwarded QA time. The real
    // delta still goes to the backend payload below.
    const shownDuration = qa.freeze ? Math.max(1, Math.round(qa.time) || 5) : duration;
    const high = lsInt(LS_KEYS.highScore);
    const { isHigh, gap } = resultsContext(stats.score, high);
    if (isHigh) lsSet(LS_KEYS.highScore, stats.score);
    els.newHigh.classList.toggle("hidden", !isHigh);
    if (isHigh) popBadge(els.newHigh); // Task 5.2: restart the CSS burst on every reveal
    if (els.goDuration) els.goDuration.textContent = fmtDuration(shownDuration);
    if (els.goGap) {
      els.goGap.textContent = gap > 0 ? `${gap.toLocaleString()} from your best` : "";
      els.goGap.classList.toggle("hidden", gap <= 0);
    }
    startCountUp(els.goScore, stats.score, 1150, (v) => v.toLocaleString());
    startCountUp(els.goDistance, stats.distance, 900, (v) => `${v}m`);
    startCountUp(els.goCoins, stats.coins, 900, (v) => v.toLocaleString());
    els.goBest.textContent = Math.max(high, stats.score).toLocaleString();

    // Persist locally FIRST — the network path can only ever be a bonus.
    lsSet(LS_KEYS.totalCoins, lsInt(LS_KEYS.totalCoins) + stats.coins);
    lsSet(LS_KEYS.games, lsInt(LS_KEYS.games) + 1);
    lsSet(LS_KEYS.lastRun, JSON.stringify({ ...stats, date: new Date().toISOString() }));

    applyHints(); // results hint names the live scheme's retry path
    setState(State.GAMEOVER);
    // Graceful backend submission (fire-and-forget, silent on any failure).
    submitRunToBackend({ ...stats, duration });
  }

  function showMenu() {
    input.disable();
    setPaused(false);
    clearGrace(); // quitting from pause must not leave a stale countdown
    refreshMenuStats();
    applyHints(); // menu hint wording matches the live scheme
    setState(State.MENU);
    loadLeaderboard();
  }

  els.playBtn.addEventListener("click", startRun);
  els.retryBtn.addEventListener("click", startRun);
  els.menuBtn.addEventListener("click", showMenu);
  if (els.resumeBtn) els.resumeBtn.addEventListener("click", () => setPaused(false));

  // D2: HUD pause button — pointerdown, not click (click would gamble on
  // the browser's synthetic-click delay on mobile stacks), and
  // preventDefault() keeps the press from synthesizing anything else. Only
  // ever pauses: the guard makes a second tap while paused a no-op (no
  // double-toggle); Esc/P keep toggling both ways via the InputManager
  // "pause" action below. The button's data-input-exclude marker already
  // stops InputManager reading this same gesture as jump/roll.
  if (els.pauseBtn) {
    els.pauseBtn.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      if (state === State.PLAYING && !paused) setPaused(true);
    });
  }

  // D4: tapping the grace overlay itself also affirms the resume — skip
  // the countdown. #resume-grace carries data-input-exclude, so
  // InputManager drops the same gesture instead of reading it as
  // jump/roll (D2); the global first-touch scheme latch is unaffected.
  if (els.resumeGrace) {
    els.resumeGrace.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      if (graceT > 0) skipGrace();
    });
  }

  // D3: pause panel actions. RESTART re-enters through the same startRun()
  // the menu/results screens use (run state resets, HUD caches re-sync via
  // the "reset" event, input re-enables, music restarts); MENU returns
  // through showMenu() (menu stats refresh). Neither banks the abandoned
  // run — coin/games/best writes live only in showGameOver(). The restart
  // handler unpauses FIRST: startRun() only flips the `paused` flag, so
  // routing the overlay hide through setPaused() guarantees no pause-overlay
  // remnant over the fresh run (showMenu() already calls setPaused(false)
  // at its top; the explicit call here is the same one-line guarantee).
  if (els.pauseRestartBtn) {
    els.pauseRestartBtn.addEventListener("click", () => {
      setPaused(false);
      markTutored(); // D8: restart ends the coached run — no hints on the retry
      startRun();
    });
  }
  if (els.pauseMenuBtn) {
    els.pauseMenuBtn.addEventListener("click", () => {
      setPaused(false); // symmetric with restart; showMenu() also unpauses
      markTutored(); // D8: quitting from pause ends the coached run too
      showMenu();
    });
  }

  els.username.addEventListener("keydown", (e) => {
    if (e.key === "Enter") startRun();
  });

  // ------------------------------------------------------------
  // Audio UI (D6): HUD master-mute button + the two menu settings
  // toggles, all synced from this one place. aria-pressed semantics:
  // #mute-btn is pressed while MUTED (it is a mute button), while the
  // menu toggles are pressed while their feature is ON — each button
  // announces the state it switches to, and the CSS off-state (slashed
  // glyph + dimmed text) keys off the same attribute.
  // ------------------------------------------------------------
  function applyMuteUi() {
    const muted = audio.muted;
    if (els.muteBtn) {
      els.muteBtn.classList.toggle("muted", muted);
      els.muteBtn.setAttribute("aria-pressed", String(muted));
    }
    const syncToggle = (btn, label, on, name) => {
      if (!btn) return;
      btn.setAttribute("aria-pressed", String(on));
      if (label) label.textContent = on ? `${name} ON` : `${name} OFF`;
    };
    syncToggle(els.musicToggle, els.musicToggleLabel, audio.musicOn, "MUSIC");
    syncToggle(els.sfxToggle, els.sfxToggleLabel, audio.sfxOn, "SFX");
  }

  function toggleMute() {
    audio.setMuted(!audio.muted);
    lsSet(LS_KEYS.muted, audio.muted ? "1" : "0");
    applyMuteUi();
  }

  // D6: music/sfx toggles — same ownership split as mute (audio.js holds
  // runtime state, main.js persists the choice, applyMuteUi re-syncs).
  function toggleMusic() {
    audio.setMusicOn(!audio.musicOn);
    lsSet(LS_KEYS.music, audio.musicOn ? "1" : "0");
    applyMuteUi();
  }

  function toggleSfx() {
    audio.setSfxOn(!audio.sfxOn);
    lsSet(LS_KEYS.sfx, audio.sfxOn ? "1" : "0");
    applyMuteUi();
  }

  if (els.muteBtn) els.muteBtn.addEventListener("click", toggleMute);
  if (els.musicToggle) els.musicToggle.addEventListener("click", toggleMusic);
  if (els.sfxToggle) els.sfxToggle.addEventListener("click", toggleSfx);
  applyMuteUi(); // reflect the persisted state on boot

  // ------------------------------------------------------------
  // Scheme-aware control hints (D1): every static hint slot has exactly
  // one string per input scheme — a touch line never names keys, a keys
  // line never says SWIPE/TAP. The wording must stand alone even where
  // CSS keeps the .swipe-arrows glyphs visible.
  // ------------------------------------------------------------
  const HINT_COPY = {
    menu: {
      touch: "SWIPE TO STEER · TAP TOP = JUMP · TAP BOTTOM = ROLL",
      keys: "ARROWS / WASD TO MOVE · UP = JUMP · DOWN = ROLL",
    },
    pause: {
      touch: "TAP RESUME TO CONTINUE",
      keys: "ESC / P TO RESUME · M TO MUTE",
    },
    results: {
      touch: "TAP RETRY FOR ANOTHER RUN",
      keys: "ENTER = RETRY · ESC = MENU",
    },
  };

  // D8 coaching copy (task 7.1): one string per verb per scheme — a touch
  // line never names keys, a keys line never says SWIPE/TAP (same
  // no-mixing rule as HINT_COPY, smoke-asserted). The how-to-play panel
  // renders from this SAME map so the wording can never drift.
  const COACH_COPY = {
    lane: {
      touch: "SWIPE LEFT OR RIGHT TO CHANGE LANES",
      keys: "ARROWS OR A/D TO CHANGE LANES",
    },
    jump: {
      touch: "SWIPE UP OR TAP TOP TO JUMP",
      keys: "UP ARROW, W OR SPACE TO JUMP",
    },
    roll: {
      touch: "SWIPE DOWN OR TAP BOTTOM TO ROLL",
      keys: "DOWN ARROW OR S TO ROLL",
    },
  };

  /** Fill every hint slot from the map for the live input scheme. */
  function applyHints() {
    const s = currentScheme();
    if (els.swipeText) els.swipeText.textContent = HINT_COPY.menu[s];
    if (els.pauseHint) els.pauseHint.textContent = HINT_COPY.pause[s];
    if (els.resultsHint) els.resultsHint.textContent = HINT_COPY.results[s];
    applyHowto(); // how-to-play panel copy + emphasis follow the scheme too
  }

  applyHints(); // reflect the detected scheme on boot (before first screen)

  // First real touchstart re-latches hybrid devices to "touch"; the hints
  // correct immediately (later screens re-run applyHints anyway).
  latchTouch(() => applyHints());

  // ------------------------------------------------------------
  // D8 teaching toast (task 7.2): ONE element, textContent swap, one
  // auto-dismiss timer. A second showToast replaces the first (timer
  // cleared + restarted) so toasts can never accumulate. Non-interactive:
  // #hint-toast is pointer-events: none (no data-input-exclude needed —
  // nothing born on it can become a gesture).
  // ------------------------------------------------------------
  const TOAST_MS = 2500;
  let toastTimer = 0;

  function showToast(text) {
    if (!els.hintToast) return;
    if (toastTimer) {
      clearTimeout(toastTimer); // replace, never stack
      toastTimer = 0;
    }
    els.hintToast.textContent = text;
    els.hintToast.classList.remove("hidden");
    // Under ?freeze the loop is stopped after warmup: the toast renders
    // settled (.qa-freeze kills the entrance animation) and the
    // auto-dismiss timer is NOT armed — a live setTimeout could otherwise
    // mutate the DOM after the captured frame and break determinism.
    if (qa.freeze) return;
    toastTimer = setTimeout(() => {
      toastTimer = 0;
      if (els.hintToast) els.hintToast.classList.add("hidden");
    }, TOAST_MS);
  }

  // ------------------------------------------------------------
  // D8 first-run coach (task 7.1). Created ONLY for a not-yet-tutored
  // save (LS "0"; MISSING key = existing player = already taught, D8).
  // Ticked on the fixed-step clock right next to vfx.advanceFixed; the
  // coach is read-only over the sim (distance/z in, hint callback out),
  // so a coached run and an uncoached run travel identical distance and
  // score. Flag lifecycle: the FIRST coached run marks the flag by ANY
  // ending — death (showGameOver), quit-from-pause, restart-from-pause.
  // ------------------------------------------------------------
  let coach = null;

  /** Persist "taught" — a no-op unless this run had coaching active. */
  function markTutored() {
    if (coach) lsSet(LS_KEYS.tutored, "1");
  }

  // ------------------------------------------------------------
  // Task 7.3: how-to-play review from the menu. A non-blocking overlay
  // (state machine untouched — state stays MENU, no run starts, gameplay
  // input is already disabled on the menu). Both schemes' controls render
  // from the SAME COACH_COPY map the coach uses (applyHowto, called from
  // applyHints on every screen change + latch), the live scheme's section
  // first and emphasized. Menu stats/leaderboard DOM is never touched
  // while open; closing restores the menu exactly as it was.
  // ------------------------------------------------------------
  function applyHowto() {
    const s = currentScheme();
    const fill = (list, lines) => {
      if (!list) return;
      list.replaceChildren(
        ...lines.map((text) => {
          const li = document.createElement("li");
          li.textContent = text; // textContent-only: no HTML injection
          return li;
        }),
      );
    };
    fill(els.howtoTouchList, [COACH_COPY.lane.touch, COACH_COPY.jump.touch, COACH_COPY.roll.touch]);
    fill(els.howtoKeysList, [COACH_COPY.lane.keys, COACH_COPY.jump.keys, COACH_COPY.roll.keys]);
    if (els.howtoTouchSection) els.howtoTouchSection.classList.toggle("howto-active", s === "touch");
    if (els.howtoKeysSection) els.howtoKeysSection.classList.toggle("howto-active", s === "keys");
  }

  function openHowto() {
    if (!els.howtoPanel) return;
    applyHowto(); // copy + emphasis for the live scheme at open time
    els.howtoPanel.classList.remove("hidden");
    if (els.howtoBtn) els.howtoBtn.setAttribute("aria-expanded", "true");
    if (els.howtoCloseBtn) els.howtoCloseBtn.focus(); // keyboard entry point
  }

  function closeHowto() {
    if (!els.howtoPanel) return;
    els.howtoPanel.classList.add("hidden");
    if (els.howtoBtn) {
      els.howtoBtn.setAttribute("aria-expanded", "false");
      els.howtoBtn.focus(); // focus returns to the opener
    }
  }

  if (els.howtoBtn) els.howtoBtn.addEventListener("click", openHowto);
  if (els.howtoCloseBtn) els.howtoCloseBtn.addEventListener("click", closeHowto);

  // Escape closes the review while it is open. The panel only exists over
  // the MENU, so this never races the PLAYING pause path (Esc/P there) or
  // the GAMEOVER shortcut listener (state-gated).
  document.addEventListener("keydown", (e) => {
    if (e.code !== "Escape") return;
    if (!els.howtoPanel || els.howtoPanel.classList.contains("hidden")) return;
    e.preventDefault();
    closeHowto();
  });

  // ------------------------------------------------------------
  // Pause overlay (Esc / P / visibilitychange) + resume grace (D4)
  // ------------------------------------------------------------
  // Grace HUD caches — quantized writes only (whole-second numeral,
  // 100-step bar): no per-frame allocation churn on the write path.
  let lastGraceNumeral = -1;
  let lastGraceBar = -1;

  /** Arm the countdown + show the overlay. Live interactive runs only. */
  function armGrace() {
    if (qa.freeze || qa.qa) return; // deterministic captures never count down
    graceT = GRACE_SECONDS;
    lastGraceNumeral = -1;
    lastGraceBar = -1;
    if (els.resumeGrace) els.resumeGrace.classList.remove("hidden");
    updateGraceHud();
  }

  /** Zero the countdown and hide the overlay (the one hide helper). */
  function clearGrace() {
    graceT = 0;
    lastGraceNumeral = -1;
    lastGraceBar = -1;
    if (els.resumeGrace) els.resumeGrace.classList.add("hidden");
  }

  /** Resume-affirming input: end the wait; the sim steps on the next frame. */
  function skipGrace() {
    clearGrace();
  }

  /** Per-frame grace HUD: whole-second numeral + scaleX(remaining) bar. */
  function updateGraceHud() {
    const n = Math.ceil(graceT);
    if (n !== lastGraceNumeral) {
      lastGraceNumeral = n;
      if (els.graceNumeral) els.graceNumeral.textContent = String(n);
    }
    const step = Math.round((graceT / GRACE_SECONDS) * 100);
    if (step !== lastGraceBar) {
      lastGraceBar = step;
      if (els.graceBar) els.graceBar.style.transform = "scaleX(" + step / 100 + ")";
    }
  }

  function setPaused(p) {
    const wasPaused = paused;
    paused = p;
    if (p) {
      clearGrace(); // pausing cancels any live countdown
      applyHints(); // pause overlay wording must name the live scheme
    } else if (graceNeedsArm(state, wasPaused, qa.freeze, qa.qa)) {
      armGrace(); // D4: a live run resumes through the skippable countdown
    }
    const showPause = p && state === State.PLAYING && qa.hud;
    if (els.pauseOverlay) {
      els.pauseOverlay.classList.toggle("hidden", !showPause);
      if (showPause) playScreenEnter(els.pausePanel); // task 3.4
    }
  }

  // ------------------------------------------------------------
  // Input
  // ------------------------------------------------------------
  const input = new InputManager((action) => {
    if (action === "pause") {
      if (graceT > 0) {
        // D4: Esc/P during the countdown is a resume-affirming input —
        // skip the wait (paused stays false; the run continues live).
        skipGrace();
        return;
      }
      if (state === State.PLAYING) setPaused(!paused);
      return;
    }
    if (state === State.PLAYING && !paused) run.bufferAction(action);
  });

  // Results-screen keyboard shortcuts — the keys wording promises
  // "ENTER = RETRY · ESC = MENU", so it must be true. InputManager is
  // disabled on the results screen by design, so this is a separate
  // minimal listener: it acts only while state === GAMEOVER, ignores
  // form-field targets, and never interferes with PLAYING input
  // (same model as the M-for-mute listener above).
  window.addEventListener("keydown", (e) => {
    if (state !== State.GAMEOVER || e.repeat) return;
    const tag = e.target && e.target.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    if (e.code === "Enter" || e.code === "NumpadEnter") {
      e.preventDefault(); // also stops a focused RETRY button's synthetic click
      startRun();
    } else if (e.code === "Escape") {
      e.preventDefault();
      showMenu();
    }
  });

  // ------------------------------------------------------------
  // WAVE 6: graceful backend integration.
  // The page NEVER issues /api/* requests — in an API-less environment
  // (the QA static server) they would 404 and Chromium logs console
  // errors we cannot suppress. Requests are relayed through the service
  // worker instead (see core/api.js): the SW fetches in its own context
  // where failures are invisible to the page console, and replies over a
  // MessageChannel. If the channel is unavailable (no SW support, no
  // activation within the timeout) every caller silently stays in
  // localStorage mode: zero console errors, zero retries.
  // ------------------------------------------------------------
  let leaderboardAttempted = false; // one attempt per page load — no spam

  async function loadLeaderboard() {
    if (qa.qa || leaderboardAttempted || !els.leaderboardPanel) return;
    leaderboardAttempted = true;
    const send = await getApiChannel();
    if (!send) return; // no SW channel -> localStorage-only (panel stays hidden)
    const reply = await send({ type: "leaderboard", limit: 5 });
    const data = reply && reply.rows;
    if (!Array.isArray(data) || data.length === 0) return; // stays hidden
    const rows = data.slice(0, 5).map((entry, i) => {
      const li = document.createElement("li");
      const rank = document.createElement("span");
      rank.className = "lb-rank";
      rank.textContent = String(i + 1);
      const name = document.createElement("span");
      name.className = "lb-name";
      name.textContent = String(entry.displayName || entry.username || "runner").slice(0, 18);
      const score = document.createElement("span");
      score.className = "lb-score";
      score.textContent = Number(entry.highScore || 0).toLocaleString();
      li.append(rank, name, score);
      return li;
    });
    els.leaderboardList.replaceChildren(...rows); // textContent-only: no HTML injection
    els.leaderboardPanel.classList.remove("hidden");
  }

  /**
   * Submit a finished run (fire-and-forget). The SW performs the full
   * server-side chain (POST /api/players/get-or-create -> POST /api/runs,
   * matching the API contract); any failure leaves the run saved in
   * localStorage only. Never blocks or affects the game-over UI.
   */
  async function submitRunToBackend(stats) {
    if (qa.qa) return;
    const send = await getApiChannel();
    if (!send) return; // offline -> local-only
    await send({
      type: "submit-run",
      run: {
        username: lastUsername || "player",
        score: stats.score,
        distance: stats.distance,
        coins: stats.coins,
        multiplier: stats.multiplier,
        duration: stats.duration,
      },
    });
  }

  // ------------------------------------------------------------
  // Quality tier management (auto step-down + rebuilds)
  // ------------------------------------------------------------
  const perf = new PerfMonitor({
    tier,
    onTierDown: () => stepDownTier(),
  });
  let lastStepAt = 0;

  function stepDownTier() {
    const now = performance.now();
    if (now - lastStepAt < 5000) return;
    lastStepAt = now;
    const idx = QUALITY_ORDER.indexOf(tier);
    if (idx > 0) applyTier(QUALITY_ORDER[idx - 1]);
  }

  function applyTier(newTier) {
    tier = newTier;
    preset = getQualityPreset(tier);
    perf.setTier(tier);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, preset.pixelRatioCap));
    renderer.shadowMap.enabled = preset.shadowsEnabled;
    sky.applyShadowMapSize(preset.shadowMapSize);
    sky.applyFogDistances(preset);
    world.drawDistance = preset.drawDistance;
    world.maxChunksAhead = preset.maxChunksAhead;
    post.dispose();
    post = new PostPipeline(renderer, scene, camera, preset, { bloom: !qa.nobloom });
    onResize();
  }

  // QA/debug surface.
  window.__ENGINE = {
    get state() {
      return state;
    },
    run,
    world,
    camera: chaseCam,
    applyTier,
    scene,
    renderer,
    post,
    sky,
    audio,
    vfx,
    get tier() {
      return tier;
    },
    /**
     * QA: render exactly one frame through the post pipeline using the
     * current sim/camera state (works after ?freeze stopped the loop).
     */
    renderOnce() {
      const pose = run.renderPose(1);
      if (state === State.PLAYING || state === State.GAMEOVER) run.updateRender(1, 0);
      renderer.info.reset();
      post.setSpeed(
        Math.min(1, Math.max(0, (run.speed - 26) / 8)) *
        (state === State.PLAYING ? 1 : 0)
      );
      post.render();
      world.setDrawCalls(renderer.info.render.calls);
      updateHud();
      return pose;
    },
  };

  // ------------------------------------------------------------
  // Resize + visibility
  // ------------------------------------------------------------
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
    if (document.hidden) {
      setPaused(true); // auto-pause during PLAYING
    } else {
      setPaused(false);
      lastTime = performance.now(); // avoid a giant catch-up dt
    }
  });

  // ------------------------------------------------------------
  // Game loop: fixed-timestep sim + interpolated render
  // ------------------------------------------------------------
  const FIXED = CONFIG.FIXED_DT;
  let lastTime = performance.now();
  let accumulator = 0;
  let rafId = 0;
  let menuTime = 0;
  let stopped = false;

  function frame(now) {
    if (stopped) return;
    rafId = requestAnimationFrame(frame);
    const dt = Math.min((now - lastTime) / 1000, CONFIG.MAX_FRAME_DT);
    lastTime = now;
    perf.frame(now);

    let warmupDone = false;
    if (!freezeMode) {
      // --- simulation -------------------------------------------
      // D4: the resume grace runs on real time and freezes the run
      // exactly like a pause — distance/time cannot drift because the
      // sim simply does not step while it counts down.
      if (graceT > 0) {
        graceT = Math.max(0, graceT - dt); // real dt, never run time
        if (graceT === 0) clearGrace();
        else updateGraceHud();
      }
      if (simCanStep(state, paused, graceT)) {
        const scaled = dt * run.timeScale;
        accumulator += scaled;
        let steps = 0;
        while (accumulator >= FIXED && steps < 8) {
          run.fixedUpdate(FIXED);
          vfx.advanceFixed(FIXED, simInfo()); // fixed-step VFX (deterministic)
          // D8: teaching coach rides the SAME fixed clock — read-only over
          // the sim (distance/z in, at most one toast callback per verb).
          if (coach) coach.tick(run.distance, run.z);
          accumulator -= FIXED;
          steps++;
        }
        if (steps === 8) accumulator = 0; // spiral-of-death guard
        world.update(scaled, run.curr.z);
      } else if (state === State.MENU) {
        menuTime += dt;
        world.update(dt, 0);
      }
    }

    // --- render-time updates ------------------------------------
    const alpha = accumulator / FIXED;
    const pose = run.renderPose(alpha);
    if (state === State.PLAYING || state === State.GAMEOVER) {
      run.updateRender(alpha, freezeMode ? 0 : dt);
      if (!freezeMode) {
        chaseCam.update(dt, pose, run.timeScale);
        sky.update(camera, pose.x, pose.z, dt);
      }
    } else if (state === State.MENU) {
      // Ambient orbit showing the track.
      const t = menuTime;
      camera.position.set(Math.sin(t * 0.22) * 4, 3.4 + Math.sin(t * 0.5) * 0.2, -7 + Math.cos(t * 0.16) * 1.5);
      camera.lookAt(-1.35, 1.5, 10); // offset target: idle character sits left-of-center, clear of the panel
      // Freeze-aware dt (same contract as the PLAYING branch above): ?freeze
      // menu captures must be byte-identical, so the sky clock and character
      // pose get zero real-time advance.
      sky.update(camera, 0, 0, freezeMode ? 0 : dt);
      run.updateRender(1, freezeMode ? 0 : dt);
    }

    renderer.info.reset(); // manual accounting: count ALL composer passes
    post.setSpeed(
      Math.min(1, Math.max(0, (run.speed - 26) / 8)) *
      (simCanStep(state, paused, graceT) ? 1 : 0) // no speed lines while frozen
    );
    post.speedPass.uniforms.uTime.value = (run.distance || 0) * 0.05; // deterministic clock
    post.render();
    world.setDrawCalls(renderer.info.render.calls);
    updateHud();

    warmupDone = markFrameRendered();
    if (qa.freeze && warmupDone && !stopped) {
      // Deterministic screenshot mode: hold this exact frame forever.
      freezeMode = true;
      stopped = true;
      cancelAnimationFrame(rafId);
    }
  }

  // ------------------------------------------------------------
  // Fast-forward (?time=T): simulate T seconds before the first render,
  // settling the camera too, so ?freeze shots are fully deterministic.
  // ------------------------------------------------------------
  function fastForward(seconds) {
    const steps = Math.round(seconds / FIXED);
    for (let i = 0; i < steps; i++) {
      run.fixedUpdate(FIXED);
      // Advance visual pose blends per fixed step (fixed dt -> deterministic
      // frozen frames showing the true animation state, not a snapped one).
      run.updateRender(1, FIXED);
      // Wave 5: advance the VFX pools on the same fixed clock so the frozen
      // frame shows the exact deterministic particle state.
      vfx.advanceFixed(FIXED, simInfo());
      if (run.phase === "dead") break;
      if (i % 20 === 0) world.update(FIXED, run.curr.z);
      chaseCam.update(FIXED, run.renderPose(1), run.timeScale);
      sky.update(camera, run.curr.x, run.curr.z, FIXED);
    }
    world.update(FIXED, run.curr.z);
    run.updateRender(1, 0);
  }

  // ------------------------------------------------------------
  // Boot sequence (synchronous, zero network)
  // ------------------------------------------------------------
  const autostart = qa.qa || qa.time > 0 || qa.freeze;
  if (autostart) {
    startRun();
    if (qa.time > 0) {
      fastForward(qa.time);
      accumulator = FIXED; // render exactly the final sim state (alpha = 1)
      // Pin the camera to the exact mode pose (kills accumulated smoothing
      // drift so ?cam/?freeze captures are deterministic at any resolution).
      if (qa.cam) chaseCam.snapToMode(run.renderPose(1));
    }
    // ?screen=S (task 8.2): force a frozen shell state on top of the
    // autostarted run so every screen has a deterministic capture. Applied
    // before the loop starts, so the warmup frames render the target state.
    if (qa.screen === "menu") {
      showMenu();
    } else if (qa.screen === "pause") {
      setPaused(true);
    } else if (qa.screen === "results") {
      showGameOver(run.getStats());
    }
  } else {
    showMenu(); // also sets State.MENU
  }
  // Freeze mode: no sim stepping, no camera drift — every warmup frame is
  // identical, so the captured screenshot is deterministic.
  freezeMode = qa.freeze;

  onResize();
  lastTime = performance.now();
  rafId = requestAnimationFrame(frame);

  // Engine ready: reveal the game (never waiting on network). Interactive
  // boots get a quick fade; QA captures hide it instantly (determinism).
  hideLoadingScreen();
}
