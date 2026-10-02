#!/usr/bin/env bun
/**
 * UI/UX PASS smoke test — tokens, a11y baseline, touch targets, then the
 * input-scheme layer (headless static contract checks + logic probes in the
 * wave6 style; NO browser).
 *
 * Validates tasks 1.1–1.3 of openspec change "ui-ux-pass":
 *  1. Motion/spacing/radius tokens exist in :root and are referenced by
 *     component rules.
 *  2. Viewport meta contains viewport-fit=cover.
 *  3. env(safe-area-inset-*) applied via max(<floor>, env(...)) on #hud,
 *     the HUD corner buttons and the menu container (plus the centered
 *     results/pause overlays that can touch screen edges).
 *  4. One global :focus-visible rule covers button / input / [tabindex]
 *     with a 2px accent outline + offset.
 *  5. prefers-reduced-motion is a GLOBAL kill (universal selector, zeroed
 *     durations) — the old six-selector list is gone.
 *  6. .qa-freeze still hard-disables animation/transition with !important
 *     and is ordered to win over normal rules AND the reduced-motion block.
 *  7. 44px touch targets: #mute-btn, the #hud button floor (which the
 *     future pause button inherits), .settings-btn and .btn (which covers
 *     #retry-btn / #menu-btn / #resume-btn / #play-btn).
 *  8. Migrated-away hardcoded radius/padding values no longer appear
 *     outside the :root token block.
 *
 * Validates tasks 2.1–2.3 (scheme-aware hints + gesture exclusion):
 *  10. core/scheme.js exists, exports detectScheme/latchTouch, precached by
 *      sw.js; #mute-btn carries data-input-exclude; InputManager drops
 *      gestures born on [data-input-exclude]; HINT_COPY holds BOTH schemes
 *      for all three slots with zero scheme mixing; applyHints() wired at
 *      boot/menu/pause/results/latch; #results-hint exists + styled;
 *      keys mode hides the swipe glyphs.
 *  11. scheme.js logic probes (sandboxed): coarse->touch, fine/missing/
 *      throwing matchMedia->keys, one-shot touch latch sticks, listener
 *      removed after first fire, latchTouch idempotent.
 *  12. InputManager probe (sandboxed): excluded-target gesture (swipe AND
 *      tap) fires no action; plain-element swipe/tap still steer; null
 *      target is safe.
 *  13. applyHints probe: the REAL HINT_COPY literal fills the three hint
 *      elements per scheme — touch copy has zero key names, keys copy has
 *      zero swipe/tap words.
 *  14. Tasks 3.1/3.2 (static): #pause-btn exists bottom-left with
 *      data-input-exclude + aria-label + inline SVG glyph mirroring the
 *      overlay icon; #pause-overlay hosts RESUME -> RESTART -> MENU in DOM
 *      order on the 44px .btn floor; main.js wires pauseBtn on pointerdown
 *      and routes restart -> startRun() / menu -> showMenu() with zero new
 *      localStorage writes on those paths.
 *  15. Tasks 3.1/3.2 (logic probes, sandboxed): the REAL pointerdown
 *      handler source pauses PLAYING runs (and only them, no double-toggle,
 *      preventDefault called); the REAL InputManager + REAL action callback
 *      still toggle pause via Esc/P and gate gameplay buffering while
 *      paused; restart/menu handlers unpause first, hide the overlay, and
 *      call startRun/showMenu exactly once without banking anything.
 *
 * Validates tasks 3.3/3.4 (safe-resume grace + screen-transition polish):
 *  16. #resume-grace exists (hidden by default, data-input-exclude,
 *      full-screen pointer target, numeral child + scaleX bar child); no
 *      CSS keyframes drive the grace — main.js writes the numeral
 *      textContent and the bar transform per frame; GRACE_SECONDS = 1.2;
 *      the sim branch is gated through the pure simCanStep(state, paused,
 *      graceT); arming goes through the pure graceNeedsArm (PLAYING +
 *      wasPaused + not freeze/qa); the visibilitychange handler only routes
 *      setPaused(false); startRun/showMenu clear the countdown; Esc/P
 *      during grace and pointerdown on the overlay skip it.
 *  17. .screen-enter: shared transform/opacity-only keyframes on
 *      var(--dur-2)/var(--ease-out) that start FROM the offset and end AT
 *      identity (settled when animations are killed); applied by main.js to
 *      .menu-container, .results-panel and .pause-panel on every show via
 *      remove -> reflow -> add; the old menu-in/results-in/pause-in
 *      entrances are removed (single source of motion); the rule carries no
 *      !important so .qa-freeze/reduced-motion still win.
 *  18. Grace logic probes (sandboxed): arming table (live paused run arms;
 *      dead run / menu / results / loading / ?freeze / ?qa never arm),
 *      gating table (grace active -> sim frozen so distance cannot drift;
 *      elapsed -> steps; paused/menu -> never), and the REAL extracted
 *      setPaused body driving the REAL graceNeedsArm: resuming a paused
 *      PLAYING run arms 1.2 s + shows the overlay while the pause overlay
 *      hides, a skip input zeroes it and hides it, pausing mid-grace
 *      cancels it, and un-pausing at MENU never arms.
 *
 * Validates tasks 4.1/4.2 (powerup status chips + HUD accuracy on restart):
 *  19. Static: #powerup-chips hosts EXACTLY #chip-magnet + #chip-x2 (both
 *      boot .hidden with data-pu attrs and a .pu-bar > .pu-fill drain bar);
 *      NO jetpack chip exists anywhere (D5 — the sim's jetpack timer is a
 *      data-only stub, a chip would lie); the container sits inside #hud on
 *      the left edge below #multiplier-display; .pu-fill is a JS-driven
 *      transform bar (same pattern as #grace-bar, settled under ?freeze);
 *      the [data-low] pulse animates opacity only (decoration — the bar is
 *      the honest signal) and the .pu-chip base rule carries no animation
 *      or hidden-state opacity (visibility = .hidden class only); main.js
 *      declares POWERUP_DURATION_S = 10 matching run.js's collectPowerup
 *      grant, updateHud reads run.powerups.magnet/.x2, the reset handler
 *      hides + invalidates the chips, and the powerup listener pops only
 *      the magnet/x2 chips (never jetpack).
 *  20. Logic probes (sandboxed, REAL extracted updateHud/writePuChip/reset
 *      sources over fake run + recording fake els): magnet collect -> chip
 *      visible at scaleX(1), decay -> 0.6, <= 25% -> data-low, expiry ->
 *      hidden + bar parked full; settled frames write NOTHING (quantized
 *      caches); x2 collect -> chip visible + multiplier display shows 2;
 *      a live jetpack timer changes NO chip state; a reset with stale
 *      caches (score 500 / coins 30 / magnet shown) makes the FIRST
 *      updateHud rewrite "0"/"0", hide the multiplier chip and both
 *      powerup chips (task 4.2: zero stale renders after RETRY).
 *
 * Validates tasks 5.1/5.2 (results run context + new-best celebration):
 *  21. Static: .gameover-stats reads DISTANCE, COINS, TIME, BEST with an
 *      inline-SVG clock on the TIME row (#go-duration boots "0:00");
 *      #go-gap exists and boots hidden; #new-high-score is a full-width
 *      gold banner hosting EXACTLY 4-6 .burst sparkle spans whose static
 *      styles are settled-visible (no opacity:0 base) and whose .pop
 *      animation (burst-pop) animates transform/opacity only; main.js
 *      declares fmtDuration + the pure resultsContext(score, high)
 *      helper, writes goDuration through fmtDuration (never counted up),
 *      formats the gap as "<n> from your best" via toLocaleString,
 *      toggles #go-gap hidden at gap <= 0, and re-triggers the burst via
 *      popBadge(els.newHigh) on every isHigh reveal.
 *  22. Logic probes (sandboxed, REAL extracted sources): fmtDuration
 *      0 -> "0:00", 59 -> "0:59", 60 -> "1:00", 3661 -> "61:01"
 *      (minutes unbounded), floats floor, negatives clamp; resultsContext
 *      table: 500/3000 -> gap 2500 ("2,500" locale string) + no banner,
 *      3000/3000 -> tie is NOT a new best and gap 0, 3001/3000 -> banner
 *      + gap 0, 100/0 -> first-run banner + gap 0, 0/0 -> nothing shows.
 *
 * Validates tasks 6.1/6.2 (D6 per-bus audio settings + menu toggle rows):
 *  23. Static: the menu .settings-row hosts EXACTLY #music-toggle +
 *      #sfx-toggle (both .settings-btn with aria-pressed + label spans +
 *      inline SVG glyph pairs; the old single #sound-toggle is fully
 *      removed); the CSS off state keys off [aria-pressed="false"]
 *      (pressed = feature ON); audio.js boots musicOn/sfxOn from
 *      late_again_music / late_again_sfx (missing key = on, "0" = the only
 *      off value), gates the scheduler on the combined musicOn && !muted
 *      condition (same idle shape as mute) and early-returns play() while
 *      sfx is off; main.js persists both toggles (caller owns localStorage,
 *      same split as mute) and extends applyMuteUi() to sync all three
 *      controls' aria-pressed + labels.
 *  24. Logic probes (sandboxed AudioManager, stubbed AudioContext +
 *      localStorage, node-counting ctx): boot table (missing/"0"/"1"/other
 *      truthy keys); music off -> startMusic and even a forced scheduler
 *      tick produce ZERO scheduled voices while sfx still plays; sfx off ->
 *      play() is a silent no-op while music still schedules; master mute
 *      kills both regardless of the settings and unmute resumes the groove
 *      only when the music setting allows; re-enabling music in the menu
 *      resumes a wanted groove and the next startMusic works; a fresh
 *      instance (reload) boots with the persisted choices; the REAL
 *      applyMuteUi/toggleMute/toggleMusic/toggleSfx sources keep all three
 *      aria-pressed states + labels in sync and persist every toggle.
 *
 * Validates tasks 7.1/7.2/7.3 (D8 first-run teaching + how-to-play):
 *  25. Static: game/coach.js exists (dependency-free, exports
 *      coachShouldRun + createCoach, TUTOR_KEY = "late_again_tutored",
 *      missing/corrupt flag = already taught via the === "0" rule);
 *      ObstacleManager gains READ-ONLY nearestJumpable/nearestOverhead
 *      kind scans (query bodies touch no store mutation) with run.js
 *      pass-throughs folding in the runner lane; sw.js precaches the new
 *      module; index.html hosts #hint-toast (hidden, aria-live) inside
 *      #hud plus the #howto-btn row under the settings row and the
 *      non-blocking #howto-panel dialog with its close button; main.js
 *      creates the coach in startRun from a fresh LS read, ticks it on the
 *      fixed-step clock, marks the flag from showGameOver AND both pause
 *      exit handlers, declares COACH_COPY (both schemes x 3 verbs,
 *      no-mixing asserted), a 2500 ms single-toast auto-dismiss guarded
 *      off under ?freeze, and the reset handler clears a stale toast;
 *      style.css gives #hint-toast pointer-events: none + a
 *      transform/opacity-only entrance and the how-to overlay styles.
 *      Probes (sandboxed): coachShouldRun value table; a full coached run
 *      fires lane/jump/roll EXACTLY once each at the right triggers with
 *      nothing beyond 200 m and nothing on an already-taught save; the
 *      REAL showToast over stubbed els/timers — one element, replace
 *      semantics (one timer), auto-hide at 2500 ms, no timer armed under
 *      ?freeze; openHowto/closeHowto show/hide the panel, move focus both
 *      ways, never touch the state machine or the menu stats/leaderboard
 *      DOM (snapshot identical), and applyHowto renders both schemes from
 *      COACH_COPY emphasizing the live scheme.
 *
 * Run: bun .qa/ui-ux-smoke.mjs
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CLIENT = join(ROOT, "client");

let pass = 0;
let fail = 0;
function check(name, cond, extra = "") {
  if (cond) {
    pass++;
    console.log(`  ok  ${name}`);
  } else {
    fail++;
    console.error(`FAIL  ${name}${extra ? " — " + extra : ""}`);
  }
}

const css = readFileSync(join(CLIENT, "css/style.css"), "utf8");
const html = readFileSync(join(CLIENT, "index.html"), "utf8");
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));

/* ------------------------------------------------------------------ *
 * Tiny static CSS tooling: comment-stripping + a recursive block      *
 * extractor good enough for contract checks (no full parser needed).  *
 * ------------------------------------------------------------------ */
