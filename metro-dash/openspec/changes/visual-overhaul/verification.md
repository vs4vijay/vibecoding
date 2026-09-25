# visual-overhaul — In-browser verification (task 8.1)

**Date:** 2026-09-22 · **Build:** dist/ as shipped (game.js + js/visual/* mtime 2026-09-21, unchanged across both parts; Part 2 performed exactly one rebuild for the pre-authorized SW-scope repair — game/render code untouched, see scenario "Typeface available offline")
**Method:** Desktop Chromium (120 Hz display) driven via playwright-cli against the already-running dev server at http://localhost:3001 (Elysia, ./dist). Every scenario was re-executed live in this session across 7 fresh runs (Part 1) and 2 fresh runs + an offline pass (Part 2); nothing is copied from earlier reports. Evidence screenshots in /tmp/visual-overhaul/ (Part 1: 81-10…81-22; Part 2: 81b-*).

**Disclosed page-side shims** (installed via `eval` at runtime, never touching game source):
- `Math.random` replaced with scripted values before run start to make spawns deterministic (0.9 → right-lane gantries; 0.1 → left-lane trains; [0.5,0.5,0.9,0.9] 4-cycle → center barriers + right gantries). Lets runs reach any distance unharmed and puts a chosen prop on screen. One 9 s run used the real `Math.random` for an unbiased draw-call sample.
- rAF watcher: a second rAF loop sampling `window.__renderStats` (t, camY, calls, fov) every frame → perf, FOV and landing-kick evidence; also integrates active play time (Δt clamped to 0.1 s exactly like the game loop) to reproduce run distance deterministically.
- rAF burst recorder: during animation tests, captures 480 px `canvas.toDataURL()` frames in the same rAF tick the game renders in (drawing buffer still valid) → true frame grabs for character poses; contact sheets built page-side.
- Loop freeze for static captures: `window.requestAnimationFrame` temporarily replaced by a stasher (auto-triggered at a target distance) so the run halts on the exact frame while the slow CLI screenshot is taken, then restored.
- `window.fetch` short-circuited for `/api/players/get-or-create` (endpoint returns 500 on this box anyway; avoids multi-minute start delays) — run start becomes instant, `playerId` falls back to "local" as designed.
- Distance ground truth: game HUD score equals meters (multiplier 1, no coins collected on shim runs); freeze-point distances cross-checked against the watcher integral (agrees within ~2 %).

Part 2 additions (same family, all runtime evals, no game source touched):
- fetch short-circuit resolved `{id:"local"}` directly so run start is instant.
- Scripted `Math.random`, stack-differentiated: calls from `createCoinRow` returned 0.1 (coin rows in the player's left lane, 3 coins), from `createObstacle` 0.9 (right-lane truss gantries — beams cannot strike a standing player, so the run survives indefinitely); a second run used constant 0.5 (center-lane low barriers) to end a run by collision on demand.
- rAF watcher sampling per-frame computed styles (screen/vignette/flash opacity, HUD counters, combo `.punch` class + transform matrix) into a trace array.
- rAF freeze (stasher) for static A/B capture of the vignette; inline `opacity` toggle on the vignette overlay for the "off" frame (restored after).
- Offline emulation via playwright-cli `network-state-set offline`; `menu-stats` was force-shown via `classList` for one screenshot (API 500 on this box keeps it hidden — same disclosure as Part 1).
- **Pre-authorized repair applied under scenario "Typeface available offline"** (confirmed live first: SW registered at scope `/js/`, `navigator.serviceWorker.controller === null` on `/`): `git mv client/js/sw.js client/sw.js`; `CACHE_NAME` v2→v3; `ASSETS_TO_CACHE` self-reference `/js/sw.js`→`/sw.js`; `client/js/pwa-register.js` now registers `/sw.js` with `{ scope: "/" }`; stale `dist/js/sw.js` removed; `bun run build:client`; served-vs-disk truncation check passed (5894 = 5894 bytes); freshness ritual (unregister + `caches.delete` + `fetch(..., {cache:'reload'})` per changed asset + reload ×2). First post-repair reload initially ran a stale cached `pwa-register.js` — the server sends `cache-control: public, max-age=86400` on un-hashed assets; the `cache:'reload'` refresh cleared it (see follow-ups).

Part 1 scope: `specs/render-visual-quality/spec.md` — all 18 `#### Scenario` entries are walked (the task brief said 16; the delta contains 18 — all are covered). Part 2 (`specs/hud-ui-presentation/spec.md`, 9 scenarios) follows below.

## Requirement: Lighting-responsive surfaces

- **Surfaces show directional shading** — PASS
  Every building renders with two clearly distinct face tones; e.g. 81-16 (foreground building) lit face luma 90.2 vs shaded face 111.8 (PIL), and 81-12 shows tan-lit vs olive-shaded facades on every building. Character helmet (luma ~171, warm) vs shaded blue body (~93) likewise. Evidence: 81-12, 81-16, 81-20.
- **Materials respond to environment light** — PASS
  Rail head streaks read specular-bright against matte ballast: rail-region luma 132.2 vs adjacent ballast 97.8 (PIL on 81-12); coins render as saturated yellow highlights; train bodies carry a bright livery with dark window glass (81-17 zoom) while ground/buildings stay matte. Night frame 81-10 keeps rail highlights under cool moonlight key.

## Requirement: Track reads as railway

- **Track bed shows ballast and sleepers** — PASS
  81-12 (frozen at 326 m, gameplay camera) shows a gravel-textured ballast bed, evenly spaced brown cross sleepers under three continuous steel rail pairs, per lane and beside the outer rails. Same read at every distance captured (81-10/11/13/14/15/16/20).
- **Track detail repeats seamlessly** — PASS
  Sleeper periodicity measured by dark-band scan of identical track-region columns: 13.6 px/band at 1500 m (run D) vs 14.3 px/band at 1500 m (run D2, independent run) — equal within band quantization; track-region mean RGB identical to ≤0.2/255 between the two runs. Pattern unchanged from 326 m through 6100 m/7050 m captures (no stretching/seams over >5700 m of advance). Note: naive spacing comparison across different-speed frames differs only because FOV widens with speed (projection, not texture stretch).

## Requirement: Recognizable props

- **Train reads as subway car** — PASS
  81-15 + 4× zoom 81-17: liveried light-gray car with black window band (windshield + side windows), roof line, coupled-car gaps, and dark bogie blocks with wheels at rail level under the nearest car. Reads as a subway car at gameplay distance, not a bare box. Weakest element: door outlines are only faintly darker vertical seams at this range.
- **Barrier and overhead are distinct silhouettes** — PASS
  81-20 shows both in one frame: center-lane low barrier (red slatted hazard lattice on the top rail + solid board on two legs; 8× zoom 81-21) and, ~100 m beyond it, the overhead truss signal gantry (portal frame with repeating signal heads; zooms 81-19/81-22, plus a near-field truss gantry with posts in 81-12/81-16). Each is identifiable by silhouette alone.

## Requirement: Character animation states

- **Running cycle** — PASS
  rAF burst (60 frames/0.5 s) contact sheet 81-2x-run-zoom.jpg: across frames 42/208/417 ms the arms and legs occupy visibly different positions (orange hands and red feet swing through stride); grounded throughout.
- **Airborne pose** — PASS
  Jump burst sheet 81-2x-jump-zoom.jpg: pre-jump frame shows the run stride; airborne frames show the body lifted with limbs tucked under (no stride), for the jump's full ~0.8 s airtime (camY evidence: peak 11.0).
- **Roll pose** — PASS
  Roll burst sheet 81-2x-roll-zoom.jpg: mid-roll frames show the character collapsed to roughly half standing height (a compact box, no extended limbs) tumbling through the roll, then restored to standing by roll end. ROLL_DURATION 0.6 s, rollProgress-driven pose.
- **Lane-change lean** — PASS
  Lean burst sheet 81-2x-lean-zoom.jpg: frames during the lateral move show the torso banked toward the target lane while displaced from lane center, then upright again after arrival (input rig: rig.rotation.z eases to ∓LEAN_MAX from `lean` input and back).

## Requirement: Atmosphere progresses with distance

- **Day at run start** — PASS
  81-12 (frozen 326 m into a fresh run): sky/fog daylight blue, mean sky RGB (103.7, 151.4, 191.2); burst frames from ~600–900 m of other runs show the same daylight state; the menu scene renders day as well. (Earliest freezable distance was ~326 m due to CLI latency; ramp is linear to 1500 m so this is unambiguously the day state.)
- **Sunset mid-run** — PASS
  81-13 and 81-14 (two independent runs, each frozen at 1500 m = middle of the 0–3000 ramp): full sunset — orange dome sky, warm key light, pale warm clouds. Sky-region mean RGB (173.4, 65.1, 38.9), clearly distinct from both day (blue, luma 144.1) and night (near-black, luma 3.5).
- **Night with lit windows** — PASS
  81-10 (6100 m) and 81-11 (7050 m): near-black night sky (mean RGB (2.6–2.8, 3.4–3.6, 7.2–7.6)), cool moonlit key; building facades render emissive lit windows — window-region mean (53.3, 42.4, 27.0), luma 43.6 vs 3.7 for sky (~12× brighter, warm). Determinism: night sky means differ by ≤0.4/255 between the two runs.

Determinism (requirement clause "same distance = same sky state"): two independent runs frozen at 1500 m give sky-region deltas of (0.2, 0.8, 0.8)/255 at the dome top and exactly (0.0, 0.0, 0.0) at mid-sky; two independent night runs differ by ≤0.4/255. The ramp is a pure function of distance (atmosphereState) and behaves as such.

## Requirement: Speed-reactive camera

- **FOV grows with speed** — PASS
  `window.__renderStats.fov`: 65.0–65.1 during the first seconds of a run; 75.0 sustained at max speed (speed caps at 40 m/s ≈ 2280 m, observed 65→75 across Run A's log; FOV_MAX = 75 in CONFIG). ΔFOV = +10° ≈ 15%.
- **Landing kick** — PASS
  Scripted jump, per-frame camY trace: rises to 11.0 during the ~0.38 s airtime, then dips to 7.10 (exactly −CAM_KICK_DEPTH 0.9 below the 8.0 follow height) and recovers to 8.0 within 187 ms of dipping below threshold (full kick envelope is the 0.3 s CAM_KICK_TIME sine) — a brief dip, recovered within a fraction of a second.

## Requirement: Visual performance budget

- **Desktop frame rate holds** — PASS
  Watcher frame-time samples: Run A 44,624 in-run samples — fps median 120, min 93; Run C 35,611 samples — median 120, min 88; Run G (real spawns) 1,081 samples — median 120, min 68. Display is 120 Hz; sustained rate is ~2× the 60 FPS requirement on desktop.
- **Draw calls bounded** — PASS
  Budget = 1.5 × pre-overhaul baseline 153 = 230. Shimmed long runs (0→6100 m / →7050 m): median 88–89, p90 90–94, max 96–100 per frame (44k/35k samples). Unbiased 9 s real-spawn sample (both sides of buildings populated, mixed props): median 110, p90 113, max 131. Worst observed frame (131) is still under even the raw 153 baseline; caveat: the honest sample is early-run (z≈0–130 m); the long-run samples cover all distances but with one-sided building spawns (which understates building draw calls by roughly the recent-agent cross-check delta — their both-side medians ≈104–126 vs our 88–89, same ballpark, same conclusion).
- **No new network origins** — PASS
  `performance.getEntriesByType('resource')` after a full session: origins are exactly `http://localhost:3001` (11 requests: html/js/css/fonts/icons) and `https://cdn.jsdelivr.net` (5 requests, all three.js 0.172.0 module files: three.module.js, three.core.js, RoomEnvironment.js, BufferGeometryUtils.js, RoundedBoxGeometry.js — the pre-existing importmap CDN). No fonts.googleapis/gstatic or any other origin. Fonts are served same-origin from dist/fonts/.

---
Part 1 tally: 18 PASS / 0 FAIL / 0 FOLLOW-UP (of 18 render-visual-quality scenarios walked; task brief said 16 — the delta contains 18 scenarios and all were executed)

---

# Part 2 — hud-ui-presentation

## Requirement: Game typography and icons

- **Title uses display typeface** — PASS
  `document.fonts.check('16px Bungee')` → true, `document.fonts` holds one face ("Bungee/loaded") sourced from same-origin `/fonts/Bungee-Regular.woff2` (the only font resource; no font CDN — consistent with Part 1's origin check). `.title-main` computed family starts "Bungee, …". Canvas measureText of "SURFERS" at 64px: Bungee 307.5 px vs the fallback stack 267.8 px (~15 % wider glyphs) — the rendered face is distinguishable from the system default. Visual pair (temporary inline font-family toggle on `.game-title`, restored after): 81b-1a-title-bungee.png (chunky rounded slab letterforms) vs 81b-1a-title-fallback.png (thin condensed system sans).
- **Coin indicator is vector, not emoji** — PASS
  `#coins-display`'s indicator is an inline `<svg>` (`namespaceURI` http://www.w3.org/2000/svg, 16×16, `class="icon icon-coin"`); the document contains exactly 5 `svg.icon` (2× coin, 2× trophy, 1× flag). A `\p{Extended_Pictographic}` scan over the `innerText` of `#hud`, `#menu-screen` and `#gameover-screen` finds zero emoji. The game-over COINS stat uses a text label + numeral (no glyph at all); the vector coin requirement is carried by the HUD (and menu stats). Evidence: 81b-1b-menu-stats.png (stats force-shown via classList — disclosed), 81b-1b-hud-coin.png (live HUD during play), 81b-2b-gameover.png.
- **Typeface available offline** — PASS (after the pre-authorized repair; method + result below)
  Pre-repair live confirmation of the known bug: registration scope `http://localhost:3001/js/` (script `/js/sw.js`) with `navigator.serviceWorker.controller === null` on `/` — the worker never controlled the app, so no cached offline load was possible (app-wide, pre-existing). Repair applied as authorized: SW moved to root (`client/sw.js`, cache bumped `subway-surfers-v3`, self-reference updated), `pwa-register.js` registers `/sw.js` with `{ scope: "/" }`, stale `dist/js/sw.js` removed, rebuilt, truncation check OK, freshness ritual run. Post-repair online state: controller `/sw.js` (activated), scope `/`, cache `subway-surfers-v3` contains `/`, `/index.html`, `/css/style.css`, **`/fonts/Bungee-Regular.woff2`**, `/js/game.js`, all 5 `js/visual/*` modules, and — runtime-cached now that the fetch handler sees page requests — all 5 three.js CDN module files (three.module.js, three.core.js, RoomEnvironment.js, BufferGeometryUtils.js, RoundedBoxGeometry.js).
  Offline verification (playwright-cli `network-state-set offline` → reload): an uncached-URL probe `fetch('/not-cached-probe-…')` rejects with "Failed to fetch" (network genuinely cut; `navigator.onLine` stays true under this emulation and was not used as evidence), and `performance` entries show `transferSize: 0` with `decodedBodySize > 0` for the document and every resource — woff2 15,160 B from cache, game.js 31,245 B, three.core.js 754,325 B, three.module.js 575,699 B, etc. — i.e. the entire boot came from the SW cache. The menu renders and `document.fonts.check('16px Bungee')` → true with the title drawn in Bungee (81b-offline.png). Note the scenario's scope is the typeface; in fact the full game boots offline including three.js, but only because the CDN modules were runtime-cached during a previous controlled online visit — a first-ever visit with no network still cannot install the SW (inherent PWA behavior, not a regression).

## Requirement: Animated screen transitions

- **Run start transition** — PASS
  Per-frame opacity trace (rAF, ~120 Hz) around PLAY: menu-screen opacity 0.99 at t=5566 ms → 0.96 (5574) → 0.02 (5806); the HUD fades in in the same window (0.01 → 0.98). Effective fade ≤300 ms (CSS `transition: opacity 0.3s ease`), well inside the ~0.5 s cap. Mid-fade samples are skipped by a one-off 232 ms main-thread stall at scene start — the CSS fade runs on the compositor and completes regardless (next sample already at 0.02).
- **Game-over transition** — PASS
  gameover-screen opacity rises 0.014 → 0.998 across 34 consecutive frames (t=8241 → 8515 ms, ≈274 ms ≈ the 0.3 s transition) — an animated fade-in, not an instant toggle.

## Requirement: Score and combo feedback motion

- **Score counts up** — PASS
  Around the first three coin pickups (t=8005/8071/8146 ms; +10 score each, distance score adds only ~+1–2 per 4-frame sample window): displayed score walks 2 → 4, 10, 14, 16, 22, 25, 27, 28, 29 — 8+ intermediate values with monotonically decelerating increments (the exponential-approach tween in ui-motion.js, settle ~300 ms). No pickup ever snaps the display by +10 in one frame.
- **Combo pulses** — PASS
  18/18 combo increases while the display was visible re-triggered the punch (`.punch` class + `combo-punch` 0.2 s animation re-armed via remove/reflow/re-add). Sampled transform scale per pulse: 1 → 1.094 → 1.165 → 1.22 → **1.249** → 1 (keyframe peak 1.25 at 35 %). On the last coin of a row the pulse runs clean to completion; coins ~70 ms apart re-punch and truncate the previous return — each increase restarts the scale pop, as specified.

## Requirement: Damage feedback

- **Crash flash** — PASS
  Scripted crash (constant-0.5 random → center-lane low barrier, idle player, collision at 39 m): `#damage-flash` (fixed, inset 0, z 30, red radial gradient) jumps to opacity **0.55** at t=8224 ms and decays to 0 by ≈8566 ms (~342 ms; keyframes 0.55→0 over 0.35 s). The game-over screen starts fading in at t=8241 (flash still ≥0.5) and completes ≈8515 — the red flash covers the screen and fades out exactly "as the game-over screen animates in", tinting it.

## Requirement: Play vignette

- **Vignette visible in play** — PASS
  During play `#play-vignette` is present with computed `radial-gradient(rgba(0,0,0,0) 42%, rgba(0,0,0,0.38) 100%)`, z-index 5 (under the HUD's z 10), opacity 1, pointer-events none. rAF-freeze A/B capture (same rendered frame, overlay toggled): corners lose 31–41 luma with the vignette on (top-left 126.2→95.2, top-right 123.7→92.0, bottom corners 143.5→102.8) while the center box is bit-identical (luma 98.5 = 98.5). HUD stays fully legible in both frames (score, vector coin count, combo all crisp — the gradient is transparent to 42 % radius). Evidence: 81b-5-vignette-on.png / 81b-5-vignette-off.png. Caveat, not a failure: absolute edge-vs-center luma is scene-dependent — with a bright sky at the bottom corners the edges there remain brighter than the center even darkened; the overlay's edge-only darkening is what the A/B pair proves.

Part 2 tally: **9 PASS / 0 FAIL / 0 FOLLOW-UP** (all 9 hud-ui-presentation scenarios walked)

---

# Combined summary (task 8.1)

| Part | Spec delta | Scenarios | PASS | FAIL | FOLLOW-UP |
|---|---|---|---|---|---|
| 1 | render-visual-quality | 18 | 18 | 0 | 0 |
| 2 | hud-ui-presentation | 9 | 9 | 0 | 0 |
| **Overall** | | **27** | **27** | **0** | **0** |

**Repair applied (authorized, scenario "Typeface available offline"):** pre-existing SW scope bug — the worker was registered from `/js/sw.js` (scope `/js/`) and never controlled `/`, breaking offline/PWA behavior app-wide. Fixed by moving the SW to root scope: `client/js/sw.js` → `client/sw.js` (cache `subway-surfers-v3`, self-reference `/sw.js`), `client/js/pwa-register.js` registers `/sw.js` with `{ scope: "/" }`; dist rebuilt; verified online (controller + scope + cache contents) and offline (network cut, all bytes from cache, Bungee renders).

**Follow-ups (none block a scenario; listed with what would resolve each):**
1. **Stale-asset window on redeploy** (observed during the freshness ritual): assets are served un-hashed with `cache-control: public, max-age=86400`, so a client can run a day-old `pwa-register.js`/`game.js` after a deploy. **FIXED post-walkthrough (2026-09-23)**: the SW fetch handler was changed to network-first for same-origin GETs (cache still answers offline; cross-origin three.js CDN stays cache-first), `CACHE_NAME` → v4; verified fresh `game.js` served after reload and the offline boot/font check still passes.
2. **First-visit offline** is impossible by design (a SW can only control pages after its first controlled load); if true cold-start offline matters, resolve via a documented install/precache step — no code change needed for the current spec.
3. **Mobile perf clause** (carried from Part 1): the 30 FPS mid-range-mobile requirement was not exercised on hardware; resolve with a device/emulated-CPU throttled pass. Desktop and draw-call/origin clauses were verified.
