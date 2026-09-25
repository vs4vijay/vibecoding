# Visual Overhaul — Pre-Overhaul Baseline

Date: 2026-09-20

## Method

- Measured via the `window.__renderStats` hook added in task 1.2 (`calls` = `renderer.info.render.calls`, `fps` = EMA 0.9/0.1 of `1/delta`), sampled over the page with `playwright-cli eval` at ~1s intervals (gameplay interval ~1–3s due to CLI round-trip overhead).
- Browser: Chromium 151 (Playwright, HeadlessChrome new headless mode with GPU rendering), viewport 1280×720. rAF was not throttled — fps sits at the display refresh (120 Hz).
- Machine: Apple Silicon Mac (arm64), macOS 27.0.
- Service worker unregistered and Cache Storage cleared before measuring, so the freshly built `dist/` client was served.
- MENU: 10 samples over ~10s while the menu idle camera animation ran.
- GAMEPLAY: samples taken only while `state === playing` (game-over screen hidden, HUD visible) and the player was past z≈50 with obstacles/buildings spawned — first sample of each run was ≥3s after run start (≥15 u/s base speed; obstacle spawners are active from run start). Runs were driven with periodic jump/lane-change inputs; on crash the run was auto-retried via `#retry-btn`.
- Cumulative gameplay time is counted conservatively as the sum of same-run gaps between consecutive samples (both endpoints confirmed playing): 112s bounded (exceeds the 60s target; real in-game time is higher since run start/end segments are not counted).

## MENU (idle camera animation)

| Metric     | Median | Min    | Max    |
|------------|--------|--------|--------|
| FPS        | 120.0  | 119.8  | 120.1  |
| Draw calls | 78     | 65     | 79     |

(10 samples; draw calls drift upward as the idle camera pans and more buildings enter the frustum.)

## GAMEPLAY (mid-run)

| Metric     | Median | Min    | Max    |
|------------|--------|--------|--------|
| FPS        | 120.1  | 119.8  | 121.6  |
| Draw calls | 153    | 135    | 175    |

(78 samples, 112s cumulative bounded gameplay time, 30 runs, 29 in-session crashes auto-retried.)

## Budget note

The overhaul's draw-call budget is 1.5× the gameplay median: 1.5 × 153 ≈ **230 draw calls** (gameplay).

## Post-Tier-C draw-call check (task 4.3)

Date: 2026-09-20

### Method

- In-page sampler (`setInterval` @1000ms, installed via `playwright-cli run-code`) recorded `window.__renderStats` every ~1s, so samples are exact 1s apart with no CLI round-trip drift. A sample was recorded only while a run was active (game-over screen hidden, HUD visible), ≥3s into the run, and displayed score ≥ 60 (score accrues ≈1/metre ⇒ player past z≈60).
- Same rendering conditions as baseline: Chromium 151 headless-with-GPU, 1280×720, rAF unthrottled (fps at the 120 Hz display refresh); current `dist/` client.
- Runs driven with a page-side synthetic-key dodger (KeyboardEvent sequence @450ms; blind, so crashes were frequent and auto-retried via `#retry-btn`).
- 68 samples across 12 runs (42 completed runs in session). True in-game time, measured by the sampler across run-start→game-over transitions: **272s** (bounded sum of same-run sample gaps: 56s).
- Busy-scene evidence: `/tmp/visual-overhaul/43a-busy-scene.png` (train + overhead gantry + building cluster mid-run).

### GAMEPLAY (mid-run, post-Tier-C)

| Metric     | Median | p90 | Min  | Max  |
|------------|--------|-----|------|------|
| FPS        | 120.1  | —   | 119.7 | 121.6 |
| Draw calls | 104.5  | 140 | 67   | 159  |

(68 samples, 12 runs, 272s in-game.)

### Verdict

- Budget 230 (1.5 × baseline gameplay median 153): **PASS, comfortably.** Observed max (159) is 31% under budget; p90 (140) is below even the pre-overhaul median (153); the post-overhaul median (104.5) is ~32% below the baseline median.
- No anomalous spikes: the highest samples (141–159) coincided with the densest legitimate scenes (train + overhead gantry + building clusters on screen). Note: `__renderStats` freezes once the game-over screen shows (render loop idles), which is why sampling is gated on run-active state.
- Visual systems landed since the baseline measurement: PBR materials + IBL environment lighting, procedural building facades, track bed, train factory, barrier/gantry set — and draw calls still trend well under the pre-overhaul numbers.

## Final performance check (task 8.2)

Date: 2026-09-22

### Method

- Same rendering conditions as the baseline (Chromium 151 headless-with-GPU, 1280×720, rAF unthrottled at the 120 Hz display, current `dist/` client). In-page sampler (`setInterval` @1000ms) recorded `window.__renderStats` every ~1s, gated on run-active state (menu and game-over screens both hidden, HUD visible) and ≥3s into the run.
- Run survivability was guaranteed page-side (no game code modified): `Math.random` pinned to 0.9 before run start, which makes `createObstacle` deterministic — every spawn is an overhead signal gantry in lane 1 (x = 3) — and the player was left in the center lane with zero inputs, so no collision is geometrically possible. No dodger keys were needed; the run never crashed (1 run, 0 retries, 0 auto-retries).
- **One single uninterrupted run**: 83 contiguous 1s-interval in-run samples spanning run-elapsed 4s→86s (83s contiguous in-run window; exceeds the 60s target). In-run state is airtight: the render loop only calls `updateGame` while `state === "playing"`, and the screen-class gate held for the whole window. Note: the HUD score readout stays 0 during this run because `updateHUD` only refreshes on pickup/multiplier events and the deterministic player collects nothing — internal score/distance still accrue per-frame.
- This deterministic scenario is lane-1-gantry-only, i.e. lighter than the busiest legitimate scenes (task 4.3 max 159 with trains + gantries + clusters on screen).

### GAMEPLAY (mid-run, final 60s+ window)

| Metric     | Median | p90 | Min  | Max  |
|------------|--------|-----|------|------|
| FPS        | 121.2  | —   | 119.8 | 124.7 |
| Draw calls | 90     | 94  | 82   | 95   |

(83 samples, 1 run, 86s in-run elapsed / 83s sampled.)

### Verdicts

- FPS ≈60 sustained: **PASS.** fps pins at the 120 Hz display refresh (median 121.2, min 119.8) — ~2× the ~60 FPS desktop spec bar; even the min clears it by a wide margin.
- Draw calls ≤ 230 budget (1.5 × baseline gameplay median 153): **PASS, comfortably.** Observed max (95) is 59% under budget; median (90) is 41% below even the pre-overhaul median (153).
- PWA offline font check: **PASS.** With the SW controlling the root page, a reload under `setOffline(true)` served the app from cache: the menu rendered and `document.fonts.check('16px Bungee')` → true (Bungee 400 loaded; three.js runtime cache also served — render loop ran at 120 fps offline). Known caveat unchanged: a never-visited cold start needs one online visit to install the SW + runtime-cache the CDN modules — inherent PWA behavior, documented in verification.md.

Full 27-scenario visual walkthrough: see [verification.md](./verification.md) (task 8.1).