const cssNC = css.replace(/\/\*[\s\S]*?\*\//g, "");

/** Extract every style rule as {prelude, body, media}, flattening @media. */
function extractRules(src, media = null) {
  const rules = [];
  let i = 0;
  while (i < src.length) {
    const open = src.indexOf("{", i);
    if (open === -1) break;
    const prelude = src.slice(i, open).trim();
    let depth = 1;
    let j = open + 1;
    while (j < src.length && depth > 0) {
      if (src[j] === "{") depth++;
      else if (src[j] === "}") depth--;
      j++;
    }
    const body = src.slice(open + 1, j - 1);
    if (prelude.startsWith("@media") || prelude.startsWith("@supports")) {
      rules.push(...extractRules(body, prelude));
    } else if (!prelude.startsWith("@")) {
      rules.push({ prelude, body, media });
    }
    i = j;
  }
  return rules;
}

const rules = extractRules(cssNC);
function bodyOf(re) {
  const hit = rules.find((r) => re.test(r.prelude));
  return hit ? hit.body : null;
}
function pxVal(body, prop) {
  if (!body) return null;
  const m = body.match(new RegExp(`${prop}\\s*:\\s*(\\d+(?:\\.\\d+)?)px`));
  return m ? parseFloat(m[1]) : null;
}
const rootBody = bodyOf(/^:root$/);
const count = (re) => (cssNC.match(re) || []).length;

/* ================================================================== *
 * 1. Tokens exist and are actually used                               *
 * ================================================================== */
console.log("[1] motion / spacing / radius tokens");
{
  const tokens = [
    "--dur-1",
    "--dur-2",
    "--ease-out",
    "--space-1",
    "--space-2",
    "--space-3",
    "--space-4",
    "--space-5",
    "--space-6",
    "--radius-s",
    "--radius-m",
    "--radius-l",
    "--radius-pill",
  ];
  for (const tok of tokens) {
    check(`:root defines ${tok}`, rootBody !== null && rootBody.includes(`${tok}:`));
  }
  const radii = count(/var\(--radius-/g);
  const spaces = count(/var\(--space-/g);
  const durs = count(/var\(--dur-/g);
  const eases = count(/var\(--ease-out/g);
  check(`radius tokens referenced by component rules (${radii} uses)`, radii >= 8);
  check(`spacing tokens referenced by component rules (${spaces} uses)`, spaces >= 12);
  check(`motion duration tokens referenced (${durs} uses)`, durs >= 4);
  check(`motion easing token referenced (${eases} uses)`, eases >= 4);
}

/* ================================================================== *
 * 2. Viewport meta                                                    *
 * ================================================================== */
console.log("[2] viewport-fit=cover");
{
  const m = html.match(/<meta[^>]*name="viewport"[^>]*>/);
  check("viewport meta tag present", !!m);
  check("viewport meta contains viewport-fit=cover", !!m && m[0].includes("viewport-fit=cover"));
}

/* ================================================================== *
 * 3. Safe-area insets via max(<floor>, env(safe-area-inset-*))        *
 * ================================================================== */
console.log("[3] safe-area-aware padding");
{
  const hud = bodyOf(/^#hud$/);
  check(
    "#hud pads all four sides with max(<floor>, env(safe-area-inset-*))",
    !!hud &&
      /max\(\s*14px,\s*env\(safe-area-inset-top/.test(hud) &&
      /max\(\s*18px,\s*env\(safe-area-inset-right/.test(hud) &&
      /max\(\s*14px,\s*env\(safe-area-inset-bottom/.test(hud) &&
      /max\(\s*18px,\s*env\(safe-area-inset-left/.test(hud),
  );

  const mute = bodyOf(/^#mute-btn$/);
  check(
    "#mute-btn (corner button) offsets are safe-area aware",
    !!mute &&
      /max\(\s*18px,\s*env\(safe-area-inset-right/.test(mute) &&
      /max\(\s*18px,\s*env\(safe-area-inset-bottom/.test(mute),
  );

  const menu = bodyOf(/^\.menu-container$/);
  check(
    ".menu-container pads with max(var(--space-3), env(safe-area-inset-*))",
    !!menu &&
      /max\(\s*var\(--space-3\),\s*env\(safe-area-inset-top/.test(menu) &&
      /max\(\s*var\(--space-3\),\s*env\(safe-area-inset-left/.test(menu),
  );

  // Centered overlays whose panels can reach physical edges in landscape.
  const screens = bodyOf(/^#menu-screen,\s*#gameover-screen$/);
  const pause = bodyOf(/^#pause-overlay$/);
  check(
    "#gameover-screen keeps results panel inside safe area",
    !!screens && /padding:[^;]*env\(safe-area-inset-/.test(screens),
  );
  check(
    "#pause-overlay keeps pause panel inside safe area",
    !!pause && /padding:[^;]*env\(safe-area-inset-/.test(pause),
  );
}

/* ================================================================== *
 * 4. Keyboard focus indicator                                         *
 * ================================================================== */
console.log("[4] :focus-visible baseline");
{
  const rule = rules.find((r) => /focus-visible/.test(r.prelude));
  check(":focus-visible rule exists", !!rule);
  const selParts = rule ? rule.prelude.split(",").map((s) => s.trim()) : [];
  check(
    ":focus-visible covers button, input and [tabindex]",
    selParts.includes("button:focus-visible") &&
      selParts.includes("input:focus-visible") &&
      selParts.includes("[tabindex]:focus-visible"),
    rule ? rule.prelude : "no rule",
  );
  check(
    ":focus-visible uses a 2px accent outline + offset",
    !!rule && /outline:\s*2px\s+solid\s+var\(--/.test(rule.body) && /outline-offset:\s*\d+px/.test(rule.body),
  );
  check(
    "#username-input no longer suppresses outlines (outline: none removed)",
    (bodyOf(/^#username-input$/) || "") && !/outline:\s*none/.test(bodyOf(/^#username-input$/)),
  );
}

/* ================================================================== *
 * 5. Reduced motion — global kill                                     *
 * ================================================================== */
console.log("[5] global reduced-motion kill");
{
  const rm = rules.filter((r) => r.media && /prefers-reduced-motion/.test(r.media));
  check("prefers-reduced-motion media query exists", rm.length > 0);
  const uni = rm.find((r) => /^\*,\s*\*::before,\s*\*::after$/.test(r.prelude));
  check("kill is universal (*, *::before, *::after), not a subset", !!uni);
  check(
    "animation + transition durations zeroed under !important (state still renders)",
    !!uni &&
      /animation-duration:\s*0\.01ms\s*!important/.test(uni.body) &&
      /animation-iteration-count:\s*1\s*!important/.test(uni.body) &&
      /transition-duration:\s*0\.01ms\s*!important/.test(uni.body),
  );
  const oldSubset = rm.some((r) =>
    /\.game-title|#play-btn|\.swipe-arrows|#new-high-score|\.coin-face|\.loader-shadow/.test(r.prelude),
  );
  check("old six-selector reduced-motion list deleted", !oldSubset);
}

/* ================================================================== *
 * 6. .qa-freeze kill-switch still total (and ordered to win)          *
 * ================================================================== */
console.log("[6] .qa-freeze deterministic captures");
{
  const fz = rules.filter((r) => /\.qa-freeze/.test(r.prelude));
  check(".qa-freeze rules exist", fz.length > 0);
  check(
    ".qa-freeze disables animation+transition with !important",
    fz.length > 0 &&
      fz.every((r) => /animation:\s*none\s*!important/.test(r.body) && /transition:\s*none\s*!important/.test(r.body)),
  );
  const fzIdx = rules.findIndex((r) => /\.qa-freeze/.test(r.prelude));
  const rmIdx = rules.findIndex((r) => r.media && /prefers-reduced-motion/.test(r.media));
  check(
    ".qa-freeze ordered after the reduced-motion block (order + !important => wins over both)",
    fzIdx > rmIdx && rmIdx !== -1,
    `qa-freeze rule #${fzIdx}, reduced-motion rule #${rmIdx}`,
  );
}

/* ================================================================== *
 * 7. Touch targets >= 44px                                            *
 * ================================================================== */
console.log("[7] 44px touch targets");
{
  const mute = bodyOf(/^#mute-btn$/);
  check(
    "#mute-btn is 44x44",
    pxVal(mute, "width") >= 44 && pxVal(mute, "height") >= 44,
    `w=${pxVal(mute, "width")} h=${pxVal(mute, "height")}`,
  );

  const hudBtn = bodyOf(/^#hud button$/);
  check(
    "#hud button floor >=44 (future pause button inherits the target)",
    pxVal(hudBtn, "min-width") >= 44 && pxVal(hudBtn, "min-height") >= 44,
    `min-w=${pxVal(hudBtn, "min-width")} min-h=${pxVal(hudBtn, "min-height")}`,
  );

  const settings = bodyOf(/^\.settings-btn$/);
  check(
    ".settings-btn target >=44",
    pxVal(settings, "min-height") >= 44 && pxVal(settings, "min-width") >= 44,
    `min-w=${pxVal(settings, "min-width")} min-h=${pxVal(settings, "min-height")}`,
  );

  const btn = bodyOf(/^\.btn$/);
  check(
    ".btn target >=44 (covers #retry-btn / #menu-btn / #resume-btn)",
    pxVal(btn, "min-height") >= 44 && pxVal(btn, "min-width") >= 44,
    `min-w=${pxVal(btn, "min-width")} min-h=${pxVal(btn, "min-height")}`,
  );

  for (const id of ["mute-btn", "play-btn", "retry-btn", "menu-btn", "resume-btn"]) {
    check(`index.html still has #${id}`, html.includes(`id="${id}"`));
  }
}

/* ================================================================== *
 * 8. No migrated-away hardcoded values outside :root                  *
 * ================================================================== */
console.log("[8] hardcoded one-off sweep");
{
  const withoutRoot = cssNC.replace(/:root\s*\{[^}]*\}/, "");
  const oldValues = [
    // radii
    "border-radius: 16px",
    "border-radius: 14px",
    "border-radius: 22px",
    "border-radius: 24px",
    "border-radius: 11px",
    "border-radius: 999px",
    // paddings migrated onto --space-*
    "padding: 8px 16px 9px",
    "padding: 9px 16px",
    "padding: 8px 16px",
    "padding: 20px 20px 16px",
    "padding: 13px 20px",
    "padding: 12px 26px",
    "padding: 15px 26px 16px",
    "padding: 13px 20px 14px",
    "padding: 26px 24px 22px",
    "padding: 28px 26px 24px",
    "padding: 7px 10px",
    "padding: 12px;",
    "padding: 14px 16px 12px",
    "padding: 11px 22px 12px",
    // gaps migrated onto --space-*
    "gap: 16px",
    "gap: 12px;",
    "gap: 11px;",
  ];
  const leftover = oldValues.filter((v) => withoutRoot.includes(v));
  check(
    `none of the ${oldValues.length} migrated values remain outside :root`,
    leftover.length === 0,
    leftover.join(" | "),
  );
}

/* ================================================================== *
 * 9. package.json smoke chain                                         *
 * ================================================================== */
console.log("[9] test:smoke chain");
{
  const chain = (pkg.scripts && pkg.scripts["test:smoke"]) || "";
  check("test:smoke runs ui-ux-smoke.mjs", chain.includes("bun .qa/ui-ux-smoke.mjs"));
  check(
    "test:smoke still runs wave2..wave6 smokes",
    ["wave2", "wave3", "wave4", "wave5", "wave6"].every((w) => chain.includes(w)),
  );
}

/* ================================================================== *
 * 10. Scheme module + gesture exclusion + hint copy (static)          *
 * ================================================================== */
console.log("[10] scheme.js / data-input-exclude / hint copy (static)");
const mainSrc = readFileSync(join(CLIENT, "js/src/main.js"), "utf8");
const inputSrc = readFileSync(join(CLIENT, "js/src/core/input.js"), "utf8");
const swSrc = readFileSync(join(CLIENT, "sw.js"), "utf8");
let schemeSrc = "";
try {
  schemeSrc = readFileSync(join(CLIENT, "js/src/core/scheme.js"), "utf8");
} catch {
  schemeSrc = "";
}
{
  check("core/scheme.js exists and is non-empty", schemeSrc.length > 0);
  check(
    "scheme.js exports detectScheme + latchTouch",
    /export function detectScheme/.test(schemeSrc) && /export function latchTouch/.test(schemeSrc),
  );
  check("scheme.js boots off the (pointer: coarse) media query", schemeSrc.includes("(pointer: coarse)"));
  check("scheme.js publishes <html data-scheme>", schemeSrc.includes("dataset.scheme"));
  check("sw.js precaches /js/src/core/scheme.js", swSrc.includes('"./js/src/core/scheme.js"'));
  check("main.js runs detectScheme() at boot", /detectScheme\(\)/.test(mainSrc));

  const muteTag = html.match(/<button id="mute-btn"[^>]*>/);
  check(
    "#mute-btn carries data-input-exclude (all HUD controls must)",
    !!muteTag && muteTag[0].includes("data-input-exclude"),
    muteTag ? muteTag[0] : "no #mute-btn tag",
  );
  check(
    "InputManager drops gestures born on [data-input-exclude]",
    inputSrc.includes("data-input-exclude") && /\.closest\(\s*["'`]?\[data-input-exclude\]/.test(inputSrc),
  );
  check(
    "exclusion guards null targets + missing Element.closest",
    /typeof target\.closest !== "function"|!target \|\|/.test(inputSrc),
  );

  check("index.html has #results-hint", /id="results-hint"/.test(html));
  check("css styles .results-hint like the existing hint lines", /\.results-hint\s*\{/.test(css));
  check("keys mode hides .swipe-arrows glyphs", /html\[data-scheme="keys"\]\s+\.swipe-arrows/.test(css));
}

/** Extract a top-level `function NAME(...) { ... }` body from JS source. */
function fnBody(src, name) {
  const i = src.indexOf(`function ${name}`);
  if (i === -1) return null;
  const open = src.indexOf("{", i);
  let depth = 0;
  let j = open;
  for (; j < src.length; j++) {
    if (src[j] === "{") depth++;
    else if (src[j] === "}") {
      depth--;
      if (depth === 0) break;
    }
  }
  return src.slice(open, j + 1);
}

/* ================================================================== *
 * 11. scheme.js logic probes (sandbox: stubbed window/document)       *
 * ================================================================== */
console.log("[11] scheme.js logic probes (sandboxed)");
{
  // Deterministic event-target stub with listener bookkeeping.
  function stubWindow({ coarse = null } = {}) {
    const listeners = {};
    const w = {
      innerHeight: 400,
      addEventListener: (type, fn) => {
        (listeners[type] = listeners[type] || []).push(fn);
      },
      removeEventListener: (type, fn) => {
        const arr = listeners[type] || [];
        const i = arr.indexOf(fn);
        if (i >= 0) arr.splice(i, 1);
      },
    };
    if (coarse !== null) w.matchMedia = (q) => ({ matches: coarse, media: q });
    w._listeners = listeners;
    w.dispatch = (type, ev) => {
      for (const fn of [...(listeners[type] || [])]) fn(ev);
    };
    return w;
  }
  const stubDocument = () => ({ documentElement: { dataset: {} } });
  const schemeUrl = join(CLIENT, "js/src/core/scheme.js");
  let caseN = 0;
  const freshScheme = async () => import(`${schemeUrl}?case=${++caseN}`); // fresh module state

  // 11a. coarse pointer -> touch
  {
    const w = stubWindow({ coarse: true });
    const d = stubDocument();
    globalThis.window = w;
    globalThis.document = d;
    const mod = await freshScheme();
    const s = mod.detectScheme();
    check("matchMedia coarse -> detectScheme 'touch'", s === "touch");
    check("coarse boot publishes data-scheme='touch'", d.documentElement.dataset.scheme === "touch");
  }

  // 11b. fine pointer -> keys
  {
    const w = stubWindow({ coarse: false });
    const d = stubDocument();
    globalThis.window = w;
    globalThis.document = d;
    const mod = await freshScheme();
    const s = mod.detectScheme();
    check("matchMedia fine -> detectScheme 'keys'", s === "keys");
    check("fine boot publishes data-scheme='keys'", d.documentElement.dataset.scheme === "keys");
  }

  // 11c. missing matchMedia -> keys (safe default)
  {
    globalThis.window = stubWindow({}); // no matchMedia at all
    globalThis.document = stubDocument();
    const mod = await freshScheme();
    check("missing matchMedia -> 'keys' (safe default)", mod.detectScheme() === "keys");
  }

  // 11d. throwing matchMedia -> keys (never crashes boot)
  {
    const w = stubWindow({});
    w.matchMedia = () => {
      throw new Error("sandbox says no");
    };
    globalThis.window = w;
    globalThis.document = stubDocument();
    const mod = await freshScheme();
    let s = null;
    let threw = false;
    try {
      s = mod.detectScheme();
    } catch {
      threw = true;
    }
    check("throwing matchMedia -> 'keys', no throw", !threw && s === "keys");
  }

  // 11e. one-shot touch latch: keys -> touch, sticks, no double-fire
  {
    const w = stubWindow({ coarse: false }); // desktop misjudged a hybrid
    const d = stubDocument();
    globalThis.window = w;
    globalThis.document = d;
    const mod = await freshScheme();
    check("latch scenario boots as keys", mod.detectScheme() === "keys");

    let latches = 0;
    mod.latchTouch(() => {
      latches += 1;
    });
    mod.latchTouch(); // idempotent install — must NOT add a second listener
    check("latchTouch is idempotent (exactly one listener)", w._listeners.touchstart.length === 1);

    w.dispatch("touchstart", {});
    check("first touchstart flips scheme to touch", mod.currentScheme() === "touch");
    check("latch publishes data-scheme='touch'", d.documentElement.dataset.scheme === "touch");
    check("latch callback fired exactly once", latches === 1);
    check("one-shot listener removed after firing", w._listeners.touchstart.length === 0);

    w.dispatch("touchstart", {});
    check("second touchstart does not re-fire the latch", latches === 1);
    check("re-detection keeps the latched touch scheme", mod.detectScheme() === "touch");
  }
}

/* ================================================================== *
 * 12. InputManager gesture-exclusion probe (sandboxed)                *
 * ================================================================== */
console.log("[12] InputManager data-input-exclude probe (sandboxed)");
{
  const w = stubWindowForInput();
  globalThis.window = w;
  globalThis.document = { documentElement: { dataset: {} } };
  const { InputManager } = await import(join(CLIENT, "js/src/core/input.js") + "?probe=1");

  const actions = [];
  const input = new InputManager((a) => actions.push(a));

  // Fake element chain: excluded resolves the selector, plain does not.
  const excluded = { closest: (sel) => (sel === "[data-input-exclude]" ? excluded : null) };
  const plain = { closest: () => null };
  const touchEv = (target, x, y) => ({ target, touches: [{ clientX: x, clientY: y }] });
  const endEv = (target, y) => ({ target, touches: [], changedTouches: [{ clientY: y }] });

  // Excluded gesture, full swipe-right shape: must be dropped whole.
  w.dispatch("touchstart", touchEv(excluded, 100, 100));
  w.dispatch("touchmove", touchEv(excluded, 180, 100));
  w.dispatch("touchend", endEv(excluded, 100));
  check("swipe on data-input-exclude control fires NO gameplay action", actions.length === 0);

  // Plain swipe right still steers.
  w.dispatch("touchstart", touchEv(plain, 100, 100));
  w.dispatch("touchmove", touchEv(plain, 180, 100)); // dx=80 >= 24 -> right
  check("plain-element swipe still fires 'right'", actions.join() === "right");

  // Plain tap in the top half still jumps.
  w.dispatch("touchstart", touchEv(plain, 100, 100));
  w.dispatch("touchend", endEv(plain, 90)); // y=90 < innerHeight/2 -> jump
  check("plain-element tap (top half) still fires 'jump'", actions.join() === "right,jump");

  // Excluded TAP (no movement, bottom half): must not roll.
  w.dispatch("touchstart", touchEv(excluded, 100, 300));
  w.dispatch("touchend", endEv(excluded, 300)); // would be "roll" if not excluded
  check("tap on data-input-exclude control fires no roll/jump", actions.join() === "right,jump");

  // Null target: no crash, gameplay input intact (dy=-60 -> jump).
  w.dispatch("touchstart", { target: null, touches: [{ clientX: 100, clientY: 100 }] });
  w.dispatch("touchmove", { target: null, touches: [{ clientX: 100, clientY: 40 }] });
  check("null-target gesture handled safely and still fires 'jump'", actions.join() === "right,jump,jump");

  input.dispose();
}

/** Window stub for the input probe (listeners + touch geometry only). */
function stubWindowForInput() {
  const listeners = {};
  return {
    innerHeight: 400,
    addEventListener: (type, fn) => {
      (listeners[type] = listeners[type] || []).push(fn);
    },
    removeEventListener: (type, fn) => {
      const arr = listeners[type] || [];
      const i = arr.indexOf(fn);
      if (i >= 0) arr.splice(i, 1);
    },
    dispatch: (type, ev) => {
      for (const fn of [...(listeners[type] || [])]) fn(ev);
    },
  };
}

/* ================================================================== *
 * 13. applyHints probe — the REAL HINT_COPY literal, both schemes     *
 * ================================================================== */
console.log("[13] applyHints copy-map probe");
{
  const KEY_RE = /\b(ARROWS?|WASD|SPACE|ESC|ENTER|[PM])\b/; // key names
  const TOUCH_RE = /\b(SWIPE|TAPS?)\b/; // touch verbs

  const mapMatch = mainSrc.match(/const HINT_COPY = \{[\s\S]*?\n\s*\};/);
  check("main.js declares a HINT_COPY map literal", !!mapMatch);
  const HINT_COPY = mapMatch ? new Function(`"use strict"; ${mapMatch[0]}; return HINT_COPY;`)() : {};

  for (const slot of ["menu", "pause", "results"]) {
    const hit = HINT_COPY[slot];
    check(
      `slot '${slot}' has BOTH schemes' strings (non-empty)`,
      !!hit && typeof hit.touch === "string" && hit.touch.length > 0 && typeof hit.keys === "string" && hit.keys.length > 0,
    );
    check(`slot '${slot}' touch line contains no key names`, !!hit && !KEY_RE.test(hit.touch), hit && hit.touch);
    check(`slot '${slot}' keys line contains no swipe/tap words`, !!hit && !TOUCH_RE.test(hit.keys), hit && hit.keys);
  }

  // Mirror main.js applyHints(): fill the three elements from the map for
  // the given scheme, then assert what the player would actually read.
  const applyHintsProbe = (scheme, elsRef) => {
    elsRef.swipeText.textContent = HINT_COPY.menu[scheme];
    elsRef.pauseHint.textContent = HINT_COPY.pause[scheme];
    elsRef.resultsHint.textContent = HINT_COPY.results[scheme];
  };
  const hintEls = {
    swipeText: { textContent: "" },
    pauseHint: { textContent: "" },
    resultsHint: { textContent: "" },
  };

  applyHintsProbe("touch", hintEls);
  check(
    "touch scheme: menu hint is swipe copy with zero key names",
    TOUCH_RE.test(hintEls.swipeText.textContent) && !KEY_RE.test(hintEls.swipeText.textContent),
    hintEls.swipeText.textContent,
  );
  check(
    "touch scheme: pause + results hints are tap copy with zero key names",
    !KEY_RE.test(hintEls.pauseHint.textContent) &&
      !KEY_RE.test(hintEls.resultsHint.textContent) &&
      TOUCH_RE.test(hintEls.pauseHint.textContent) &&
      TOUCH_RE.test(hintEls.resultsHint.textContent),
    `${hintEls.pauseHint.textContent} | ${hintEls.resultsHint.textContent}`,
  );

  applyHintsProbe("keys", hintEls);
  check(
    "keys scheme: menu hint names keys with zero swipe/tap words",
    KEY_RE.test(hintEls.swipeText.textContent) && !TOUCH_RE.test(hintEls.swipeText.textContent),
    hintEls.swipeText.textContent,
  );
  check(
    "keys scheme: pause + results hints name keys, zero swipe/tap words",
    !TOUCH_RE.test(hintEls.pauseHint.textContent) &&
      !TOUCH_RE.test(hintEls.resultsHint.textContent) &&
      KEY_RE.test(hintEls.pauseHint.textContent) &&
      KEY_RE.test(hintEls.resultsHint.textContent),
    `${hintEls.pauseHint.textContent} | ${hintEls.resultsHint.textContent}`,
  );

  // Wiring: applyHints reads the live scheme and fills all three slots;
  // every screen that shows hints re-runs it; latch re-runs it too.
  const ah = fnBody(mainSrc, "applyHints") || "";
  check(
    "applyHints fills all three slots from HINT_COPY via currentScheme()",
    /currentScheme\(\)/.test(ah) && /HINT_COPY\.menu\[/.test(ah) && /HINT_COPY\.pause\[/.test(ah) && /HINT_COPY\.results\[/.test(ah),
  );
  check("showMenu() re-applies hints", ((fnBody(mainSrc, "showMenu") || "").includes("applyHints()")));
  check("showGameOver() re-applies hints", ((fnBody(mainSrc, "showGameOver") || "").includes("applyHints()")));
  check("setPaused(true) re-applies hints (pause overlay wording)", ((fnBody(mainSrc, "setPaused") || "").includes("applyHints()")));
  check(
    "boot applies hints after scheme init and latchTouch re-applies on flip",
    /applyHints\(\); \/\/ reflect the detected scheme on boot/.test(mainSrc) &&
      /latchTouch\(\s*\(\)\s*=>\s*applyHints\(\)\s*\)/.test(mainSrc),
  );
  check(
    "GAMEOVER-only Enter/Escape listener wired (keys wording is true)",
    /state !== State\.GAMEOVER/.test(mainSrc) && /code === "Enter" \|\| e\.code === "NumpadEnter"/.test(mainSrc) && /e\.code === "Escape"/.test(mainSrc),
  );
  check(
    "GAMEOVER listener ignores form-field targets",
    /INPUT" \|\| tag === "TEXTAREA" \|\| tag === "SELECT"/.test(mainSrc),
  );
}

/* ================================================================== *
 * 14. Tasks 3.1/3.2 static: HUD pause button + three-action panel    *
 * ================================================================== */
console.log("[14] HUD pause button + pause panel (static)");
{
  // --- #pause-btn markup --------------------------------------------
  const p0 = html.indexOf('<button id="pause-btn"');
  const p1 = html.indexOf("</button>", p0);
  const pauseBtnEl = p0 !== -1 ? html.slice(p0, p1) : "";
  const pauseTag = pauseBtnEl.match(/^<button id="pause-btn"[^>]*>/);
  check(
    "#pause-btn exists with data-input-exclude",
    !!pauseTag && pauseTag[0].includes("data-input-exclude"),
    pauseTag ? pauseTag[0] : "no #pause-btn tag",
  );
  check('#pause-btn has aria-label="Pause run"', !!pauseTag && /aria-label="Pause run"/.test(pauseTag[0]));
  check(
    "#pause-btn carries an inline SVG glyph (zero external assets)",
    pauseBtnEl.includes("<svg") && pauseBtnEl.includes("</svg>") && !/https?:\/\//.test(pauseBtnEl),
  );
  check(
    "#pause-btn glyph = the same two rounded bars as the overlay icon",
    pauseBtnEl.includes('x="7" y="5" width="3.6" height="14" rx="1.4"') &&
      pauseBtnEl.includes('x="13.4" y="5" width="3.6" height="14" rx="1.4"'),
  );

  // --- #pause-btn CSS: bottom-left mirror of mute --------------------
  const pauseBtnCss = bodyOf(/^#pause-btn$/);
  check(
    "#pause-btn sits bottom-LEFT with safe-area max() offsets (mirrors mute's right:)",
    !!pauseBtnCss &&
      /left:\s*max\(\s*18px,\s*env\(safe-area-inset-left/.test(pauseBtnCss) &&
      /bottom:\s*max\(\s*18px,\s*env\(safe-area-inset-bottom/.test(pauseBtnCss),
  );
  check(
    "#pause-btn is a 44x44 target",
    pxVal(pauseBtnCss, "width") >= 44 && pxVal(pauseBtnCss, "height") >= 44,
    `w=${pxVal(pauseBtnCss, "width")} h=${pxVal(pauseBtnCss, "height")}`,
  );
  const muteCss = bodyOf(/^#mute-btn$/);
  check(
    "#mute-btn stays bottom-RIGHT (regression guard)",
    !!muteCss && /right:\s*max\(\s*18px,\s*env\(safe-area-inset-right/.test(muteCss),
  );

  // --- pause panel: RESUME -> RESTART -> MENU in DOM order -----------
  const ov0 = html.indexOf('id="pause-overlay"');
  const ov1 = html.indexOf("<!-- Loading Screen", ov0);
  const pauseRegion = ov0 !== -1 && ov1 > ov0 ? html.slice(ov0, ov1) : "";
  check("pause region isolated from index.html", pauseRegion.includes("pause-panel"));
  const iResume = pauseRegion.indexOf('id="resume-btn"');
  const iRestart = pauseRegion.indexOf('id="pause-restart-btn"');
  const iMenu = pauseRegion.indexOf('id="pause-menu-btn"');
  check(
    "pause panel hosts RESUME -> RESTART -> MENU in DOM order (keyboard-focus order)",
    iResume !== -1 && iResume < iRestart && iRestart < iMenu,
    `offsets ${iResume}/${iRestart}/${iMenu}`,
  );
  check(
    "RESTART + MENU are .btn.btn-secondary (the 44px .btn floor from task 1.3)",
    /<button id="pause-restart-btn" class="btn btn-secondary"/.test(pauseRegion) &&
      /<button id="pause-menu-btn" class="btn btn-secondary"/.test(pauseRegion),
  );
  check("RESUME is still the primary action (.btn.btn-primary)", /<button id="resume-btn" class="btn btn-primary"/.test(pauseRegion));
  check(
    ".pause-hint stays above the action row",
    pauseRegion.indexOf("pause-hint") !== -1 && pauseRegion.indexOf("pause-hint") < iResume,
  );
  check(
    ".pause-actions stacks the three targets full-width",
    /\.pause-actions\s*\{[^}]*flex-direction:\s*column/.test(cssNC) && /\.pause-actions \.btn\s*\{[^}]*width:\s*100%/.test(cssNC),
  );

  // --- main.js wiring -------------------------------------------------
  check(
    "els cache includes pauseBtn + pauseRestartBtn + pauseMenuBtn",
    /pauseBtn: document\.getElementById\("pause-btn"\)/.test(mainSrc) &&
      /pauseRestartBtn: document\.getElementById\("pause-restart-btn"\)/.test(mainSrc) &&
      /pauseMenuBtn: document\.getElementById\("pause-menu-btn"\)/.test(mainSrc),
  );
  check(
    "#pause-btn fires on pointerdown (D2 rationale), never on click",
    /els\.pauseBtn\.addEventListener\("pointerdown"/.test(mainSrc) &&
      !/els\.pauseBtn\.addEventListener\("click"/.test(mainSrc),
  );

  const pdArrow = mainSrc.match(/els\.pauseBtn\.addEventListener\("pointerdown",\s*(\(e\) => \{[\s\S]*?\})\);/);
  check("pointerdown handler source found", !!pdArrow);
  const pdSrc = pdArrow ? pdArrow[1] : "";
  check(
    "pause handler preventDefaults + guards (PLAYING && !paused)",
    /e\.preventDefault\(\)/.test(pdSrc) && /state === State\.PLAYING && !paused/.test(pdSrc) && /setPaused\(true\)/.test(pdSrc),
  );

  const restartArrow = mainSrc.match(/els\.pauseRestartBtn\.addEventListener\("click",\s*(\(\) => \{[\s\S]*?\})\);/);
  check("RESTART handler source found", !!restartArrow);
  const restartSrc = restartArrow ? restartArrow[1] : "";
  check(
    "RESTART handler: setPaused(false) first, then startRun()",
    /setPaused\(false\)/.test(restartSrc) && /startRun\(\)/.test(restartSrc),
  );
  const menuArrow = mainSrc.match(/els\.pauseMenuBtn\.addEventListener\("click",\s*(\(\) => \{[\s\S]*?\})\);/);
  check("MENU handler source found", !!menuArrow);
  const menuSrc = menuArrow ? menuArrow[1] : "";
  check(
    "MENU handler: setPaused(false) first, then showMenu()",
    /setPaused\(false\)/.test(menuSrc) && /showMenu\(\)/.test(menuSrc),
  );
  check(
    "no localStorage writes in any new pause-handler body",
    !/lsSet/.test(pdSrc) && !/lsSet/.test(restartSrc) && !/lsSet/.test(menuSrc),
  );
}

/* ================================================================== *
 * 15. Tasks 3.1/3.2 logic probes (sandboxed, REAL handler sources)   *
 * ================================================================== */
console.log("[15] pause flow logic probes (sandboxed)");
{
  // Mutable shell state read by the extracted main.js sources through
  // global getters (Function bodies resolve free identifiers globally).
  const shell = { state: "playing", paused: false, overlayHidden: true };
  const setPausedCalls = [];
  const setPausedStub = (p) => {
    setPausedCalls.push(p);
    shell.paused = p;
    // mirror the real setPaused(): overlay visible iff paused && PLAYING
    shell.overlayHidden = !(p && shell.state === "playing");
  };
  globalThis.State = { LOADING: "loading", MENU: "menu", PLAYING: "playing", GAMEOVER: "gameover" };
  Object.defineProperty(globalThis, "state", { get: () => shell.state, configurable: true });
  Object.defineProperty(globalThis, "paused", { get: () => shell.paused, configurable: true });

  // --- 15a. HUD pause button (pointerdown) ---------------------------
  const pdArrow = mainSrc.match(/els\.pauseBtn\.addEventListener\("pointerdown",\s*(\(e\) => \{[\s\S]*?\})\);/);
  if (pdArrow) {
    const handler = new Function("State", "setPaused", `return (${pdArrow[1]});`)(globalThis.State, setPausedStub);
    let prevented = 0;
    const ev = () => ({ preventDefault: () => (prevented += 1) });

    shell.state = "playing";
    shell.paused = false;
    setPausedCalls.length = 0;
    handler(ev());
    check("pointerdown during PLAYING -> setPaused(true), paused flag true", setPausedCalls.join() === "true" && shell.paused === true);
    check("pause overlay becomes visible (hidden = false)", shell.overlayHidden === false);
    check("handler called e.preventDefault() (no synthetic click)", prevented === 1);

    handler(ev());
    check("second pointerdown while paused does NOT double-toggle", setPausedCalls.length === 1 && shell.paused === true);

    shell.state = "menu";
    shell.paused = false;
    setPausedCalls.length = 0;
    handler(ev());
    check("pointerdown outside PLAYING does nothing", setPausedCalls.length === 0 && shell.paused === false);
  }

  // --- 15b. keyboard pause: REAL InputManager + REAL action callback -
  globalThis.window = stubWindowForInput();
  globalThis.document = { documentElement: { dataset: {} } };
  const { InputManager } = await import(join(CLIENT, "js/src/core/input.js") + "?pauseprobe=1");
  const cbMatch = mainSrc.match(/new InputManager\(\s*(\(action\) => \{[\s\S]*?\})\s*\);/);
  check("InputManager action callback extracted from main.js", !!cbMatch);
  if (cbMatch) {
    const buffered = [];
    const runStub = { bufferAction: (a) => buffered.push(a) };
    const onAction = new Function("State", "setPaused", "run", "graceT", "skipGrace", `return (${cbMatch[1]});`)(
      globalThis.State,
      setPausedStub,
      runStub,
      0, // no grace running in this scenario
      () => {},
    );
    const im = new InputManager(onAction);
    const w = globalThis.window;
    const key = (code) => w.dispatch("keydown", { code, target: null, repeat: false, preventDefault: () => {} });

    shell.state = "playing";
    shell.paused = false;
    setPausedCalls.length = 0;
    key("Escape");
    check("Esc during PLAYING still pauses via the action callback", setPausedCalls.join() === "true" && shell.paused === true);
    key("KeyP");
    check("P while paused still resumes (keyboard toggle unchanged)", setPausedCalls.join() === "true,false" && shell.paused === false);

    key("Escape"); // paused again
    key("ArrowUp"); // would jump if the gate leaked
    check("gameplay key while paused is not buffered", buffered.length === 0 && shell.paused === true);
    setPausedStub(false); // resume (instant, pre-3.3 behavior)
    key("ArrowUp");
    check("gameplay key after resume buffers again", buffered.join() === "jump");
    im.dispose();

    // 3.3: while the grace countdown runs, the pause action (Esc/P — the
    // keys-scheme resume action) SKIPS the wait instead of re-toggling.
    let skips = 0;
    const onGraceAction = new Function("State", "setPaused", "run", "graceT", "skipGrace", `return (${cbMatch[1]});`)(
      globalThis.State,
      setPausedStub,
      runStub,
      1.2, // grace active
      () => (skips += 1),
    );
    const imGrace = new InputManager(onGraceAction);
    shell.state = "playing";
    shell.paused = false;
    setPausedCalls.length = 0;
    key("Escape");
    check(
      "Esc during the grace countdown skips it (no pause toggle, stays unpaused)",
      skips === 1 && setPausedCalls.length === 0 && shell.paused === false,
    );
    imGrace.dispose();
  }

  // --- 15c/15d. restart + menu handlers ------------------------------
  const restartArrow = mainSrc.match(/els\.pauseRestartBtn\.addEventListener\("click",\s*(\(\) => \{[\s\S]*?\})\);/);
  if (restartArrow) {
    let startRuns = 0;
    let tutoredMarks = 0;
    const startRunStub = () => (startRuns += 1);
    const restartFn = new Function("State", "setPaused", "startRun", "markTutored", `return (${restartArrow[1]});`)(
      globalThis.State,
      setPausedStub,
      startRunStub,
      () => (tutoredMarks += 1), // D8: restart ends a coached run
    );
    shell.state = "playing";
    shell.paused = true;
    shell.overlayHidden = false;
    setPausedCalls.length = 0;
    restartFn();
    check("restart from pause unpauses FIRST (setPaused(false))", setPausedCalls[0] === false);
    check("restart hides the pause overlay (no remnant over the new run)", shell.overlayHidden === true && shell.paused === false);
    check("restart invokes startRun exactly once", startRuns === 1);
    check("restart marks the tutored flag exactly once (D8 end-by-any-path)", tutoredMarks === 1);
  }

  const menuArrow = mainSrc.match(/els\.pauseMenuBtn\.addEventListener\("click",\s*(\(\) => \{[\s\S]*?\})\);/);
  if (menuArrow) {
    let showMenus = 0;
    let tutoredMarks = 0;
    const menuFn = new Function("State", "setPaused", "showMenu", "markTutored", `return (${menuArrow[1]});`)(
      globalThis.State,
      setPausedStub,
      () => (showMenus += 1),
      () => (tutoredMarks += 1), // D8: quit-from-pause ends a coached run
    );
    shell.state = "playing";
    shell.paused = true;
    shell.overlayHidden = false;
    setPausedCalls.length = 0;
    menuFn();
    check("menu-from-pause unpauses and reaches showMenu exactly once", setPausedCalls[0] === false && showMenus === 1 && shell.paused === false);
    check("overlay hidden after quit (showMenu path also unpauses)", shell.overlayHidden === true);
    check("quit-from-pause marks the tutored flag exactly once (D8)", tutoredMarks === 1);
  }

  // --- 15e. no double-banking on the restart/quit paths ---------------
  const startRunBody = fnBody(mainSrc, "startRun") || "";
  const showMenuBody = fnBody(mainSrc, "showMenu") || "";
  check(
    "startRun persists only the username — no coins/games/best banking",
    /lsSet\(LS_KEYS\.username/.test(startRunBody) &&
      !/totalCoins|LS_KEYS\.games|LS_KEYS\.highScore|LS_KEYS\.lastRun/.test(startRunBody),
  );
  check("showMenu writes nothing to localStorage", !/lsSet/.test(showMenuBody));
  check("showMenu itself unpauses (existing guarantee kept)", /setPaused\(false\)/.test(showMenuBody));
  check("banking lives only in showGameOver()", (fnBody(mainSrc, "showGameOver") || "").includes("lsSet(LS_KEYS.totalCoins"));
}

/* ================================================================== *
 * 16. Task 3.3 static: #resume-grace overlay + grace gating          *
 * ================================================================== */
console.log("[16] safe-resume grace (static)");
{
  // --- index.html markup ----------------------------------------------
  const g0 = html.indexOf('id="resume-grace"');
  const g1 = html.indexOf("<!-- Loading Screen", g0);
  const graceRegion = g0 !== -1 && g1 > g0 ? html.slice(g0, g1) : "";
  check("#resume-grace element exists in index.html", g0 !== -1);
  check(
    "#resume-grace boots hidden (never over frozen captures by accident)",
    /<div id="resume-grace" class="hidden" data-input-exclude/.test(html),
  );
  check(
    "#resume-grace carries data-input-exclude (skip tap is not gameplay input)",
    /<div id="resume-grace"[^>]*data-input-exclude/.test(html),
  );
  check("grace region hosts a numeral child (#grace-numeral)", graceRegion.includes('id="grace-numeral"'));
  check(
    "grace region hosts the scaleX bar (#grace-bar inside .grace-track)",
    graceRegion.includes("grace-track") && graceRegion.includes('id="grace-bar"'),
  );
  check("?hud=0 hides the grace overlay too (qa/hooks.js DOM-UI list)", readFileSync(join(CLIENT, "js/src/qa/hooks.js"), "utf8").includes('"resume-grace"'));

  // --- style.css: full-screen pointer target + JS-driven bar ----------
  const graceCss = bodyOf(/^#resume-grace$/);
  check(
    "#resume-grace is a full-screen fixed overlay",
    !!graceCss && /position:\s*fixed/.test(graceCss) && /inset:\s*0/.test(graceCss),
  );
  check(
    "#resume-grace accepts pointer events (tap anywhere to skip)",
    !!graceCss && /pointer-events:\s*auto/.test(graceCss),
  );
  check(
    "#resume-grace dim stays within the QA overlay cap (<=0.45)",
    !!graceCss && !/rgba\(15,\s*20,\s*35,\s*0\.[5-9]/.test(graceCss),
  );
  const barCss = bodyOf(/^#grace-bar$/);
  check(
    "#grace-bar is a transform-only scaleX bar with a left origin",
    !!barCss && /transform:\s*scaleX\(1\)/.test(barCss) && /transform-origin:\s*left/.test(barCss),
  );
  check(
    "no CSS keyframes/animation drive the grace (countdown is JS per-frame)",
    !/@keyframes[^{]*grace/i.test(cssNC) && !(barCss || "").includes("animation"),
  );

  // --- main.js: constant, timer, HUD write path -----------------------
  check("main.js declares the 1.2 s grace constant", /const GRACE_SECONDS = 1\.2;/.test(mainSrc));
  check("main.js keeps a boot-scope graceT timer", /let graceT = 0;/.test(mainSrc));
  const armBody = fnBody(mainSrc, "armGrace") || "";
  const clearBody = fnBody(mainSrc, "clearGrace") || "";
  check(
    "armGrace arms GRACE_SECONDS + shows the overlay",
    /graceT = GRACE_SECONDS/.test(armBody) &&
      armBody.includes("resumeGrace") &&
      armBody.includes('classList.remove("hidden")'),
  );
  check(
    "armGrace hard-disables under ?freeze/?qa (deterministic captures never count down)",
    /qa\.freeze \|\| qa\.qa/.test(armBody),
  );
  check(
    "clearGrace zeroes graceT + hides the overlay (the one hide helper)",
    /graceT = 0;/.test(clearBody) && clearBody.includes("resumeGrace") && clearBody.includes('classList.add("hidden")'),
  );
  check("skipGrace ends the countdown through clearGrace", (fnBody(mainSrc, "skipGrace") || "").includes("clearGrace()"));
  check("grace HUD writes the numeral textContent (JS-driven countdown)", /graceNumeral\.textContent/.test(mainSrc));
  check("grace bar is driven by JS transform writes, not CSS animation", /graceBar\.style\.transform = "scaleX\(/.test(mainSrc));
  const graceHudBody = fnBody(mainSrc, "updateGraceHud") || "";
  check(
    "grace HUD writes are cached/quantized (no per-frame allocation churn)",
    /lastGraceNumeral/.test(graceHudBody) && /lastGraceBar/.test(graceHudBody),
  );

  // --- main.js: pure arming/gating rules + frame-loop integration -----
  const armRule = fnBody(mainSrc, "graceNeedsArm") || "";
  check(
    "arming requires a PLAYING run that was actually paused",
    armRule.includes("State.PLAYING") && armRule.includes("wasPaused === true"),
  );
  check("arming rule carries the ?freeze/?qa guards", armRule.includes("isFrozen") && armRule.includes("isQa"));
  const gateFn = fnBody(mainSrc, "simCanStep") || "";
  check(
    "simCanStep is the pure 3-input gate (PLAYING && !paused && grace elapsed)",
    gateFn.includes("State.PLAYING") && gateFn.includes("!isPaused") && gateFn.includes("graceRemaining <= 0"),
  );
  check(
    "frame() gates the sim branch through simCanStep(state, paused, graceT)",
    /simCanStep\(state, paused, graceT\)/.test(mainSrc),
  );
  check("grace decrements by real dt and clamps at 0", /graceT = Math\.max\(0, graceT - dt\)/.test(mainSrc));

  // --- main.js: setPaused routing + stale-countdown guards ------------
  const spBody = fnBody(mainSrc, "setPaused") || "";
  check(
    "setPaused arms grace only through graceNeedsArm(state, wasPaused, ...)",
    spBody.includes("graceNeedsArm(state, wasPaused"),
  );
  check("pausing cancels any live countdown", /if \(p\) \{\s*clearGrace\(\)/.test(spBody));
  check("startRun clears the grace (restart-from-pause)", (fnBody(mainSrc, "startRun") || "").includes("clearGrace()"));
  check("showMenu clears the grace (quit-from-pause)", (fnBody(mainSrc, "showMenu") || "").includes("clearGrace()"));
  const visM = mainSrc.match(/document\.addEventListener\("visibilitychange",\s*\(\) => \{[\s\S]*?\n\s*\}\);/);
  check(
    "visibilitychange return routes through setPaused(false) only (no duplicated grace logic)",
    !!visM && visM[0].includes("setPaused(false)") && !/graceT|armGrace|clearGrace/.test(visM[0]),
  );
  check(
    "Esc/P during grace skips (pause action checked before the toggle)",
    /if \(action === "pause"\) \{\s*if \(graceT > 0\) \{[\s\S]*?skipGrace\(\)/.test(mainSrc),
  );
  check(
    "pointerdown on #resume-grace skips the countdown",
    /els\.resumeGrace\.addEventListener\("pointerdown"/.test(mainSrc) && /if \(graceT > 0\) skipGrace\(\)/.test(mainSrc),
  );
  check(
    "the grace overlay is managed outside #hud toggling (setState never touches it)",
    !/resumeGrace|graceT/.test(fnBody(mainSrc, "setState") || ""),
  );
}

/* ================================================================== *
 * 17. Task 3.4 static: .screen-enter transition polish               *
 * ================================================================== */
console.log("[17] .screen-enter transition polish (static)");
{
  const seRule = bodyOf(/^\.screen-enter$/);
  check(".screen-enter rule exists", !!seRule);
  check(
    ".screen-enter runs on the motion tokens (var(--dur-2), var(--ease-out))",
    !!seRule && seRule.includes("var(--dur-2)") && seRule.includes("var(--ease-out)"),
  );
  check(".screen-enter rule carries no !important (kill-switches outrank it)", !!seRule && !seRule.includes("!important"));
  const kfM = cssNC.match(/@keyframes screen-enter\s*\{[\s\S]*?\n\}/);
  check("@keyframes screen-enter exists", !!kfM);
  const kfBody = kfM ? kfM[0] : "";
  check(
    "screen-enter keyframes animate transform + opacity ONLY",
    !!kfM && kfBody.includes("transform") && kfBody.includes("opacity") && !/\b(width|height|top|left|margin|padding)\s*:/.test(kfBody),
  );
  check(
    "keyframes start FROM the offset and end AT identity (settled when animations are killed)",
    /from\s*\{[^}]*opacity:\s*0/.test(kfBody) && /to\s*\{[^}]*opacity:\s*1/.test(kfBody),
  );

  // main.js applies the class to the three screen roots on every show.
  check(
    "els caches menuContainer / resultsPanel / pausePanel",
    /menuContainer: document\.querySelector\("\.menu-container"\)/.test(mainSrc) &&
      /resultsPanel: document\.querySelector\("\.results-panel"\)/.test(mainSrc) &&
      /pausePanel: document\.querySelector\("\.pause-panel"\)/.test(mainSrc),
  );
  const enterFn = fnBody(mainSrc, "playScreenEnter") || "";
  check(
    "playScreenEnter re-triggers via remove -> reflow -> add (popBadge trick)",
    enterFn.includes('classList.remove("screen-enter")') && enterFn.includes("offsetWidth") && enterFn.includes('classList.add("screen-enter")'),
  );
  const setStateBody = fnBody(mainSrc, "setState") || "";
  check(
    "setState plays screen-enter for menu + results",
    setStateBody.includes("playScreenEnter(els.menuContainer)") && setStateBody.includes("playScreenEnter(els.resultsPanel)"),
  );
  check(
    "setPaused plays screen-enter for the pause panel when it shows",
    (fnBody(mainSrc, "setPaused") || "").includes("playScreenEnter(els.pausePanel)"),
  );
  check("#hud is NOT a screen-enter target (no chip animation)", !/playScreenEnter\(els\.hud\)/.test(mainSrc));
  check("#loading-screen is NOT a screen-enter target (it has its own fade)", !/playScreenEnter\(els\.loading\)/.test(mainSrc));

  // The shared class is the single source of entrance motion.
  const menuCss = bodyOf(/^\.menu-container$/);
  const pausePanelCss = bodyOf(/^\.pause-panel$/);
  const resultsPanelCss = bodyOf(/^\.results-panel$/);
  check(".menu-container no longer carries its own entrance animation", !!menuCss && !/animation\s*:/.test(menuCss));
  check(".pause-panel no longer carries its own entrance animation", !!pausePanelCss && !/animation\s*:/.test(pausePanelCss));
  check(".results-panel carries no base entrance animation", !!resultsPanelCss && !/animation\s*:/.test(resultsPanelCss));
  check(
    "old menu-in / results-in / pause-in keyframes removed",
    !/@keyframes menu-in/.test(cssNC) && !/@keyframes results-in/.test(cssNC) && !/@keyframes pause-in/.test(cssNC),
  );
}

/* ================================================================== *
 * 18. Task 3.3 logic probes (sandboxed, REAL extracted sources)      *
 * ================================================================== */
console.log("[18] resume-grace logic probes (sandboxed)");
{
  globalThis.State = { LOADING: "loading", MENU: "menu", PLAYING: "playing", GAMEOVER: "gameover" };

  const armFnSrc = fnBody(mainSrc, "graceNeedsArm");
  const gateFnSrc = fnBody(mainSrc, "simCanStep");
  check("graceNeedsArm + simCanStep extractable from main.js", !!armFnSrc && !!gateFnSrc);
  const graceNeedsArm = new Function("State", `return function graceNeedsArm(stateVal, wasPaused, isFrozen, isQa) ${armFnSrc}`)(
    globalThis.State,
  );
  const simCanStep = new Function("State", `return function simCanStep(stateVal, isPaused, graceRemaining) ${gateFnSrc}`)(
    globalThis.State,
  );

  // --- arming table: exactly one shape of un-pause arms the grace -----
  const armCases = [
    ["playing", true, false, false, true, "live paused run arms"],
    ["playing", false, false, false, false, "dead run never arms (showGameOver un-pauses with paused already false)"],
    ["menu", true, false, false, false, "menu never arms"],
    ["gameover", true, false, false, false, "results never arms"],
    ["loading", true, false, false, false, "loading never arms"],
    ["playing", true, true, false, false, "?freeze never arms"],
    ["playing", true, false, true, false, "?qa autostart never arms"],
  ];
  for (const [st, was, fz, qaf, want, label] of armCases) {
    check(
      `graceNeedsArm(${st}, wasPaused=${was}, frozen=${fz}, qa=${qaf}) -> ${want} (${label})`,
      graceNeedsArm(st, was, fz, qaf) === want,
    );
  }

  // --- gating table: distance/time cannot drift during the grace ------
  check("grace active -> sim cannot step (run stays frozen)", simCanStep("playing", false, 0.6) === false);
  check("grace elapsed -> sim steps again", simCanStep("playing", false, 0) === true);
  check("paused -> sim never steps", simCanStep("playing", true, 0) === false);
  check("menu -> sim never steps", simCanStep("menu", false, 0) === false);

  // --- the REAL setPaused body driving the REAL predicate -------------
  const spSrc = fnBody(mainSrc, "setPaused");
  check("setPaused body extractable", !!spSrc);
  const gShell = { graceT: 0, graceHidden: true, pauseHidden: true, hints: 0, enters: 0 };
  const graceEls = {
    pauseOverlay: { classList: { toggle: (_c, v) => (gShell.pauseHidden = v) } },
    pausePanel: { classList: { add: () => {}, remove: () => {} } },
    resumeGrace: {
      classList: {
        add: () => (gShell.graceHidden = true),
        remove: () => (gShell.graceHidden = false),
      },
    },
  };
  const armStub = () => {
    gShell.graceT = 1.2;
    graceEls.resumeGrace.classList.remove("hidden");
  };
  const clearStub = () => {
    gShell.graceT = 0;
    graceEls.resumeGrace.classList.add("hidden");
  };
  const setPausedFn = new Function(
    "State", "qa", "els", "applyHints", "clearGrace", "armGrace", "graceNeedsArm", "playScreenEnter",
    `return function setPausedShim(state, paused, p) {${spSrc}}`,
  )(
    globalThis.State,
    { freeze: false, qa: false, hud: true },
    graceEls,
    () => (gShell.hints += 1),
    clearStub,
    armStub,
    graceNeedsArm,
    () => (gShell.enters += 1),
  );

  // resume a paused PLAYING run: grace arms, grace overlay shows,
  // pause overlay hides (paused stays false during the grace).
  setPausedFn("playing", true, false);
  check("resume during PLAYING arms the 1.2 s grace (graceT > 0)", gShell.graceT === 1.2);
  check("grace overlay visible + pause overlay hidden while the grace runs", gShell.graceHidden === false && gShell.pauseHidden === true);
  check("pause overlay hid through the same setPaused (no stale panel)", gShell.pauseHidden === true);

  // a resume-affirming input: skip -> timer zeroed, overlay hidden.
  clearStub(); // what skipGrace() ends through
  check("skip input -> graceT 0 and overlay hidden", gShell.graceT === 0 && gShell.graceHidden === true);

  // pausing mid-grace cancels the countdown instead of leaving it armed.
  gShell.graceT = 0.7;
  gShell.graceHidden = false;
  setPausedFn("playing", false, true);
  check("pause cancels a live grace (timer zeroed, overlay hidden, panel shown)", gShell.graceT === 0 && gShell.graceHidden === true && gShell.pauseHidden === false);

  // un-pausing outside PLAYING never arms (quit paths stay clean).
  setPausedFn("menu", true, false);
  check("setPaused(false) at MENU never arms the grace", gShell.graceT === 0 && gShell.graceHidden === true);
  check("quit-to-menu path shows no pause panel either", gShell.pauseHidden === true);
}

/* ================================================================== *
 * 19. Tasks 4.1 static: powerup chips (magnet + x2, NEVER jetpack)   *
 * ================================================================== */
console.log("[19] powerup HUD chips (static)");
const runSrc = readFileSync(join(CLIENT, "js/src/game/run.js"), "utf8");
{
  // --- index.html: exactly two pre-created chips inside #hud ----------
  const h0 = html.indexOf('id="powerup-chips"');
  const h1 = html.indexOf("<!-- Menu Screen", h0);
  const chipRegion = h0 !== -1 && h1 > h0 ? html.slice(h0, h1) : "";
  check("#powerup-chips container exists in index.html", h0 !== -1);
  check(
    "#powerup-chips sits inside #hud (hidden together under ?hud=0)",
    h0 > html.indexOf('id="hud"') && h0 < html.indexOf("<!-- Menu Screen"),
  );
  check(
    "container pre-creates EXACTLY two chips: #chip-magnet + #chip-x2",
    chipRegion.includes('id="chip-magnet"') && chipRegion.includes('id="chip-x2"') && (chipRegion.match(/class="pu-chip/g) || []).length === 2,
  );
  check(
    "both chips boot .hidden with their data-pu attribute",
    /<div id="chip-magnet" class="pu-chip hidden" data-pu="magnet">/.test(chipRegion) &&
      /<div id="chip-x2" class="pu-chip hidden" data-pu="x2">/.test(chipRegion),
  );
  check(
    "NO jetpack chip exists anywhere (D5: jetpack timer is a data-only stub)",
    !html.includes("chip-jetpack") && !/data-pu="jetpack"/.test(html) && !/pu-jetpack/i.test(css),
  );
  const magnetBlock = chipRegion.slice(chipRegion.indexOf('id="chip-magnet"'));
  check("magnet chip carries an inline SVG U-magnet glyph (zero external assets)", /<svg[^>]*class="pu-ico"/.test(magnetBlock) && magnetBlock.includes("</svg>") && !/https?:\/\//.test(magnetBlock));
  check("x2 chip carries a text badge (times-2 glyph)", /class="pu-badge"[^<]*>&times;2</.test(chipRegion) || chipRegion.includes('>&times;2</span>'));
  for (const id of ["chip-magnet", "chip-x2"]) {
    const blk = chipRegion.slice(chipRegion.indexOf(`id="${id}"`));
    check(`#${id} has a .pu-bar > .pu-fill drain bar child`, /class="pu-bar"\s*>\s*<span class="pu-fill"/.test(blk));
  }

  // --- style.css: token-built chips + JS-driven transform drain bar ---
  const chipsCss = bodyOf(/^#powerup-chips$/);
  check(
    "#powerup-chips is a fixed left-edge stack, safe-area aware, click-through",
    !!chipsCss &&
      /position:\s*fixed/.test(chipsCss) &&
      /left:\s*max\(\s*18px,\s*env\(safe-area-inset-left/.test(chipsCss) &&
      /pointer-events:\s*none/.test(chipsCss),
  );
  const chipCss = bodyOf(/^\.pu-chip$/);
  check(
    ".pu-chip styled with the design tokens (--space / --radius / --glass-line)",
    !!chipCss && chipCss.includes("var(--space-") && chipCss.includes("var(--radius-") && chipCss.includes("var(--glass-line)"),
  );
  check(
    ".pu-chip base rule has NO animation and NO hidden-state opacity (visibility = .hidden only)",
    !!chipCss && !chipCss.includes("animation") && !/opacity:\s*0/.test(chipCss),
  );
  const fillCss = bodyOf(/^\.pu-fill$/);
  check(
    ".pu-fill is a transform-only scaleX bar with left origin (JS-driven, like #grace-bar)",
    !!fillCss && /transform:\s*scaleX\(1\)/.test(fillCss) && /transform-origin:\s*left/.test(fillCss) && !fillCss.includes("animation"),
  );
  const lowRule = rules.find((r) => /\.pu-chip\[data-low\]/.test(r.prelude));
  check("[data-low] low-time pulse rule exists", !!lowRule);
  const lowKf = cssNC.match(/@keyframes pu-low\s*\{[\s\S]*?\n\}/);
  check(
    "@keyframes pu-low animates opacity ONLY (decoration; bar shrink is the honest signal)",
    !!lowKf && lowKf[0].includes("opacity") && !/(width|height|transform|display)\s*:/.test(lowKf[0]),
  );
  const chipPop = bodyOf(/^\.pu-chip\.pop$/);
  check(".pu-chip.pop reuses the shared hud-pop beat (collect feedback)", !!chipPop && chipPop.includes("hud-pop"));
  check("magnet + x2 fills get distinct accent gradients", !!bodyOf(/^#chip-magnet \.pu-fill$/) && !!bodyOf(/^#chip-x2 \.pu-fill$/));

  // --- main.js + run.js: duration source + read/wiring paths ----------
  check("main.js pins POWERUP_DURATION_S = 10", /const POWERUP_DURATION_S = 10;/.test(mainSrc));
  check(
    "denominator matches run.js: collectPowerup default AND pickups.onCollect grant 10",
    /collectPowerup\(type, duration = 10\)/.test(runSrc) && /collectPowerup\(type, 10\)/.test(runSrc),
  );
  check("main.js declares the 25% low threshold constant", /const POWERUP_LOW_FRAC = 0\.25;/.test(mainSrc));
  const uh = fnBody(mainSrc, "updateHud") || "";
  check(
    "updateHud reads run.powerups.magnet/.x2 through writePuChip (never jetpack)",
    uh.includes("run.powerups.magnet") && uh.includes("run.powerups.x2") && !uh.includes("run.powerups.jetpack"),
  );
  check("els caches chipMagnet/chipMagnetFill/chipX2/chipX2Fill", /chipMagnet: document\.getElementById\("chip-magnet"\)/.test(mainSrc) && /chipMagnetFill: document\.querySelector\("#chip-magnet \.pu-fill"\)/.test(mainSrc) && /chipX2: document\.getElementById\("chip-x2"\)/.test(mainSrc) && /chipX2Fill: document\.querySelector\("#chip-x2 \.pu-fill"\)/.test(mainSrc));
  const wpu = fnBody(mainSrc, "writePuChip") || "";
  check(
    "writePuChip toggles .hidden on the timer comparison and drains via quantized scaleX",
    wpu.includes("secs > 0") &&
      wpu.includes('classList.toggle("hidden"') &&
      wpu.includes("scaleX(") &&
      wpu.includes("Math.min(secs, duration)") &&
      wpu.includes("setAttribute"),
  );
  const resetBody = (mainSrc.match(/run\.events\.on\("reset", \(\) => \{([\s\S]*?)\n  \}\);/) || [])[1] || "";
  check(
    '"reset" handler hides both chips + invalidates their caches (no stale chips after RETRY)',
    resetBody.includes("magnetChipState") && resetBody.includes("x2ChipState") && resetBody.includes("chipMagnet") && resetBody.includes("chipX2") && resetBody.includes('classList.add("hidden")'),
  );
  const puBody = (mainSrc.match(/run\.events\.on\("powerup", \(type\) => \{([\s\S]*?)\n  \}\);/) || [])[1] || "";
  check(
    '"powerup" listener keeps the audio sting + pops ONLY the magnet/x2 chips (jetpack excluded)',
    puBody.includes('audio.play("powerup")') && puBody.includes('type === "magnet"') && puBody.includes('type === "x2"') && !puBody.includes("jetpack"),
  );
}

/* ================================================================== *
 * 20. Tasks 4.1/4.2 logic probes (sandboxed, REAL extracted sources) *
 * ================================================================== */
console.log("[20] powerup chips + restart accuracy logic probes (sandboxed)");
{
  // Recording fake element: counts every textContent/style/attr write so
  // probes can assert both WHAT was written and that settled frames
  // write NOTHING (quantized caches, no per-frame churn).
  function fakeEl(id) {
    const el = {
      id,
      textWrites: 0,
      styleWrites: 0,
      attrWrites: 0,
      pops: 0,
      attrs: {},
      hidden: true,
      transform: "scaleX(1)",
    };
    el.classList = {
      add: (c) => {
        if (c === "hidden") el.hidden = true;
        if (c === "pop") el.pops++;
      },
      remove: (c) => {
        if (c === "hidden") el.hidden = false;
      },
      toggle: (c, v) => {
        if (c === "hidden") el.hidden = !!v;
      },
      contains: (c) => (c === "hidden" ? el.hidden : false),
    };
    el.style = {
      set transform(v) {
        el.transform = v;
        el.styleWrites++;
      },
      get transform() {
        return el.transform;
      },
    };
    Object.defineProperty(el, "textContent", {
      get: () => el._text || "",
      set: (v) => {
        el._text = v;
        el.textWrites++;
      },
    });
    el.setAttribute = (n, v) => {
      el.attrs[n] = v;
      el.attrWrites++;
    };
    el.removeAttribute = (n) => {
      if (n in el.attrs) el.attrWrites++;
      delete el.attrs[n];
    };
    return el;
  }

  // The REAL pure write rule, extracted straight from main.js.
  const wSrc = fnBody(mainSrc, "writePuChip");
  check("writePuChip extractable from main.js", !!wSrc);
  check("updateHud extractable from main.js", !!fnBody(mainSrc, "updateHud"));
  // POWERUP_LOW_FRAC lives in main.js module scope; bind it as a
  // closed-over parameter so the extracted function is self-contained.
  const writePuChip = new Function(
    "POWERUP_LOW_FRAC",
    `return function writePuChip(chip, fill, st, secs, duration) {${wSrc}}`,
  )(0.25);

  // Fresh harness per scenario: env mirrors boot()'s closure state; the
  // REAL updateHud body is evaluated with `with (env)` so its bare
  // cache assignments (lastScore = ...) mutate the same shared env the
  // REAL reset handler body mutates.
  let runStub;
  let elsStub;
  let env;
  let updateHudFn;
  let writesSince; // write counter deltas for the last call

  function makeEnv({ score = 0, coins = 0, multiplier = 1, powerups } = {}) {
    runStub = {
      distance: 0,
      powerups: powerups || { magnet: 0, jetpack: 0, x2: 0 },
      getStats: () => ({ score, coins, distance: 0, multiplier, speed: 26 }),
    };
    elsStub = {};
    for (const id of [
      "score", "coins", "multiplier", "multiplierDisplay", "combo", "comboValue",
      "chipMagnet", "chipMagnetFill", "chipX2", "chipX2Fill",
    ]) elsStub[id] = fakeEl(id);
    env = {
      State: { PLAYING: "playing" },
      state: "playing",
      qa: { hud: true },
      run: runStub,
      els: elsStub,
      lastScore: -1,
      lastCoins: -1,
      lastMult: -1,
      comboStreak: 0,
      comboLastDistance: -Infinity,
      comboShown: false,
      lastComboShownValue: -1,
      COMBO_MIN: 10,
      COMBO_WINDOW_M: 45,
      popBadge: (el) => {
        el.pops++;
      },
      magnetChipState: { on: false, fill: -1, low: false },
      x2ChipState: { on: false, fill: -1, low: false },
      writePuChip,
      POWERUP_DURATION_S: 10,
      // Task 7.2: the reset handler also clears the teaching toast.
      toastTimer: 0,
      clearTimeout: () => {},
      hintToastHidden: true,
    };
    const uhSrc = fnBody(mainSrc, "updateHud");
    updateHudFn = new Function("env", `with (env) {\nreturn function updateHudShim() {${uhSrc}}\n}`)(env);
  }

  function totalWrites() {
    let t = 0;
    for (const el of Object.values(elsStub)) t += el.textWrites + el.styleWrites + el.attrWrites;
    return t;
  }
  /** One updateHud call + how many DOM writes it performed. */
  function hud() {
    const before = totalWrites();
    updateHudFn();
    writesSince = totalWrites() - before;
  }

  // --- 20a. magnet lifecycle: collect -> drain -> low -> expire --------
  makeEnv();
  runStub.powerups.magnet = 10; // collect (what collectPowerup grants)
  hud();
  check("magnet collect -> chip visible with a FULL bar on the same frame", elsStub.chipMagnet.hidden === false && elsStub.chipMagnetFill.transform === "scaleX(1)");
  check("magnet chip carries no low flag at full duration", !("data-low" in elsStub.chipMagnet.attrs));
  hud();
  check("settled full bar writes NOTHING on the next frame (quantized caches)", writesSince === 0);
  runStub.powerups.magnet = 6; // 4 s drained by the sim
  hud();
  check("magnet at 6 s -> bar drains to scaleX(0.6)", elsStub.chipMagnetFill.transform === "scaleX(0.6)");
  runStub.powerups.magnet = 2.5; // exactly 25% left
  hud();
  check("magnet at 25% -> data-low set (pulse; bar still shrinking)", "data-low" in elsStub.chipMagnet.attrs && elsStub.chipMagnetFill.transform === "scaleX(0.25)");
  runStub.powerups.magnet = 0; // expired
  hud();
  check(
    "magnet expiry -> chip hidden, low flag dropped, bar parked full",
    elsStub.chipMagnet.hidden === true && !("data-low" in elsStub.chipMagnet.attrs) && elsStub.chipMagnetFill.transform === "scaleX(1)",
  );

  // --- 20b. x2 collect: chip + existing multiplier readout -------------
  makeEnv({ multiplier: 2 });
  runStub.powerups.x2 = 10;
  hud();
  check("x2 collect -> x2 chip visible at full", elsStub.chipX2.hidden === false && elsStub.chipX2Fill.transform === "scaleX(1)");
  check("x2 collect -> multiplier display shows 2 via the existing s.multiplier path", elsStub.multiplier.textContent === "2" && elsStub.multiplierDisplay.hidden === false);
  check("magnet chip stays hidden while x2 runs", elsStub.chipMagnet.hidden === true);

  // --- 20c. jetpack: a live timer must move NO chip state (D5) ---------
  makeEnv();
  hud(); // baseline frame: caches primed, both chips confirmed hidden
  runStub.powerups.jetpack = 10; // a "live" jetpack timer
  hud();
  check(
    "live jetpack timer -> no chip state change at all",
    elsStub.chipMagnet.hidden === true && elsStub.chipX2.hidden === true && writesSince === 0 && elsStub.chipJetpack === undefined,
  );

  // --- 20d. reset with stale caches: first frame is fully fresh (4.2) --
  makeEnv({ score: 0, coins: 0, multiplier: 1 });
  // Simulate the END of the previous run: caches + DOM hold stale values.
  env.lastScore = 500;
  elsStub.score.textContent = "500";
  env.lastCoins = 30;
  elsStub.coins.textContent = "30";
  env.lastMult = 8;
  elsStub.multiplier.textContent = "8";
  elsStub.multiplierDisplay.hidden = false;
  env.magnetChipState.on = true;
  elsStub.chipMagnet.hidden = false;
  elsStub.chipMagnetFill.transform = "scaleX(0.4)";
  elsStub.chipMagnet.attrs["data-low"] = "";
  env.magnetChipState.low = true;
  // Fresh run: stats back to zero, powerups drained by _initSimState.
  runStub.getStats = () => ({ score: 0, coins: 0, distance: 0, multiplier: 1, speed: 26 });
  runStub.powerups = { magnet: 0, jetpack: 0, x2: 0 };
  // Fire the REAL reset handler body against the same env.
  const resetSrc2 = (mainSrc.match(/run\.events\.on\("reset", \(\) => \{([\s\S]*?)\n  \}\);/) || [])[1];
  check("reset handler extractable from main.js", !!resetSrc2);
  new Function("env", `with (env) {\n${resetSrc2}\n}`)(env);
  hud(); // the FIRST rendered frame of the new run
  check(
    "first frame after reset rewrites score/coins to 0 (lastX = -1 pattern)",
    elsStub.score.textContent === "0" && elsStub.coins.textContent === "0",
  );
  check("multiplier chip hidden + value rewritten on that same first frame", elsStub.multiplierDisplay.hidden === true && elsStub.multiplier.textContent === "1");
  check(
    "both powerup chips hidden with no low flags after reset",
    elsStub.chipMagnet.hidden === true && elsStub.chipX2.hidden === true && !("data-low" in elsStub.chipMagnet.attrs) && !("data-low" in elsStub.chipX2.attrs),
  );
  hud();
  check("second frame after reset is fully settled (zero writes)", writesSince === 0);

  // --- 20e. the REAL powerup listener: pop magnet/x2, never jetpack ----
  const puSrc2 = (mainSrc.match(/run\.events\.on\("powerup", \(type\) => \{([\s\S]*?)\n  \}\);/) || [])[1];
  check("powerup listener extractable from main.js", !!puSrc2);
  makeEnv();
  const played = [];
  const fire = (type) =>
    new Function("env", "audio", "type", `with (env) {\n${puSrc2}\n}`)(env, { play: (n) => played.push(n) }, type);
  fire("magnet");
  check("magnet collect -> its chip pops once (audio sting kept)", elsStub.chipMagnet.pops === 1 && elsStub.chipX2.pops === 0 && played.join() === "powerup");
  fire("x2");
  check("x2 collect -> its chip pops once", elsStub.chipX2.pops === 1);
  fire("jetpack");
  check("jetpack collect -> NO chip pops (VFX ring + sting are the feedback)", elsStub.chipMagnet.pops === 1 && elsStub.chipX2.pops === 1 && played.length === 3);
}

/* ================================================================== *
 * 21. Tasks 5.1/5.2 static: TIME row, gap line, banner burst         *
 * ================================================================== */
console.log("[21] results run context: TIME row + gap line + banner burst (static)");
{
  // --- index.html: stat-row order + inline clock + gap line -----------
  const gsStart = html.indexOf('class="gameover-stats"');
  const gbStart = html.indexOf('class="gameover-buttons"');
  const statsRegion = gsStart !== -1 && gbStart > gsStart ? html.slice(gsStart, gbStart) : "";
  check(".gameover-stats region extractable from index.html", statsRegion.includes('id="go-distance"'));
  const at = (label) => statsRegion.indexOf(`>${label}<`);
  const dI = at("DISTANCE"), cI = at("COINS"), tI = at("TIME"), bI = at("BEST");
  check("stat order reads DISTANCE, COINS, TIME, BEST", dI !== -1 && dI < cI && cI < tI && tI < bI);
  const timeRow = statsRegion.slice(statsRegion.lastIndexOf('<div class="stat-row">', tI), bI);
  check(
    "TIME row is a .stat-row with an inline SVG clock (zero external assets)",
    timeRow.includes('class="stat-row"') && /<svg[^>]*class="ico-row"/.test(timeRow) && timeRow.includes("</svg>") && !/https?:\/\//.test(timeRow),
  );
  check(
    "TIME value is #go-duration .row-value booting 0:00",
    /<strong id="go-duration" class="row-value">0:00<\/strong>/.test(timeRow),
  );
  check("#go-gap element exists and boots hidden", /id="go-gap" class="hidden"/.test(html));
  check(
    "#go-gap sits between .score-hero and .gameover-stats",
    html.indexOf('id="go-gap"') > html.indexOf('class="score-hero"') && html.indexOf('id="go-gap"') < gsStart,
  );

  // --- index.html: banner burst spans ----------------------------------
  const nbStart = html.indexOf('id="new-high-score"');
  const nbEnd = html.indexOf("</div>", nbStart);
  const bannerRegion = nbStart !== -1 && nbEnd > nbStart ? html.slice(nbStart, nbEnd) : "";
  check("#new-high-score hosts a .burst container", bannerRegion.includes('class="burst"'));
  const sparkles = (bannerRegion.match(/<span><\/span>/g) || []).length;
  check(`banner burst has 4-6 decorative spans (found ${sparkles})`, sparkles >= 4 && sparkles <= 6);
  check("burst is aria-hidden decoration inside the banner", /<span class="burst" aria-hidden="true">/.test(bannerRegion));
  check("two trophy SVGs flank the banner text (kept from the badge)", (bannerRegion.match(/<svg class="ico"/g) || []).length === 2);

  // --- style.css: full-width banner + settled-safe burst ---------------
  const bannerCss = bodyOf(/^#new-high-score$/);
  check(
    "#new-high-score is a full-width banner (width:100%, not fit-content)",
    !!bannerCss && /width:\s*100%/.test(bannerCss) && !bannerCss.includes("fit-content"),
  );
  check(
    "banner keeps the gold treatment (gold/orange gradient tokens)",
    !!bannerCss && bannerCss.includes("var(--gold-") && bannerCss.includes("var(--orange-"),
  );
  const burstCss = bodyOf(/^\.burst$/);
  check(".burst is a click-through overlay inside the banner", !!burstCss && /position:\s*absolute/.test(burstCss) && burstCss.includes("pointer-events: none"));
  const sparkCss = bodyOf(/^\.burst span$/);
  check(
    ".burst span static styles are SETTLED-VISIBLE (no opacity:0 base) so killed animations still render an intentional banner",
    !!sparkCss && /position:\s*absolute/.test(sparkCss) && !/opacity:\s*0\s*;/.test(sparkCss),
  );
  const popRule = bodyOf(/^#new-high-score\.pop \.burst span$/);
  check(
    "burst animation is bound to the .pop re-trigger with fill both (no !important so the kills win)",
    !!popRule && popRule.includes("burst-pop") && /both/.test(popRule) && !popRule.includes("!important"),
  );
  const burstKf = cssNC.match(/@keyframes burst-pop\s*\{[\s\S]*?\n\}/);
  check(
    "@keyframes burst-pop exists and animates transform/opacity ONLY",
    !!burstKf && burstKf[0].includes("transform") && burstKf[0].includes("opacity") && !/(width|height|left|top|margin|display|background)\s*:/.test(burstKf[0]),
  );
  check(
    "burst keyframe ends faded (fill both -> settled 'spent' state under 0.01ms kills)",
    !!burstKf && /opacity:\s*0/.test(burstKf[0]),
  );
  const gapCss = bodyOf(/^#go-gap$/);
  check("#go-gap styled as a subtle hint line (no entrance animation)", !!gapCss && gapCss.includes("var(--font-display)") && !gapCss.includes("animation"));

  // --- main.js: helpers + wiring ----------------------------------------
  const sgo = fnBody(mainSrc, "showGameOver") || "";
  const rcSrc = fnBody(mainSrc, "resultsContext") || "";
  check("main.js declares fmtDuration + resultsContext helpers", !!fnBody(mainSrc, "fmtDuration") && !!rcSrc);
  check(
    "resultsContext keeps the strict > rule and gaps only losing runs vs a real best",
    rcSrc.includes("score > high") && rcSrc.includes("high - score") && rcSrc.includes("high > 0"),
  );
  check("showGameOver routes the banner decision through resultsContext", sgo.includes("resultsContext(stats.score, high)"));
  check(
    "showGameOver writes #go-duration through fmtDuration (direct write, NOT counted up)",
    sgo.includes("goDuration") && sgo.includes("fmtDuration(shownDuration)") && !sgo.includes("startCountUp(els.goDuration"),
  );
  check(
    "?freeze pins the shown duration (no performance.now() jitter in frozen captures)",
    sgo.includes("shownDuration = qa.freeze") && sgo.includes("submitRunToBackend({ ...stats, duration })"),
  );
  check("gap copy is '<n> from your best' via toLocaleString", sgo.includes("toLocaleString()") && sgo.includes("from your best"));
  check("#go-gap toggles hidden at gap <= 0", sgo.includes('els.goGap.classList.toggle("hidden", gap <= 0)'));
  check("burst re-triggered on every new best via popBadge(els.newHigh)", sgo.includes("if (isHigh) popBadge(els.newHigh)"));
  check(
    "els caches goDuration + goGap",
    /goDuration: document\.getElementById\("go-duration"\)/.test(mainSrc) && /goGap: document\.getElementById\("go-gap"\)/.test(mainSrc),
  );
}

/* ================================================================== *
 * 22. Tasks 5.1/5.2 logic probes (sandboxed, REAL extracted sources) *
 * ================================================================== */
console.log("[22] results context logic probes (sandboxed)");
{
  const fmtDuration = new Function(
    `return function fmtDuration(secs) {${fnBody(mainSrc, "fmtDuration")}}`,
  )();
  check("fmtDuration extractable from main.js", typeof fmtDuration === "function");
  check("0 s -> '0:00'", fmtDuration(0) === "0:00");
  check("59 s -> '0:59'", fmtDuration(59) === "0:59");
  check("60 s -> '1:00'", fmtDuration(60) === "1:00");
  check("3661 s -> '61:01' (minutes unbounded, no hour rollover)", fmtDuration(3661) === "61:01");
  check("float duration floors (47.9 -> '0:47')", fmtDuration(47.9) === "0:47");
  check("negative input clamps to '0:00'", fmtDuration(-3) === "0:00");

  const resultsContext = new Function(
    `return function resultsContext(score, high) {${fnBody(mainSrc, "resultsContext")}}`,
  )();
  check("resultsContext extractable from main.js", typeof resultsContext === "function");
  let r = resultsContext(500, 3000);
  check("losing run 500 vs 3000 -> no banner, gap 2500", !r.isHigh && r.gap === 2500);
  check("gap renders as the locale string '2,500'", r.gap.toLocaleString() === "2,500");
  r = resultsContext(3000, 3000);
  check("tie is NOT a new best and shows no gap line (gap 0)", !r.isHigh && r.gap === 0);
  r = resultsContext(3001, 3000);
  check("1 over the best -> banner, no gap line", r.isHigh && r.gap === 0);
  r = resultsContext(100, 0);
  check("first run (best 0) -> banner, no gap line", r.isHigh && r.gap === 0);
  r = resultsContext(0, 0);
  check("zero-score first run -> no banner, no gap", !r.isHigh && r.gap === 0);
}

/* ================================================================== *
 * 23. Tasks 6.1/6.2 static: per-bus audio settings + menu toggles     *
 * ================================================================== */
console.log("[23] audio settings: music/sfx toggle rows (static)");
const audioSrc = readFileSync(join(CLIENT, "js/src/core/audio.js"), "utf8");
{
  // --- index.html: exactly one .settings-row hosting exactly the two ---
  const rowStart = html.indexOf('<div class="settings-row">');
  const rowEnd = html.indexOf("</div>", rowStart);
  const row = rowStart !== -1 && rowEnd > rowStart ? html.slice(rowStart, rowEnd) : "";
  check(".settings-row exists in the menu", row !== "");
  check(
    "settings row hosts EXACTLY the two toggles",
    row.includes('id="music-toggle"') && row.includes('id="sfx-toggle"') && (row.match(/<button /g) || []).length === 2,
  );
  check(
    "old single #sound-toggle fully removed (clean removal, no compat alias)",
    !html.includes('id="sound-toggle"') && !html.includes("sound-toggle-label"),
  );
  check(
    "#music-toggle: .settings-btn with aria-pressed + label span",
    /<button id="music-toggle" class="settings-btn" type="button" aria-pressed="/.test(row) &&
      row.includes('id="music-toggle-label"'),
  );
  check(
    "#sfx-toggle: .settings-btn with aria-pressed + label span",
    /<button id="sfx-toggle" class="settings-btn" type="button" aria-pressed="/.test(row) &&
      row.includes('id="sfx-toggle-label"'),
  );
  check(
    "both toggles carry inline SVG glyph pairs (zero external assets)",
    row.includes('class="ico-music-on"') &&
      row.includes('class="ico-music-off"') &&
      row.includes('class="ico-sound-on"') &&
      row.includes('class="ico-sound-off"') &&
      (row.match(/<svg /g) || []).length === 4 &&
      !/https?:\/\//.test(row),
  );
  check(
    "44px floor inherited: both toggles are .settings-btn (task 1.3 rule)",
    pxVal(bodyOf(/^\.settings-btn$/), "min-height") >= 44 && pxVal(bodyOf(/^\.settings-btn$/), "min-width") >= 44,
  );

  // --- style.css: off state keyed off the accessibility state itself ---
  check(
    "settings off state keys off [aria-pressed=\"false\"] (pressed = ON)",
    cssNC.includes('.settings-btn[aria-pressed="false"] .ico-music-on') &&
      cssNC.includes('.settings-btn[aria-pressed="false"] {'),
  );
  check("old .settings-btn.muted rules removed (attribute drives the state)", !/\.settings-btn\.muted/.test(cssNC));
  const rowCss = bodyOf(/^\.settings-row$/);
  check(
    ".settings-row spaces + wraps the two targets (narrow screens)",
    !!rowCss && rowCss.includes("gap: var(--space-2)") && rowCss.includes("flex-wrap: wrap"),
  );

  // --- audio.js: setters, boot parse, combined gates -------------------
  check("audio.js declares setMusicOn(on) + setSfxOn(on)", /setMusicOn\(on\)/.test(audioSrc) && /setSfxOn\(on\)/.test(audioSrc));
  check(
    "audio.js reads late_again_music + late_again_sfx at boot",
    audioSrc.includes('"late_again_music"') && audioSrc.includes('"late_again_sfx"'),
  );
  check(
    "boot parse: missing key = on ('0' is the only off value)",
    /this\.musicOn = localStorage\.getItem\(LS_MUSIC_KEY\) !== "0";/.test(audioSrc) &&
      /this\.sfxOn = localStorage\.getItem\(LS_SFX_KEY\) !== "0";/.test(audioSrc),
  );
  check("play() early-returns when sfx off or muted", /if \(!this\.ctx \|\| this\._muted \|\| !this\.sfxOn\) return;/.test(audioSrc));
  check(
    "scheduler tick gate = combined musicOn && !muted (same idle shape as mute)",
    /if \(!this\.ctx \|\| this\._muted \|\| !this\.musicOn\) return;/.test(audioSrc),
  );
  check(
    "startMusic gate combines musicOn with !muted",
    /this\._musicWanted = true;\s*\n\s*if \(this\.ctx && this\.musicOn && !this\._muted\) this\._startScheduler\(\);/.test(audioSrc),
  );
  check(
    "unmute resumes the groove only when the music setting allows",
    /else if \(this\.ctx && this\._musicWanted && this\.musicOn\) \{\s*\n\s*this\._startScheduler\(\);/.test(audioSrc),
  );
  // setMusicOn is a CLASS method (no `function` keyword) — fnBody cannot
  // see it, so slice from the signature to the method-close indent instead.
  const smoBody = (audioSrc.match(/setMusicOn\(on\) \{[\s\S]*?\n  \}/) || [""])[0];
  check(
    "setMusicOn(false) idles the scheduler exactly like mute; on resumes it",
    smoBody.includes("clearInterval(this._timer)") && smoBody.includes("this._timer = 0") && smoBody.includes("_startScheduler()"),
  );

  // --- main.js: persistence + UI sync wiring ---------------------------
  check('main.js LS_KEYS gains music + sfx ("late_again_music"/"late_again_sfx")', /music: "late_again_music"/.test(mainSrc) && /sfx: "late_again_sfx"/.test(mainSrc));
  check(
    "els caches musicToggle/sfxToggle + their labels",
    /musicToggle: document\.getElementById\("music-toggle"\)/.test(mainSrc) &&
      /musicToggleLabel: document\.getElementById\("music-toggle-label"\)/.test(mainSrc) &&
      /sfxToggle: document\.getElementById\("sfx-toggle"\)/.test(mainSrc) &&
      /sfxToggleLabel: document\.getElementById\("sfx-toggle-label"\)/.test(mainSrc),
  );
  check("no soundToggle references remain in main.js", !/soundToggle/.test(mainSrc));
  const tmBody = fnBody(mainSrc, "toggleMusic") || "";
  const tsBody = fnBody(mainSrc, "toggleSfx") || "";
  check(
    "toggleMusic flips + persists + resyncs",
    tmBody.includes("audio.setMusicOn(!audio.musicOn)") && tmBody.includes("lsSet(LS_KEYS.music") && tmBody.includes("applyMuteUi()"),
  );
  check(
    "toggleSfx flips + persists + resyncs",
    tsBody.includes("audio.setSfxOn(!audio.sfxOn)") && tsBody.includes("lsSet(LS_KEYS.sfx") && tsBody.includes("applyMuteUi()"),
  );
  const amuBody = fnBody(mainSrc, "applyMuteUi") || "";
  check(
    "applyMuteUi syncs all three controls' aria-pressed (+ labels)",
    amuBody.includes("muteBtn") &&
      /syncToggle\(els\.musicToggle/.test(amuBody) &&
      /syncToggle\(els\.sfxToggle/.test(amuBody) &&
      (amuBody.match(/setAttribute\("aria-pressed"/g) || []).length >= 2 && // mute direct + the shared toggle helper
      amuBody.includes("MUSIC") &&
      amuBody.includes("SFX"),
  );
  check(
    "toggle handlers wired to click; master mute unchanged",
    /els\.musicToggle\.addEventListener\("click", toggleMusic\)/.test(mainSrc) &&
      /els\.sfxToggle\.addEventListener\("click", toggleSfx\)/.test(mainSrc) &&
      /els\.muteBtn\.addEventListener\("click", toggleMute\)/.test(mainSrc),
  );
  check("applyMuteUi runs at boot (aria-pressed reflects persisted state)", /applyMuteUi\(\); \/\/ reflect the persisted state on boot/.test(mainSrc));
}

/* ================================================================== *
 * 24. Tasks 6.1/6.2 logic probes (sandboxed AudioManager)             *
 * ================================================================== */
console.log("[24] audio settings logic probes (sandboxed AudioManager)");
{
  // Node-counting stub env: fresh localStorage store + window per
  // scenario (AudioManager registers gesture listeners at construction).
  function makeAudioEnv({ ls = {} } = {}) {
    const store = { ...ls };
    globalThis.localStorage = {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => {
        store[k] = String(v);
      },
      removeItem: (k) => delete store[k],
    };
    const counts = { osc: 0, src: 0 };
    class FakeParam {
      constructor(v = 1) {
        this.value = v;
      }
      setValueAtTime() {} linearRampToValueAtTime() {} exponentialRampToValueAtTime() {}
      cancelScheduledValues() {} setTargetAtTime() {}
    }
    class FakeNode {
      constructor() {
        this.gain = new FakeParam(1);
        this.frequency = new FakeParam(440);
        this.Q = new FakeParam(1);
        this.threshold = new FakeParam(0);
        this.knee = new FakeParam(0);
        this.ratio = new FakeParam(1);
        this.attack = new FakeParam(0);
        this.release = new FakeParam(0);
        this.type = "";
        this.buffer = null;
        this.loop = false;
      }
      connect() { return this; }
      start() {} stop() {}
    }
    class FakeCtx {
      constructor() {
        this.currentTime = 10;
        this.state = "running";
        this.sampleRate = 48000;
        this.destination = new FakeNode();
      }
      createGain() { return new FakeNode(); }
      createDynamicsCompressor() { return new FakeNode(); }
      createBiquadFilter() { return new FakeNode(); }
      createOscillator() {
        counts.osc++;
        return new FakeNode();
      }
      createBufferSource() {
        counts.src++;
        return new FakeNode();
      }
      createBuffer(_ch, len) {
        return { getChannelData: () => new Float32Array(len) };
      }
      resume() { return Promise.resolve(); }
      close() { return Promise.resolve(); }
    }
    const listeners = {};
    globalThis.window = {
      AudioContext: FakeCtx,
      addEventListener: (t, fn) => {
        (listeners[t] = listeners[t] || []).push(fn);
      },
      removeEventListener: (t, fn) => {
        const a = listeners[t] || [];
        const i = a.indexOf(fn);
        if (i >= 0) a.splice(i, 1);
      },
    };
    return {
      store,
      counts,
      gesture: () => {
        for (const fn of listeners.keydown || []) fn({ code: "KeyM" });
      },
    };
  }

  const { AudioManager } = await import(join(CLIENT, "js/src/core/audio.js") + "?uiaudio=1");

  // --- 24a. boot table ---------------------------------------------------
  let env = makeAudioEnv({});
  let am = new AudioManager();
  check("boot: missing keys -> music on + sfx on", am.musicOn === true && am.sfxOn === true);
  am.dispose();
  env = makeAudioEnv({ ls: { late_again_music: "0", late_again_sfx: "0" } });
  am = new AudioManager();
  check("boot: '0' keys -> music off + sfx off", am.musicOn === false && am.sfxOn === false);
  am.dispose();
  env = makeAudioEnv({ ls: { late_again_music: "1", late_again_sfx: "1" } });
  am = new AudioManager();
  check("boot: '1' keys -> music on + sfx on", am.musicOn === true && am.sfxOn === true);
  am.dispose();
  env = makeAudioEnv({ ls: { late_again_music: "true" } });
  am = new AudioManager();
  check("boot: other truthy value -> music on (matches muted convention)", am.musicOn === true);
  am.dispose();

  // --- 24b. music off: zero scheduled voices, sfx unaffected -------------
  env = makeAudioEnv({ ls: { late_again_music: "0" } });
  am = new AudioManager();
  env.gesture(); // first user gesture creates the stub ctx
  check("gesture created the stub ctx", am.ctx !== null);
  am.startMusic();
  check("music off: startMusic leaves the scheduler idle (no timer)", am._timer === 0);
  am._schedule(); // even a forced tick must schedule nothing
  check("music off: forced scheduler tick schedules ZERO voices", env.counts.osc + env.counts.src === 0);
  const b0 = env.counts.osc;
  am.play("coin");
  check("music off: sfx still plays (coin ding = 2 oscillators)", env.counts.osc - b0 === 2);
  am.dispose();

  // --- 24c. sfx off: play() no-ops, music still schedules ----------------
  env = makeAudioEnv({ ls: { late_again_sfx: "0" } });
  am = new AudioManager();
  env.gesture();
  am.startMusic();
  check("sfx off: music scheduler still starts", am._timer !== 0);
  const m0 = env.counts.osc + env.counts.src;
  am._schedule(); // one lookahead window of groove steps
  check("sfx off: scheduler tick scheduled music voices", env.counts.osc + env.counts.src > m0);
  const m1 = env.counts.osc + env.counts.src;
  am.play("coin");
  check("sfx off: play() is a silent no-op (no voices)", env.counts.osc + env.counts.src === m1);
  am.setSfxOn(true); // runtime setter, no reload
  am.play("coin");
  check("sfx re-enabled at runtime: play() voices return", env.counts.osc + env.counts.src > m1);
  am.dispose();

  // --- 24d. master mute interplay ----------------------------------------
  env = makeAudioEnv({ ls: {} });
  am = new AudioManager();
  env.gesture();
  am.setMusicOn(false);
  am.setSfxOn(false);
  am.startMusic();
  check("both settings off: scheduler idles", am._timer === 0);
  const k0 = env.counts.osc + env.counts.src;
  am.play("coin");
  check("both settings off: sfx silent", env.counts.osc + env.counts.src === k0);
  am.setMusicOn(true);
  am.setSfxOn(true);
  am.setMuted(true); // master mute on TOP of on-settings
  am.startMusic();
  check("master mute kills music even with the setting on", am._timer === 0);
  am.play("coin");
  check("master mute kills sfx even with the setting on", env.counts.osc + env.counts.src === k0);
  am.setMusicOn(false);
  am.setMuted(false);
  am.startMusic();
  check("unmute with the music setting off -> scheduler stays idle", am._timer === 0);
  am.setMusicOn(true); // menu toggle back on; a run wanted the groove
  check("music back on resumes the groove (wanted flag survived)", am._timer !== 0);
  const k1 = env.counts.osc + env.counts.src;
  am.play("coin");
  check("unmute restored sfx too (mute is the only master gate)", env.counts.osc + env.counts.src > k1);
  am.dispose();

  // --- 24e. menu -> next run: stopMusic/startMusic cycle ------------------
  env = makeAudioEnv({ ls: { late_again_music: "0" } });
  am = new AudioManager();
  env.gesture();
  am.startMusic(); // a run with music off
  check("run with music off: no groove", am._timer === 0);
  am.stopMusic(); // leaving the run state
  am.setMusicOn(true); // re-enabled in the menu
  check("re-enable while no run wants music -> scheduler stays idle", am._timer === 0);
  am.startMusic(); // the menu -> start run path
  check("next startMusic works after re-enable", am._timer !== 0);
  am.dispose();

  // --- 24f. reload boots with the persisted choices ------------------------
  env = makeAudioEnv({ ls: {} });
  env.store["late_again_music"] = "0"; // what main.js lsSet writes
  env.store["late_again_sfx"] = "0";
  const amOff = new AudioManager();
  check("reload: persisted '0'/'0' boots music+sfx off", amOff.musicOn === false && amOff.sfxOn === false);
  env.store["late_again_music"] = "1";
  const amMix = new AudioManager();
  check("reload: persisted '1'/0 boots music on + sfx off", amMix.musicOn === true && amMix.sfxOn === false);
  amOff.dispose();
  amMix.dispose();

  // --- 24g. the REAL applyMuteUi + toggle sources over fake els -----------
  const audioStub = {
    muted: false,
    musicOn: true,
    sfxOn: true,
    setMuted(on) { this.muted = on; },
    setMusicOn(on) { this.musicOn = on; },
    setSfxOn(on) { this.sfxOn = on; },
  };
  const mkBtn = () => {
    const el = { attrs: {}, mutedClass: false };
    el.classList = { toggle: (c, v) => { if (c === "muted") el.mutedClass = !!v; } };
    el.setAttribute = (n, v) => { el.attrs[n] = String(v); };
    return el;
  };
  const mkSpan = () => ({ textContent: "" });
  const elsStub = {
    muteBtn: mkBtn(),
    musicToggle: mkBtn(),
    musicToggleLabel: mkSpan(),
    sfxToggle: mkBtn(),
    sfxToggleLabel: mkSpan(),
  };
  const amuSrc = fnBody(mainSrc, "applyMuteUi");
  check("applyMuteUi extractable from main.js", !!amuSrc);
  const writes = {};
  const lsSetStub = (k, v) => {
    writes[k] = String(v);
  };
  const LS = { muted: "late_again_muted", music: "late_again_music", sfx: "late_again_sfx" };
  const applyMuteUi = new Function("audio", "els", `return function applyMuteUi() {${amuSrc}}`)(audioStub, elsStub);
  const toggleMusic = new Function("audio", "els", "lsSet", "LS_KEYS", "applyMuteUi", `return function toggleMusic() {${fnBody(mainSrc, "toggleMusic")}}`)(
    audioStub, elsStub, lsSetStub, LS, applyMuteUi,
  );
  const toggleSfx = new Function("audio", "els", "lsSet", "LS_KEYS", "applyMuteUi", `return function toggleSfx() {${fnBody(mainSrc, "toggleSfx")}}`)(
    audioStub, elsStub, lsSetStub, LS, applyMuteUi,
  );
  const toggleMute = new Function("audio", "els", "lsSet", "LS_KEYS", "applyMuteUi", `return function toggleMute() {${fnBody(mainSrc, "toggleMute")}}`)(
    audioStub, elsStub, lsSetStub, LS, applyMuteUi,
  );

  applyMuteUi();
  check(
    "boot sync: mute unpressed, music+sfx pressed (features ON)",
    elsStub.muteBtn.attrs["aria-pressed"] === "false" &&
      elsStub.musicToggle.attrs["aria-pressed"] === "true" &&
      elsStub.sfxToggle.attrs["aria-pressed"] === "true",
  );
  check("boot labels read MUSIC ON / SFX ON", elsStub.musicToggleLabel.textContent === "MUSIC ON" && elsStub.sfxToggleLabel.textContent === "SFX ON");

  toggleMusic();
  check(
    "music off: aria-pressed false + label MUSIC OFF + persisted '0'",
    elsStub.musicToggle.attrs["aria-pressed"] === "false" &&
      elsStub.musicToggleLabel.textContent === "MUSIC OFF" &&
      writes["late_again_music"] === "0",
  );
  check("music toggle leaves sfx + master untouched", elsStub.sfxToggle.attrs["aria-pressed"] === "true" && elsStub.muteBtn.attrs["aria-pressed"] === "false");
  toggleMusic();
  check("music back on: pressed true + MUSIC ON + persisted '1'", elsStub.musicToggle.attrs["aria-pressed"] === "true" && elsStub.musicToggleLabel.textContent === "MUSIC ON" && writes["late_again_music"] === "1");

  toggleSfx();
  check(
    "sfx off: aria-pressed false + label SFX OFF + persisted '0'",
    elsStub.sfxToggle.attrs["aria-pressed"] === "false" &&
      elsStub.sfxToggleLabel.textContent === "SFX OFF" &&
      writes["late_again_sfx"] === "0" &&
      elsStub.musicToggle.attrs["aria-pressed"] === "true",
  );

  toggleMute();
  check(
    "master mute: mute btn pressed + .muted class; settings toggles untouched",
    elsStub.muteBtn.attrs["aria-pressed"] === "true" &&
      elsStub.muteBtn.mutedClass === true &&
      elsStub.musicToggle.attrs["aria-pressed"] === "true" &&
      elsStub.sfxToggle.attrs["aria-pressed"] === "false",
  );
  check("master mute persisted under its own key", writes["late_again_muted"] === "1");
}

/* ================================================================== *
 * 25. Tasks 7.1/7.2/7.3: coach + teaching toast + how-to-play        *
 * ================================================================== */
console.log("[25] first-run coach, teaching toast, how-to-play");
const coachSrc = readFileSync(join(CLIENT, "js/src/game/coach.js"), "utf8");
const trainsSrc = readFileSync(join(CLIENT, "js/src/entities/trains.js"), "utf8");
{
  /** Extract a class-method body by its signature (brace-matched). */
  function methodBody(src, signature) {
    const i = src.indexOf(signature);
    if (i === -1) return null;
    const open = src.indexOf("{", i);
    let depth = 0;
    let j = open;
    for (; j < src.length; j++) {
      if (src[j] === "{") depth++;
      else if (src[j] === "}") {
        depth--;
        if (depth === 0) break;
      }
    }
    return src.slice(open, j + 1);
  }

  // --- 25a. static: coach module + read-only queries + precache -------
  check("game/coach.js exists and is non-empty", coachSrc.length > 0);
  check(
    "coach.js exports coachShouldRun + createCoach",
    /export function coachShouldRun/.test(coachSrc) && /export function createCoach/.test(coachSrc),
  );
  check("coach.js pins TUTOR_KEY = late_again_tutored", coachSrc.includes('"late_again_tutored"'));
  check("coach.js is dependency-free (no imports)", !/^import /m.test(coachSrc));
  const csrBody = fnBody(coachSrc, "coachShouldRun") || "";
  check(
    "flag convention: ONLY an explicit \"0\" teaches (missing/corrupt = already taught)",
    csrBody.includes('=== "0"') && !csrBody.includes("!=="),
  );
  check("sw.js precaches /js/src/game/coach.js", swSrc.includes('"./js/src/game/coach.js"'));

  check(
    "run.js exposes nearestJumpable + nearestOverhead pass-throughs",
    /nearestJumpable\(z, range\)/.test(runSrc) && /nearestOverhead\(z, range\)/.test(runSrc),
  );
  check(
    "ObstacleManager implements the kind scans (barrier / overhead)",
    trainsSrc.includes('"barrier"') && /nearestJumpable\(z, range, x\)/.test(trainsSrc) && /nearestOverhead\(z, range, x\)/.test(trainsSrc),
  );
  const MUTATION_RE = /\.push\(|\.splice\(|\.pop\(|\.shift\(|length\s*=[^=]|position\.(?:x|y|z)\s*=[^=]|active\s*=[^=]|visible\s*=[^=]/;
  for (const sig of ["nearestJumpable(z, range, x)", "nearestOverhead(z, range, x)", "_nearestKindAhead(z, range, kind, x)"]) {
    const body = methodBody(trainsSrc, sig) || "";
    check(
      `trains.js ${sig} is a strictly read-only scan (no store mutation)`,
      body.length > 0 && !MUTATION_RE.test(body),
    );
  }
  for (const sig of ["nearestJumpable(z, range)", "nearestOverhead(z, range)"]) {
    const body = methodBody(runSrc, sig) || "";
    check(`run.js ${sig} only delegates (no sim writes)`, body.length > 0 && !MUTATION_RE.test(body));
  }

  // --- 25b. static: index.html structure ------------------------------
  check(
    "#hint-toast boots hidden with aria-live (polite)",
    /<div id="hint-toast" class="hidden" aria-live="polite"><\/div>/.test(html),
  );
  check(
    "#hint-toast sits INSIDE #hud (?hud=0 hides it with the run UI)",
    html.indexOf('id="hint-toast"') > html.indexOf('id="hud"') && html.indexOf('id="hint-toast"') < html.indexOf("<!-- Menu Screen"),
  );
  check(
    "#howto-btn is a settings-btn in the menu with dialog semantics",
    /<button id="howto-btn" class="settings-btn" type="button" aria-haspopup="dialog" aria-expanded="false">/.test(html),
  );
  check("#howto-btn carries an inline SVG glyph (zero external assets)", (() => {
    const b0 = html.indexOf('id="howto-btn"');
    const b1 = html.indexOf("</button>", b0);
    const blk = b0 !== -1 ? html.slice(b0, b1) : "";
    return blk.includes("<svg") && blk.includes("</svg>") && !/https?:\/\//.test(blk);
  })());
  check(
    "how-to-play row sits BELOW the settings row (D9 menu order)",
    html.indexOf('class="settings-row howto-row"') > html.indexOf('<div class="settings-row">'),
  );
  check(
    "#howto-btn lives in the menu card (before the game-over screen)",
    html.indexOf('id="howto-btn"') > html.indexOf('class="menu-card"') && html.indexOf('id="howto-btn"') < html.indexOf("<!-- Game Over Screen"),
  );
  check(
    "#howto-panel is a non-blocking dialog (role=dialog, aria-modal=false, labelled)",
    /<div id="howto-panel" class="hidden" role="dialog" aria-modal="false" aria-label="How to play">/.test(html),
  );
  check(
    "#howto-panel hosts both scheme lists + the close button",
    html.includes('id="howto-touch-list"') && html.includes('id="howto-keys-list"') && html.includes('id="howto-touch-section"') && html.includes('id="howto-keys-section"'),
  );
  check('#howto-close-btn is a .btn.btn-secondary (44px floor)', /<button id="howto-close-btn" class="btn btn-secondary" type="button">CLOSE<\/button>/.test(html));
  check(
    "#howto-panel is a pause-overlay sibling OUTSIDE #menu-screen",
    html.indexOf('id="howto-panel"') > html.indexOf('id="pause-overlay"') && html.indexOf('id="howto-panel"') < html.indexOf('id="resume-grace"'),
  );

  // --- 25c. static: style.css ------------------------------------------
  const toastCss = bodyOf(/^#hint-toast$/);
  check("#hint-toast is pointer-events: none (never a gesture target)", !!toastCss && /pointer-events:\s*none/.test(toastCss));
  check(
    "#hint-toast clears the corner buttons (bottom >= corner 18px + 44px + margin)",
    !!toastCss && /bottom:[^;]*72px/.test(toastCss),
  );
  check(
    "#hint-toast entrance is animation-only on the motion tokens",
    !!toastCss && toastCss.includes("animation:") && toastCss.includes("var(--dur-2)") && toastCss.includes("var(--ease-out)"),
  );
  const toastKf = cssNC.match(/@keyframes toast-in\s*\{[\s\S]*?\n\}/);
  check(
    "@keyframes toast-in animates transform + opacity ONLY (settled under kills)",
    !!toastKf && toastKf[0].includes("transform") && toastKf[0].includes("opacity") && !/(width|height|top|left|margin|padding|display)\s*:/.test(toastKf[0]),
  );
  const howtoCss = bodyOf(/^#howto-panel$/);
  check("#howto-panel is a fixed full-screen overlay", !!howtoCss && /position:\s*fixed/.test(howtoCss) && /inset:\s*0/.test(howtoCss));
  check(".howto-active emphasis rule exists (live scheme highlighted)", !!bodyOf(/^\.howto-scheme\.howto-active$/));
  check("data-scheme reorders the how-to sections (current scheme first)", /html\[data-scheme="keys"\]\s*#howto-keys-section/.test(cssNC));

  // --- 25d. static: main.js wiring --------------------------------------
  check(
    "main.js imports the coach module",
    /import \{ coachShouldRun, createCoach \} from "\.\/game\/coach\.js";/.test(mainSrc),
  );
  check('main.js LS_KEYS gains tutored: "late_again_tutored"', /tutored: "late_again_tutored"/.test(mainSrc));
  const startRunBody2 = fnBody(mainSrc, "startRun") || "";
  check(
    "startRun creates the coach from a FRESH LS read (flag \"1\" after a taught run -> null)",
    startRunBody2.includes("coachShouldRun(lsGet(LS_KEYS.tutored))") && startRunBody2.includes("createCoach("),
  );
  check(
    "coach is ticked on the fixed-step clock next to vfx.advanceFixed",
    /vfx\.advanceFixed\(FIXED, simInfo\(\)\);[\s\S]{0,200}if \(coach\) coach\.tick\(run\.distance, run\.z\);/.test(mainSrc),
  );
  const sgoBody = fnBody(mainSrc, "showGameOver") || "";
  check("showGameOver marks the tutored flag (death path)", sgoBody.includes("markTutored()"));
  check(
    "pause RESTART + MENU handlers mark the tutored flag (quit/restart paths)",
    (mainSrc.match(/els\.pauseRestartBtn[\s\S]*?markTutored\(\)/) || []).length > 0 &&
      (mainSrc.match(/els\.pauseMenuBtn[\s\S]*?markTutored\(\)/) || []).length > 0,
  );
  const mtBody = fnBody(mainSrc, "markTutored") || "";
  check("markTutored is a no-op unless coaching was active this run", mtBody.includes("if (coach)") && mtBody.includes('lsSet(LS_KEYS.tutored, "1")'));
  check("main.js pins TOAST_MS = 2500", /const TOAST_MS = 2500;/.test(mainSrc));
  const stBody = fnBody(mainSrc, "showToast") || "";
  check(
    "showToast: single element (textContent swap) + timer cleared before re-arm",
    stBody.includes("textContent = text") && stBody.includes("clearTimeout(toastTimer)"),
  );
  check(
    "showToast never arms the auto-dismiss under ?freeze (captures stay settled)",
    stBody.includes("qa.freeze") && stBody.includes("if (qa.freeze) return;"),
  );
  const resetBody2 = (mainSrc.match(/run\.events\.on\("reset", \(\) => \{([\s\S]*?)\n  \}\);/) || [])[1] || "";
  check("reset handler clears a stale toast (no leftovers into a new run)", resetBody2.includes("hintToast") && resetBody2.includes("clearTimeout(toastTimer)"));

  // COACH_COPY: both schemes x 3 verbs, no scheme mixing (same rule as
  // HINT_COPY), extracted from the REAL literal.
  const KEY_RE2 = /\b(ARROWS?|WASD|SPACE|ESC|ENTER|[PM])\b/;
  const TOUCH_RE2 = /\b(SWIPE|TAPS?)\b/;
  const coachMapMatch = mainSrc.match(/const COACH_COPY = \{[\s\S]*?\n\s*\};/);
  check("main.js declares a COACH_COPY map literal", !!coachMapMatch);
  const COACH_COPY = coachMapMatch ? new Function(`"use strict"; ${coachMapMatch[0]}; return COACH_COPY;`)() : {};
  for (const kind of ["lane", "jump", "roll"]) {
    const hit = COACH_COPY[kind];
    check(
      `COACH_COPY.${kind} has BOTH schemes' strings (non-empty)`,
      !!hit && typeof hit.touch === "string" && hit.touch.length > 0 && typeof hit.keys === "string" && hit.keys.length > 0,
    );
    check(`COACH_COPY.${kind} touch line contains no key names`, !!hit && !KEY_RE2.test(hit.touch), hit && hit.touch);
    check(`COACH_COPY.${kind} keys line contains no swipe/tap words`, !!hit && !TOUCH_RE2.test(hit.keys), hit && hit.keys);
  }

  // --- 25e. coach logic probes (sandboxed, REAL module) -----------------
  const coachMod = await import(join(CLIENT, "js/src/game/coach.js") + "?probe=1");
  {
    // value table: only "0" teaches
    const table = [
      ["0", true],
      [undefined, false],
      [null, false],
      ["", false],
      ["1", false],
      ["true", false],
      [" 0", false],
      ["0 ", false],
    ];
    for (const [raw, want] of table) {
      check(`coachShouldRun(${JSON.stringify(raw)}) -> ${want} (existing saves never re-taught)`, coachMod.coachShouldRun(raw) === want);
    }
  }
  {
    // full coached run: each verb fires EXACTLY once at its trigger
    const kinds = [];
    const qCalls = [];
    const coach = coachMod.createCoach({
      shouldRun: true,
      queries: {
        nearestJumpable: (z, r) => {
          qCalls.push(["jump", z, r]);
          return z >= 50; // a barrier "closes in" from z 50 on
        },
        nearestOverhead: (z, r) => {
          qCalls.push(["roll", z, r]);
          return z >= 70; // a gantry "closes in" from z 70 on
        },
      },
      showHint: (kind) => kinds.push(kind),
    });
    coach.tick(10, 10);
    check("distance 10 -> no hint yet", kinds.length === 0);
    coach.tick(31, 31);
    check("distance 31 -> exactly the lane hint", kinds.join() === "lane");
    coach.tick(32, 32);
    check("lane hint does not repeat on later ticks", kinds.join() === "lane");
    coach.tick(50, 50);
    check("jumpable hazard within range at z 50 -> jump hint fires once", kinds.join() === "lane,jump");
    coach.tick(51, 51);
    coach.tick(60, 60);
    check("jump hint does not repeat (one-shot per run)", kinds.join() === "lane,jump");
    coach.tick(70, 70);
    check("overhead within range at z 70 -> roll hint fires once", kinds.join() === "lane,jump,roll");
    for (let d = 71; d <= 300; d += 7) coach.tick(d, d);
    check("full run of ticks: EXACTLY three hints total, nothing past 200 m", kinds.join() === "lane,jump,roll");
    check(
      "hazard queries were called read-only with the 35 m window and player z",
      qCalls.length > 0 && qCalls.every(([, z, r]) => typeof z === "number" && r === coachMod.HINT_RANGE_M && r === 35),
    );
  }
  {
    // already-taught save: the coach is a no-op
    const kinds = [];
    const coach = coachMod.createCoach({
      shouldRun: false,
      queries: { nearestJumpable: () => true, nearestOverhead: () => true },
      showHint: (kind) => kinds.push(kind),
    });
    for (let d = 0; d <= 300; d += 5) coach.tick(d, d);
    check("flag \"1\" (taught) -> zero hints across a whole run", kinds.length === 0);
  }
  {
    // teaching window guard: beyond 200 m nothing fires even on hits
    const kinds = [];
    const coach = coachMod.createCoach({
      shouldRun: true,
      queries: { nearestJumpable: () => true, nearestOverhead: () => true },
      showHint: (kind) => kinds.push(kind),
    });
    coach.tick(250, 250);
    coach.tick(1000, 1000);
    check("first tick already past 200 m -> nothing fires (window guard)", kinds.length === 0);
  }

  // --- 25f. toast probe (REAL showToast over stubbed els + timers) ------
  {
    const stSrc2 = fnBody(mainSrc, "showToast");
    check("showToast extractable from main.js", !!stSrc2);
    function makeToastEnv(freeze) {
      const toast = { text: "", hidden: true, shows: 0, hides: 0 };
      const el = {
        classList: {
          add: (c) => {
            if (c === "hidden") {
              toast.hidden = true;
              toast.hides++;
            }
          },
          remove: (c) => {
            if (c === "hidden") {
              toast.hidden = false;
              toast.shows++;
            }
          },
        },
      };
      Object.defineProperty(el, "textContent", {
        get: () => toast.text,
        set: (v) => {
          toast.text = v;
        },
      });
      const timers = [];
      let nextId = 1;
      const env = {
        els: { hintToast: el },
        qa: { freeze },
        toastTimer: 0,
        TOAST_MS: 2500,
        setTimeout: (fn2, ms) => {
          const id = nextId++;
          timers.push({ id, fn: fn2, ms });
          return id;
        },
        clearTimeout: (id) => {
          const i = timers.findIndex((t) => t.id === id);
          if (i >= 0) timers.splice(i, 1);
        },
      };
      const showToast = new Function("env", `with (env) {\nreturn function showToast(text) {${stSrc2}}\n}`)(env);
      return { showToast, env, toast, timers };
    }

    const live = makeToastEnv(false);
    live.showToast("HINT A");
    check("toast shown: element visible with the text", live.toast.hidden === false && live.toast.text === "HINT A");
    check("exactly ONE auto-dismiss timer armed at 2500 ms", live.timers.length === 1 && live.timers[0].ms === 2500);
    live.showToast("HINT B");
    check("second call replaces the first: single element, new text, still visible", live.toast.text === "HINT B" && live.toast.hidden === false);
    check("replace semantics keep ONE live timer (old cleared, not stacked)", live.timers.length === 1);
    live.timers[0].fn();
    check("after 2500 ms the toast is hidden (auto-dismiss)", live.toast.hidden === true);

    const frozen = makeToastEnv(true);
    frozen.showToast("FROZEN HINT");
    check("?freeze: toast renders settled (visible) ...", frozen.toast.hidden === false && frozen.toast.text === "FROZEN HINT");
    check("... but NO timer is armed (nothing can mutate the captured frame)", frozen.timers.length === 0 && frozen.env.toastTimer === 0);
    frozen.showToast("FROZEN HINT 2");
    check("?freeze: a second show stays timer-free and never throws", frozen.timers.length === 0);
  }

  // --- 25g. how-to-play probes (REAL extracted open/close/applyHowto) ---
  {
    const openSrc = fnBody(mainSrc, "openHowto");
    const closeSrc = fnBody(mainSrc, "closeHowto");
    const applySrc = fnBody(mainSrc, "applyHowto");
    check("openHowto / closeHowto / applyHowto extractable from main.js", !!openSrc && !!closeSrc && !!applySrc);

    // openHowto must never touch the state machine or persistence.
    check(
      "openHowto starts no run, changes no state, writes no storage",
      !/setState|startRun|lsSet|state\s*=/.test(openSrc),
    );

    // fake els: panel + button + focus bookkeeping + a "menu region" whose
    // DOM snapshot must survive open AND close untouched.
    function makeHowtoEls() {
      const panel = { hidden: true, classes: [] };
      panel.classList = {
        add: (c) => {
          panel.classes.push(["add", c]);
          if (c === "hidden") panel.hidden = true;
        },
        remove: (c) => {
          panel.classes.push(["remove", c]);
          if (c === "hidden") panel.hidden = false;
        },
        contains: (c) => c === "hidden" && panel.hidden,
      };
      const btn = { attrs: {}, focusCount: 0 };
      btn.setAttribute = (n, v) => {
        btn.attrs[n] = v;
      };
      btn.focus = () => {
        btn.focusCount++;
      };
      const closeBtn = { focusCount: 0 };
      closeBtn.focus = () => {
        closeBtn.focusCount++;
      };
      const menuRegion = {
        stats: '<div id="menu-stats">BEST 1</div>',
        board: '<ol id="leaderboard-list"></ol>',
      };
      const els = { howtoPanel: panel, howtoBtn: btn, howtoCloseBtn: closeBtn };
      return { panel, btn, closeBtn, els, menuRegion };
    }

    const how = makeHowtoEls();
    const openHowto = new Function("els", "applyHowto", `return function openHowto() {${openSrc}}`)(how.els, () => {});
    const closeHowto = new Function("els", `return function closeHowto() {${closeSrc}}`)(how.els);
    const snapshot = () => JSON.stringify([how.menuRegion.stats, how.menuRegion.board]);

    const before = snapshot();
    openHowto();
    check("open: panel becomes visible", how.panel.hidden === false);
    check("open: aria-expanded flips true on the opener", how.btn.attrs["aria-expanded"] === "true");
    check("open: focus moves to the close button", how.closeBtn.focusCount === 1);
    check("open: menu stats/leaderboard DOM untouched", snapshot() === before);

    closeHowto();
    check("close: panel hidden again", how.panel.hidden === true);
    check("close: aria-expanded back to false", how.btn.attrs["aria-expanded"] === "false");
    check("close: focus returns to #howto-btn", how.btn.focusCount === 1);
    check("close: menu DOM snapshot still identical (restored exactly as it was)", snapshot() === before);

    // applyHowto renders BOTH schemes from the REAL COACH_COPY literal and
    // emphasizes the live one.
    function makeListStub() {
      const list = { children: [] };
      list.replaceChildren = (...kids) => {
        list.children = kids;
      };
      return list;
    }
    function makeHowtoEnv(scheme) {
      const touchSec = { active: null };
      touchSec.classList = {
        toggle: (c, v) => {
          if (c === "howto-active") touchSec.active = !!v;
        },
      };
      const keysSec = { active: null };
      keysSec.classList = {
        toggle: (c, v) => {
          if (c === "howto-active") keysSec.active = !!v;
        },
      };
      const env = {
        currentScheme: () => scheme,
        COACH_COPY,
        document: { createElement: () => ({ textContent: "" }) },
        els: {
          howtoTouchList: makeListStub(),
          howtoKeysList: makeListStub(),
          howtoTouchSection: touchSec,
          howtoKeysSection: keysSec,
        },
      };
      const fn = new Function("env", `with (env) {\nreturn function applyHowto() {${applySrc}}\n}`)(env);
      return { fn, env, touchSec, keysSec };
    }

    const touchRun = makeHowtoEnv("touch");
    touchRun.fn();
    const tKids = touchRun.env.els.howtoTouchList.children.map((li) => li.textContent);
    const kKids = touchRun.env.els.howtoKeysList.children.map((li) => li.textContent);
    check(
      "applyHowto fills the touch list with the 3 touch lines from COACH_COPY",
      tKids.length === 3 && tKids[0] === COACH_COPY.lane.touch && tKids[1] === COACH_COPY.jump.touch && tKids[2] === COACH_COPY.roll.touch,
    );
    check(
      "applyHowto fills the keys list with the 3 keys lines (no mixing across lists)",
      kKids.length === 3 && kKids[0] === COACH_COPY.lane.keys && kKids.every((t) => !TOUCH_RE2.test(t)),
    );
    check("applyHowto emphasizes the touch section under the touch scheme", touchRun.touchSec.active === true && touchRun.keysSec.active === false);

    const keysRun = makeHowtoEnv("keys");
    keysRun.fn();
    check("applyHowto emphasizes the keys section under the keys scheme", keysRun.keysSec.active === true && keysRun.touchSec.active === false);

    // Escape wiring: a document keydown listener gated on panel visibility.
    check(
      "Escape closes the how-to panel only while it is open",
      /document\.addEventListener\("keydown"[\s\S]*?e\.code !== "Escape"[\s\S]*?classList\.contains\("hidden"[\s\S]*?closeHowto\(\)/.test(mainSrc),
    );
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
