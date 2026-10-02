/**
 * @file qa/hooks.js
 * URL-param QA driver for the automated visual pipeline.
 *
 * Supported params:
 *   ?qa=1        skip menu, autostart PLAYING as "QA", hide #username-form
 *   ?seed=N      deterministic world/simulation
 *   ?cam=MODE    camera override: close | chase | side | front
 *   ?time=T      fast-forward: simulate T seconds before the first render
 *                (cap 120 s)
 *   ?freeze=1    render warmup frames then stop the loop (stable shot)
 *   ?screen=S    with ?freeze: force a frozen shell state for captures
 *                (menu | pause | results — applied after autostart)
 *   ?hud=0       hide #hud and all DOM UI for clean screenshots
 *   ?quality=T   quality tier override (low|medium|high|ultra)
 *   ?nobloom=1   disable bloom pass
 *
 * window.__QA = { params, screenshotReady } — screenshotReady resolves
 * after the first stable post-warmup frame (see main.js).
 */

const TIME_CAP = 120; // s
const WARMUP_FRAMES = 5;

/**
 * Parse and apply DOM-level QA hooks.
 * @returns {{qa: boolean, seed: string|null, cam: string|null, time: number,
 *   freeze: boolean, screen: string|null, hud: boolean, quality: string|null,
 *   nobloom: boolean}}
 */
export function initQaHooks() {
  const params = new URLSearchParams(window.location.search);
  const cfg = {
    qa: params.get("qa") === "1",
    seed: params.get("seed"),
    cam: params.get("cam"),
    time: Math.min(parseFloat(params.get("time") || "0") || 0, TIME_CAP),
    freeze: params.get("freeze") === "1",
    screen: params.get("screen"),
    hud: params.get("hud") !== "0", // default: HUD on
    quality: params.get("quality"),
    nobloom: params.get("nobloom") === "1",
  };

  if (cfg.qa) {
    const form = document.getElementById("username-form");
    if (form) form.classList.add("hidden");
    const input = document.getElementById("username-input");
    if (input) input.value = "QA";
  }
  if (!cfg.hud) {
    for (const id of ["hud", "menu-screen", "gameover-screen", "pause-overlay", "resume-grace", "loading-screen"]) {
      const el = document.getElementById(id);
      if (el) el.classList.add("hidden");
    }
  }

  /** Resolves once the post pipeline has rendered WARMUP_FRAMES frames. */
  let resolveReady;
  const screenshotReady = new Promise((resolve) => {
    resolveReady = resolve;
  });

  window.__QA = {
    params: cfg,
    screenshotReady,
    _resolveReady: () => resolveReady(),
  };

  return cfg;
}

/**
 * Called by main after each rendered frame; resolves screenshotReady
 * after the warmup count.
 * @returns {boolean} True when warmup is complete (QA freeze can stop).
 */
export function markFrameRendered() {
  const qa = window.__QA;
  if (!qa || qa._done) return true;
  qa._frames = (qa._frames || 0) + 1;
  if (qa._frames >= WARMUP_FRAMES) {
    qa._done = true;
    qa._resolveReady();
    return true;
  }
  return false;
}
