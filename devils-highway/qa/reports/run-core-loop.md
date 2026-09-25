# run-core-loop — QA report (running; append per task)

Environment for all numbers below: headless Chromium + SwiftShader
(`--use-angle=swiftshader --enable-unsafe-swiftshader`), 1600×900, dpr 1,
`?qa=1` (auto-tier-down disabled), tier autodetect → software-GL cap →
**medium** (bloom+grade on, MSAA 2, 1024 PCFSoft shadows). Host: macOS arm64.
Raw own-JS: 204,874 bytes (`wc -c` over `js/**/*.js`; bible 150 KB, amended
working cap 320 KB — see design.md decision 10). Baseline date: 2026-09-24.

## Task 1.1 — SwiftShader fps gap baseline

Official captures (`bun .qa/shot.mjs`, JSON reports with `consoleErrors: []`,
PNGs in `.qa/shots/baseline/`). Note: shot.mjs samples `__PERF` immediately
after `screenshotReady` (only 5 warm frames), so its fps figure still contains
shader-compile stalls — the settled in-page numbers come from the probe below.

| scene | url params | shot __PERF fps | drawCalls | tris | raw JS (B) | date |
|---|---|---|---|---|---|---|
| menu | `qa=1&scene=menu` | 1.5 (warmup-polluted) | 209 | 64,275 | 204,874 | 2026-09-24 |
| menu | `qa=1&scene=menu&time=night` | 1.3 (warmup-polluted) | 224 | 74,171 | 204,874 | 2026-09-24 |
| game | `qa=1&scene=game` | 1.4 (warmup-polluted) | 201 | 70,999 | 204,874 | 2026-09-24 |
| game | `qa=1&scene=game&time=night` | 1.6 (warmup-polluted) | 229 | 74,041 | 204,874 | 2026-09-24 |

Probe (new `.qa/perf_probe.mjs`: same browser flags as shot.mjs; waits for
screenshotReady + 3 s settle, then counts rAF frames with NO capture, then
counts frames while screenshotting continuously — ~1174 ms per 1600×900 PNG):

| scene | url params | in-page fps (idle, rAF-counted) | capture fps (during shots) | drawCalls | tris | raw JS (B) | date |
|---|---|---|---|---|---|---|---|
| menu | `qa=1&scene=menu` | 6.12 (worst frame 383 ms) | 7.03 | 206 | 65,357 | 204,874 | 2026-09-24 |
| menu night | `qa=1&scene=menu&time=night` | 6.76 (worst 183 ms) | 6.75 | 250 | 73,289 | 204,874 | 2026-09-24 |
| game | `qa=1&scene=game` | 7.78 (worst 183 ms) | 6.87 | 190 | 62,067 | 204,874 | 2026-09-24 |
| game night | `qa=1&scene=game&time=night` | 7.65 (worst 417 ms) | 6.93 | 210 | 61,611 | 204,874 | 2026-09-24 |
| menu (earlier run) | `qa=1&scene=menu` | 4.91 (worst 517 ms) | 5.62 | 220 | 75,265 | 204,874 | 2026-09-24 |

Run-to-run variance under SwiftShader is ~±25% (host load); the verdict is
unaffected by it.

### Verdict: the gap is REAL (in-page rendering cost), not capture overhead

Settled in-page fps with no capture running (5–8) equals or beats fps measured
while screenshotting continuously (5.6–7.0); screenshots cost ~0.9–1.2 s of
wall clock each but do not depress the frame rate. The design doc's "~4–5 fps
observed" is confirmed as genuine SwiftShader render cost (our settled range:
5–8 fps vs the ≥18 fps bible target).

Lever ladder measured (menu dusk, probe idle fps):

| configuration | idle fps | delta vs medium | visual cost |
|---|---|---|---|
| medium (software default: shadows 1024 + bloom + grade + MSAA 2) | 4.9–6.1 | — | none (art-bar look) |
| medium with MSAA 2→0 (temp test, reverted) | 4.6 | none (noise) | (aliasing, no perf pay) |
| low (shadows on, post OFF, 165 draws) | 7.9 | +62% | grade/bloom gone — art-fatal |
| low + shadowsEnabled false (temp test, reverted; 97 draws) | 13.3 | +168% | dusk key shadows gone — art-fatal |

What was done: **no visual trims landed** — measured evidence shows none reach
18 fps without gutting the art direction (even post-off + shadows-off +
post-off bottoms out at 13.3 fps), MSAA is free in SwiftShader, and
chunk-dressing density cuts would trade visible art for single-digit % (real
draw reduction belongs to task 1.2's merge). Per the design-doc risk note this
escalates to a budget discussion instead of shipping blind. App code is
byte-identical to baseline (git diff on `js/` clean).

Cost split implied by the ladder (medium ≈ 200 ms/frame): bloom+grade ≈ 77 ms
(38%), shadow depth pass ≈ 68 draws / ~40% of base raster, ~110 real scene
draws. Next levers, in order of value: (1) shadow-caster whitelist (hero-range
objects only) — attacks the measured 40% shadow-pass share without killing
dusk shadows; (2) task 1.2 scatter/debris merges (~30+ draws); (3) a
software-tier preset that keeps grade but drops bloom (~-38% frame cost).
Even all three combined project to ~12–15 fps — the "≥18 fps under
SwiftShader at 1600×900" bible budget likely needs revision (e.g. fps gate on
real GPU + SwiftShader as smoke-only, or a lower-res SwiftShader gate).

### Console noise (all captures/probes)

`consoleErrors: []`, `pageErrors: []` everywhere. Every capture shows exactly
4 identical `[WebGL] GL Driver Message ... GPU stall due to ReadPixels`
warnings — ANGLE/SwiftShader driver performance notices fired during BOOT
(probe confirms they exist before any screenshot; readRenderTargetPixels has
no app-code caller — sky.js deliberately avoided readback). They are
environment noise on the software driver, not app warnings, and cannot be
suppressed from app code.

### Flags for later tasks

- Task 1.2: night menu drawCalls measured 224–250 (dusk 206–220) — the night
  streetlight kit pushes the attract scene past the 220 cap; merge work must
  cover night, not just dusk.
- shot.mjs `__PERF.fps` is warmup-polluted (5 warm frames < the 2 s perf
  window); for fps reporting use `.qa/perf_probe.mjs` (3 s settle) or wait ≥
  2.5 s after screenshotReady.

## Task 1.2 — draw-call audit + dressing merge

Date: 2026-09-24. New tool: `.qa/draw_audit.mjs` (same browser flags as
shot.mjs) + a QA-gated `window.__QA_AUDIT = { scene, camera, renderer }`
hook in main.js. Method: tag every renderable with an `onBeforeRender`
counter (three r172 fires it once per render item = once per material-group
draw; the shadow depth pass does NOT call it), do one direct
`renderer.render(scene, camera)` after `info.reset()`, and derive
`shadow = direct total − counted main` and `post = __PERF.drawCalls − direct`.
Probe frame totals reproduce the shot.mjs numbers (±run variance), so the
per-group split below is representative of the official captures.

### Audit table — menu attract, dusk (8 active chunks; main pass = RenderPass scene draws)

| material group | before | after | what changed |
|---|---|---|---|
| paintedMetal | 17 | 4 | rails 8→1, posts 8→1, sign backings →1 (vehicles keep trim) |
| rust | 16 | 11 | streetlights ~7→1, sign posts →1 (rest = vehicle trim, untouched) |
| rock | 12 | 3 | boulders 8→1, mesas ~4→≤3 (one mesh per lathe variant) |
| MeshBasicMaterial | 9 | 3 | reflectors 8→1 (night: lamp pools + sign spills also →1 each) |
| scrub | 7 | 1 | per-chunk scrub meshes → one pooled mesh |
| rubber / rimMetal | 3 / 3 | 1 / 1 | wheels → one pooled 2-group mesh |
| contactShadow | 3 | 1 | hull contact shadows → one pooled mesh |
| charred | 5 | 3 | debris → one pooled mesh (rest = vehicle scorch, untouched) |
| signGuide | 2 | 1 | sign panels → one pooled mesh |
| vehicle groups (paints, glassA/B, interior, reflector, taillight, dotTape) | ~40 | ~40 | intentionally untouched (hero hulls stay chunk-local) |
| **main pass total** | **113** | **69** | **−44** |
| shadow pass total | 76 | 63 | posts/streetlights/wheels collapse to one draw each |
| post (bloom+output+grade) | 16 | ~15–20 | unchanged pipeline (±probe timing residual) |
| **frame total (renderer.info)** | **205** | **152** | shot.mjs: **206–209 → 163** |

Night (`&time=night`, 8 active chunks): lamp heads (emissiveStrip 5→1) and
lit lamp/sign pools also merge, so night saves more: **main 128 → 75**,
shadow 85 → 69, frame **228 → 159**; shot.mjs: **224–250 → 164**.
Game scene (`&scene=game`, drive rig — more chunks in frustum): main
159 → 91, shadow 54 → 37, frame **228 → 138**; shot.mjs: **190–201 → 163**.

Post-merge instance counts at menu dusk (all inside preallocated caps sized
for the worst-case window, 1 + maxChunksBehind + maxChunksAhead = 8 chunks):
rails 16, posts 160, streetlights 7, scrub 158, rocks 72, mesas 9, reflectors
160, wheels 70, contact shadows 14, debris 32, sign posts 6 / backings 3 /
panels 3. Night adds lamp heads 4, lamp pools 4, sign spills 3.

### What landed

- `js/world/chunks.js`: new `createDressingPool()` — one world-owned
  `InstancedMesh` per material group (the shambler-manager pattern scaled to
  static dressing) with `sync(active)` that rewrites preallocated instance
  buffers ONLY when the streamed chunk set changes (early-out on unchanged
  key; zero per-frame / zero per-chunk allocation). Chunk factories now
  `record()` seeded placement streams on `group.userData.dressing` at build
  time (rng draw order untouched — captures stay reproducible); pooled chunk
  reuse replays the same stream, exactly like geometry reuse. Vehicle hulls
  stay per-chunk instanced meshes (paint-variant bucketing is per-build).
- `js/world/world.js`: adds the pool group to the scene and calls
  `this._dressing.sync(this._active)` after streaming (sync self-gates).
- `js/main.js`: QA-only `window.__QA_AUDIT` hook (?qa=1).
- Raw own-JS: 204,874 → 211,262 B (+6.4 KB; amended cap 320 KB).

### Verification (shot.mjs, 1600×900, consoleErrors [] and pageErrors [] everywhere)

| capture | drawCalls before → after | tris before → after |
|---|---|---|
| menu dusk `?qa=1&scene=menu` | 206–209 → **163** | 64–75k → 87k |
| menu night `…&time=night` | 224–250 → **164** | 73–74k → 88k |
| game dusk `?qa=1&scene=game` | 190–201 → **163** | 62–71k → 86k |
| menu dusk, seed=1 A/B | 214 → **147** | 61k → 82k |
| menu night, seed=1 A/B | 243 → **159** | 71k → 86k |
| staged=beauty | — → **157** | — |

All ≤ 220 with ~57 draws of headroom for the gameplay systems (tasks 3.x/4.x
add ~8–10). Tris rose ~15–20 k because pool meshes are frustumCulled=false —
instances previously culled off-frame now always draw (identical pixels,
same rule the shambler mesh already used); worst case 88k vs the 500k cap.

### Visual regression: none (same-seed A/B pixel diffs at/below the run-to-run noise floor)

Baseline PNGs used time-based seeds, so the check is a same-seed before/after
A/B (old code restored from git, `&seed=1`, 1600×900) measured against the
noise floor of two same-code runs (dust motes are unseeded + shambler/camera
animation timing jitter):

| pair | mean abs diff (0–255) | % pixels > 8 |
|---|---|---|
| noise floor: new vs new (dusk) | 1.073 | 0.52 |
| old vs new (dusk) | **0.205** | **0.46** |
| noise floor: new vs new (night) | 1.636 | 1.94 |
| old vs new (night) | **1.679** | **2.12** |

Both old-vs-new diffs sit at/below their same-code floor — differences are
animation jitter, not rendering changes. Eyeball check vs
`.qa/shots/baseline/`: menu framing, convoy hero reads, night lamp pools +
lit bus glow + sign spill all unchanged; `staged=beauty` hero framing intact
(spare wheel, contact shadows, sign, guardrail all present via the pool).

### Known limitations

- Vehicle hull groups (~40 of the remaining 69 menu main-pass draws) are the
  next merge candidate if gameplay budget ever tightens; out of scope here.
- Pool meshes skip per-chunk frustum culling (small tri increase, above).
- The 1.1 SwiftShader fps verdict stands: this merge cuts draw/overhead cost,
  but that frame cost is fill/shader-bound, so in-page fps is unchanged.

## Task 2.1 — input

Date: 2026-09-24. Gameplay bindings added to `js/core/input.js`; menu path
untouched. Raw own-JS: 211,262 → 214,193 B (+2.9 KB; amended cap 320 KB).

### What landed

- `js/core/input.js`: new `GAME_KEYS` map emitting the same action strings as
  touch/design 6 on the existing `onAction(action, code)` channel. Keyboard is
  edge-triggered (the keydown path already dropped `e.repeat`; verified one
  emission per physical press, including a 900 ms OS-auto-repeat hold).
  Touch: single-gesture pointerdown/pointerup tracking (pointerId-guarded,
  `pointercancel` clears); dominant axis picks the action; below-threshold
  release emits `tap`. `preventDefault` on mapped keys keeps arrows/Space
  from scrolling or re-activating focused UI buttons. `setEnabled(false)` now
  also drops an in-flight gesture. Single new `_emit()` funnel (also feeds the
  QA trace). `onAction` signature and all menu emissions unchanged.
- Escape is deliberately DUAL: one press emits **`pause` first, then `back`**
  (menu path byte-compatible with today: in GAME, `back` still exits to menu;
  task 2.2 owns the state-based routing change). No gameplay action is
  swallowed or duplicated — each press = exactly one `_emit` per contract.
- `js/core/config.js`: `INPUT: { swipePx: 24 }` — the only input tunable;
  edge semantics are structural (e.repeat drop, one action per pointerup),
  no timing constants needed by design 6 (no swipe-duration cap specified).
- `qa/hooks.js`: QA-gated `window.__QA_ACTIONS = []` (?qa=1 only); input.js
  mirrors every emission there as `{ t, action, code, dx, dy }`. KEPT
  permanently (QA-only, zero cost in play) — task 2.2 routing verification
  reads the same trace. No console output.
- `styles.css`: `touch-action: none` on `html, body` — gameplay swipes must
  not be stolen by browser pan/zoom when they START over the full-viewport
  `.screen` overlays (only `#gl` had it; html/body already had
  `overflow:hidden` + `overscroll-behavior:none`).

### Action-string contract (for task 2.2 routing)

| input | action | notes |
|---|---|---|
| A / ← | `left` | edge-triggered, key code in `code` |
| D / → | `right` | |
| W / ↑ / Space | `jump` | preventDefault'd (no scroll, no button re-click) |
| S / ↓ | `slide` | |
| Esc | `pause` **then** `back` | dual emission, same keydown; state decides meaning |
| swipe horizontal (dominant axis) | `left` / `right` | code `touch`, dx/dy in trace |
| swipe vertical (dominant axis) | `jump` (up) / `slide` (down) | |
| release under swipePx | `tap` | zone/pause-chip consumption is task 2.3/5.1 |
| pointerdown (unchanged) | `pointer` | audio unlock path preserved |

Today nothing consumes gameplay actions (`left/right/jump/slide/pause/tap`
fall through main.js's handler inertly) — emitting them is menu-neutral.

### Verification (`bun .qa/input_probe.mjs`, new probe; real CDP keyboard +
touch events, 800×600, `?qa=1&scene=menu`, reads `__QA_ACTIONS` + DOM state)

- `ok: true`, zero problems: 1/2 select updates the cards; Enter starts GAME
  (menu hides, gameui shows); Esc in MENU leaves the menu on; every gameplay
  key emits exactly its action exactly once (per-key entry-count checks);
  900 ms held A adds exactly ONE `left` (repeat dropped); Esc in GAME emits
  `pause`+`back` and returns to menu (today's unchanged path).
- Touch (CDP `Input.dispatchTouchEvent`): −90 px → `left`, +90 px → `right`,
  −90 px → `jump`, +90 px → `slide`, 0 px → `tap` (code `touch`, deltas
  logged; tap did not hit the back chip).
- Non-QA path (no `?qa=1`): `__QA_ACTIONS` absent, menu select/start/Esc-back
  all work — identical behavior.
- Captures re-run (`shot.mjs` 1600×900): menu `ready:true` drawCalls 147 /
  tris 83k, game 143 / 91k — inside the post-merge 1.2 ranges. Console:
  `consoleErrors: []`, `pageErrors: []` everywhere; only the 4 documented
  ANGLE/SwiftShader boot notices (task 1.1: environment noise, pre-existing).

## Task 2.2 — state machine

Date: 2026-09-24. GAMEOVER added as a real state + PAUSED as a state-gated
flag inside GAME (design decision 1); action routing by state (design 6). Raw
own-JS: 214,193 → 218,538 B (+4.3 KB; amended cap 320 KB).

### What landed (`js/main.js` unless noted)

- `State = { LOADING, MENU, GAME, GAMEOVER }`; `paused` is a boolean overlay
  flag meaningful only inside GAME (`setPaused(on)` is state-gated and
  idempotent, mirrors into `window.__QA.paused`). `runStats` (run summary,
  null outside GAMEOVER) and `runStartZ` (fresh-run distance baseline) added.
- Transitions: `enterGame(mode)` now starts a FRESH run (clears
  `paused`/`runStats`, re-baselines `runStartZ`); `retryRun()` — GAMEOVER
  confirm → fresh GAME, same mode (full pooled `world.reset()` retry lands in
  task 2.4; the transition machinery exists and is verified); `endRun(stats)`
  — the shell-level death path (task 4.3's mode calls this; GAME-only guard,
  computes deterministic default stats `{ distance, pickups, score }` from
  the dolly delta, caller stats override via spread); `enterMenu()` is the
  quit path (unchanged).
- GAMEOVER semantics: `fixedUpdate` advances the dolly in GAME only, so the
  dolly halts while the world keeps rendering (death-reveal framing); the
  mode rig is held in GAMEOVER (no camera snap; menu rig still used in
  LOADING/MENU). Ambient sway/grain keep animating (simTime advances).
  `gameui` chips stay on (shell chrome; the screen itself is task 2.4).
- Action routing by state (single `routeAction(action)` funnel): see tables
  below. Esc's dual emission ("pause" then "back", input.js) resolves inside
  GAME as ONE toggle: "pause" toggles, "back" is consumed — a live run is
  never exited by Esc (game-shell spec). In GAMEOVER Esc quits to MENU.
  Menu keys unchanged: 1/2/3 select (+ live mode switch in GAME, as before),
  Enter confirms in MENU. `mode-N` is ignored in GAMEOVER (retry keeps the
  dead run's mode).
- Stub mode shim `activeMode` (`handleAction/fixedUpdate/update`, no-ops):
  the shell already routes gameplay actions and fixed/render ticks through
  the Mode surface, so task 4.3 plugs the real RUN mode in without touching
  this routing again.
- `visibilitychange` now routes through `setPaused` and is GAME-gated
  (auto-pause on tab hide; resume + `lastTime` reset on return). The pause
  UI is NOT here (task 2.3); the trigger is real.
- QA staging: `?scene=paused` boots into GAME and auto-pauses at the
  `screenshotReady` flip (so the stream queue still drains; same variance
  class as `freeze=1`); `?scene=gameover` boots into GAME, runs the existing
  `?time=S` fast-forward, then `endRun()` — stats are boot-deterministic
  (see evidence). `qa/hooks.js`: scene param accepts `menu|game|paused|gameover`
  (raw value echoed in `window.__QA.scene`); `window.__QA.paused` added.
- FIX (latent, exposed by the new gameover staging): `const FIXED` was
  declared in the main-loop section, AFTER boot's `fastForward(qa.time)`
  call — any numeric `&time=S` load threw
  `ReferenceError: Cannot access 'FIXED' before initialization` and died
  mid-boot. The const moved up to the sim state block (dusk/night `&time=`
  was unaffected, which is why captures never hit it).
- `.qa/input_probe.mjs`: the two "Esc in GAME returns to menu" expectations
  updated to the new deliberate contract (Esc pauses, second Esc resumes,
  gameui never drops); everything else untouched — probe re-run green.

### States / flags

| state / flag | meaning | dolly | render |
|---|---|---|---|
| LOADING | boot | — | — |
| MENU | attract | cruises at `CRUISE.menu` | live |
| GAME (`paused=false`) | live run | advances at `CRUISE[mode]` | live |
| GAME (`paused=true`) | PAUSED overlay flag | frozen (sim skipped entirely) | live |
| GAMEOVER | run ended | frozen (`fixedUpdate` gates on GAME) | live, mode rig held |

### Transition table

| from | trigger | to | notes |
|---|---|---|---|
| MENU | confirm (Enter / card click) | GAME fresh | `enterGame` (unchanged UX) |
| GAME | `endRun(stats)` (mode death, task 4.3) | GAMEOVER | stats default deterministic; paused cleared |
| GAME | `?scene=gameover` boot + `?time=S` | GAMEOVER | staged; `stagedGameOver` path |
| GAMEOVER | confirm-style confirm: Enter (`confirm`) or Space (`jump`) | GAME fresh, same mode | `retryRun()` |
| GAMEOVER | `back` (Esc) / back-btn click / `__QA_SHELL.quit()` | MENU | quit path |
| GAME | `pause` action (Esc / future touch chip) | GAME paused | `setPaused(true)` |
| GAME paused | `pause` again | GAME (resumed) | one Esc press = one toggle |
| any | `visibilitychange` (hide) | GAME paused | GAME-gated auto-pause |

### Action routing table (design 6)

| action | MENU | GAME unpaused | GAME paused | GAMEOVER |
|---|---|---|---|---|
| `left/right/jump/slide` | ignored | → `activeMode.handleAction` (+ `__QA_SHELL.routed`) | ignored | `jump` retries |
| `pause` | ignored | toggle pause | toggle pause (resume) | ignored |
| `back` | ignored (as today) | CONSUMED (Esc must never exit a live run) | CONSUMED (keeps toggle single) | → MENU |
| `confirm` | starts mode (today) | ignored | ignored | retries |
| `mode-1/2/3` | select (today) | select + live `setMode` (today) | same (select only until resume) | ignored |
| `tap` / `pointer` | pointer = audio unlock (today) | tap unrouted yet (zones: tasks 2.3/5.1) | ignored | ignored |

### QA hooks added (exact names/signatures)

- `window.__QA_SHELL` (ONLY under `?qa=1`, same rule as `__QA_AUDIT`):
  - `state() -> "loading"|"menu"|"game"|"gameover"`, `paused() -> bool`,
    `stats() -> null|{distance,pickups,score,...}`,
    `dolly() -> {z, prevZ, simTime, speed}`, `frames` (rendered-frame count),
    `routed` (capped array of gameplay actions delivered to the mode shim),
  - `endRun(stats?)` — death injection (stats override the computed defaults),
  - `retry()` — GAMEOVER → fresh GAME, `quit()` — GAMEOVER → MENU.
  Tasks 2.3 (pause chip/resume + paused capture), 2.4 (Retry/Menu buttons,
  retry timing) and 4.3 (mode calls `endRun(stats)` on death) consume this.
- `window.__QA.paused` — live PAUSED mirror, kept current by `setPaused()`.
- `window.__QA.scene` now echoes `paused`/`gameover` for those stagings.

### Verification evidence

`.qa/state_probe.mjs` (new; real CDP keys + `__QA_SHELL`, 800×600,
`ok: true`, `problems: []`, `consoleErrors: []`, `consoleWarns: []`,
`pageErrors: []`, `envNoiseWarnings: 4` — the documented ANGLE boot notices):

- MENU: Esc does NOT pause; 1/2 select; Enter → GAME (menu keys unchanged).
- GAME: dolly advances (numerically, +Δ z over 350 ms); `a` and Space each
  increment `__QA_SHELL.routed` (actions reach the mode shim).
- Esc → paused: `z` AND `prevZ` AND `simTime` bit-constant across 400 ms,
  frames still increment (rendering continues), gameui stays, no menu,
  `__QA.paused` mirror true; gameplay keys while paused add zero routed
  actions; second Esc resumes (one press = one toggle) and the dolly
  advances again.
- Death injection `endRun({distance: 4321})` → GAMEOVER: stats report the
  injected override verbatim (`{"distance":4321,"pickups":0,"score":0}`),
  dolly bit-constant across 700 ms, frames still increment (world renders
  behind), no menu. Default `endRun()` measures the run's own distance.
- Retry: Enter retries → GAME, stats cleared, dolly advances; Space retries
  too; Esc in GAMEOVER → MENU; `__QA_SHELL.quit()`/`retry()` both fire the
  same transitions.
- `?scene=paused&mode=run&seed=7`: boots to GAME paused at the ready flip,
  dolly frozen, rendering continues, `__QA.scene` reports `paused`.
- `?scene=gameover&mode=run&time=5&seed=7`: boots ENDED with
  `distance: 38` (`round(7.5 × 5)`) and `dolly.z === 57.5` exactly — the
  staged run ends during boot, before the first wall-clock frame.
- Same-seed pair (`scene=gameover&mode=drive&time=7&seed=42`, two loads):
  identical `dolly.z` (202 within 1e-12 float accumulation), identical
  `stats.distance` (182), identical `__WORLD.chunks`.

Captures (shot.mjs, 1600×900, SwiftShader medium, all `ready: true`,
`consoleErrors: []`, `pageErrors: []`, exactly the 4 documented env notices):

| capture | url | drawCalls | tris |
|---|---|---|---|
| paused dusk | `?qa=1&scene=paused&mode=run&seed=11` | 153 | 84,337 |
| gameover dusk | `?qa=1&scene=gameover&mode=run&time=8&seed=11` | 151 | 83,963 |
| gameover night | `?qa=1&scene=gameover&mode=run&time=night&seed=11` | 164 | 84,347 |
| menu regression | `?qa=1&scene=menu` | 148 | 86,033 |
| game regression | `?qa=1&scene=game` | 143 | 80,725 |

All ≤ 220 draws (inside the task 1.2 post-merge ranges). PNGs in
`.qa/shots/2.2/`: world halted behind the run rig with only the shell chips
visible — no pause/gameover UI (deliberately out of scope here).

### Contract notes for tasks 2.3 / 2.4 / 4.3

- 2.3: the touch pause chip should emit the existing `pause` action — it
  toggles and needs no new plumbing; `visibilitychange` auto-pause trigger
  is already live behind `setPaused` (the overlay screen is what's missing).
  `?scene=paused` already stages a settled paused capture.
- 2.4: Retry = `retryRun()` (or any confirm-style emission), Menu = 
  `enterMenu()` / `__QA_SHELL.quit()`; instant-retry's pooled
  `world.reset()` + seed re-init plugs into `enterGame()`. GAMEOVER stats
  are in `runStats` (`__QA_SHELL.stats()`); screen root must hide the
  `gameui` chips or layer over them.
- 4.3: the mode reports death by calling shell `endRun(stats)` (QA-gated
  reach: `__QA_SHELL.endRun`); gameplay actions arrive via
  `activeMode.handleAction` (action strings per the 2.1 table); the mode's
  fixed/render ticks are called only in GAME and only unfrozen.
- Known limitation: `?scene=paused` dolly position varies by warm-frame
  timing (same variance class as `freeze=1`); `scene=gameover` is the fully
  deterministic stage. Deterministic stat injection beyond
  distance/pickups/score defaults is deferred to 6.1.

## Task 2.3 — pause UI

Date: 2026-09-24. `js/ui/pause.js` (PauseUI: Resume/Restart/Quit overlay,
menu.js `.screen` pattern) + wiring; auto-pause on tab hide now leaves the
overlay up for an explicit RESUME. Raw own-JS: 218,538 → 221,466 B
(+2.9 KB; amended cap 320 KB).

### What landed

- `js/ui/pause.js` (new): `PauseUI` — pure view. Constructor binds three
  buttons (`#pause-resume/restart/quit`) to injected handlers and exposes
  `show(on)` (a single `classList.toggle("on")`, exactly MenuUI's). It never
  reads or writes game state; main.js remains the source of truth.
- `index.html`: `#pause` `.screen` after `#gameui` — scrim, charcoal panel
  (card recipe: solid fill + amber hairlines, no backdrop-filter), PAUSED
  title, hairline rule, RESUME (primary, amber), RESTART, QUIT · MENU,
  "ESC RESUMES" hint. DOM-only; no canvas UI.
- `styles.css`: `#pause` section — flat 0.55 legibility scrim, centered
  panel `min(320px, 84vw)`, hairline buttons (`.primary` = amber border +
  amber text + warm fill), staged reveal copied from the menu pattern
  (translateY 10px → none; 0.6s ease; button delays 0.12/0.18/0.24s, hint
  0.3s). Hide cross-fades via the shared `.screen` opacity transition.
- `js/main.js`:
  - `pauseUI = new PauseUI({ onResume: setPaused(false), onRestart:
    enterGame(mode), onQuit: enterMenu() })` — all three land on the shell's
    existing paths. RESTART uses the fresh-run path (`enterGame(mode)`;
    `retryRun()` is GAMEOVER-gated); full pooled `world.reset()` semantics
    stay task 2.4's.
  - `setPaused()` now calls `pauseUI.show(on)` — the screen is the VIEW of
    the flag, so the `pause` action, `?scene=paused` staging and the
    visibility auto-pause all get the overlay for free.
  - New `clearPause()` (flag false + `__QA.paused` mirror + screen hidden)
    called from `enterGame`, `endRun`, `enterMenu`. Motivation: `simFrozen`
    reads `paused` in ANY state, so quitting from the pause screen with
    `paused` still true would have frozen the MENU sim; `endRun` while
    paused (QA injection) would have left a dead overlay up. Also fixes a
    latent 2.2 mirror staleness (`enterGame`/`endRun` cleared the flag
    without mirroring).
  - `visibilitychange` FIX (spec alignment): 2.2's `setPaused(document.hidden)`
    auto-RESUMED on tab return, contradicting the game-shell scenario "the
    run pauses and the pause overlay is shown when the tab returns". Now
    hide pauses and return STAYS paused (explicit RESUME continues). No
    `lastTime` surgery on return: rawDt is clamped and unused while paused.
  - `?scene=paused` staging: the pause now stages at the old ready-flip
    point (warm + drained + beauty-settled), and `screenshotReady`
    additionally waits `CONFIG.STAGED_PAUSE.settleS` (1.0 s — covers the
    0.5 s screen fade + 0.3 s last reveal delay + 0.6 s reveal) so captures
    see the overlay SETTLED, not mid-fade. Every non-paused scene's gate is
    byte-identical to 2.2 (`baseSettled` short-circuits unchanged).
- `js/core/config.js`: `STAGED_PAUSE: { settleS: 1.0 }` (QA-staging
  tunable, next to `STAGED_BEAUTY`).
- `qa/hooks.js`: header contract comment updated (scene=paused fade gate).
- `.qa/pause_probe.mjs` (new) + `.qa/png_diff.mjs` (new; PNG pixel A/B,
  task 1.2 methodology).

### Button → shell path wiring

| button | handler | shell path |
|---|---|---|
| RESUME (primary) | `onResume` | `setPaused(false)` — same path as the `pause` action toggle |
| RESTART | `onRestart` | `enterGame(mode)` — the current fresh-run path (menu-select's); pooled reset is 2.4 |
| QUIT · MENU | `onQuit` | `enterMenu()` — same quit path as back-btn / `__QA_SHELL.quit()` |

### Verification evidence

`.qa/pause_probe.mjs` (real CDP keyboard + mouse + touch events,
800×600, `ok: true`, `problems: []`, `consoleErrors: []`,
`consoleWarns: []`, `pageErrors: []`, `envNoiseWarnings: 4` — the
documented ANGLE boot notices):

- Esc pauses → `#pause.on` true, z AND prevZ AND simTime bit-constant across
  400 ms, frames still increment (render continues), screen + button
  computed opacity reach exactly "1" by 1.5 s (settled reveal), gameplay
  keys add zero routed actions with the screen up.
- RESUME via real mouse click → unpaused, screen hidden, mirror false, dolly
  advances at ~cruise rate (0.2–1.2× speed tolerance for SwiftShader
  sim/wall skew) continuing from the bit-frozen z.
- RESUME via CDP touch tap on the button → same (screen is fully touch
  operable; the tap's "tap" action lands while still paused and is ignored,
  then the click fires — no gameplay leak).
- RESTART via mouse click while paused → GAME, unpaused, `runStats` null,
  screen hidden, dolly advances.
- QUIT via mouse click while paused → MENU, menu shown, gameui hidden,
  screen hidden, mirror false, and the MENU sim stays live (simTime
  advances — the paused-leak check; MENU is a static-dolly diorama since
  2.2's `fixedUpdate` GAME gate, so simTime is the "attract live" signal).
- Visibility emulation (defineProperty `document.hidden` + dispatched
  `visibilitychange` — exactly what main.js's handler reads): in MENU hide
  does nothing (no pause, sim keeps animating); in GAME hide → paused +
  overlay shown + run frozen; RETURN → STAYS paused, overlay still up,
  gameplay keys still inert, explicit RESUME click continues the run.
- `?qa=1&scene=paused&mode=run&seed=7` boots to GAME paused with the overlay
  settled at the ready flip, dolly bit-frozen, rendering continues.

Regressions: `.qa/state_probe.mjs` (task 2.2 suite) re-run green
(`ok: true`, zero problems/console noise); `.qa/input_probe.mjs` (task 2.1
suite) re-run green — Esc-in-GAME dual emission, edge triggering and menu
keys unchanged.

Captures (shot.mjs, 1600×900, SwiftShader medium; `ready: true`,
`consoleErrors: []`, `pageErrors: []`, exactly the 4 documented env
notices; PNGs in `.qa/shots/2.3/`):

| capture | url | drawCalls | tris |
|---|---|---|---|
| paused dusk | `?qa=1&scene=paused&mode=run&seed=11` | 153 | 84,337 |
| paused night | `…&time=night` (`--wait 12000`, see note) | 164 | 84,347 |
| menu regression | `?qa=1&scene=menu` | 152 | 83,869 |
| game regression | `?qa=1&scene=game` | 167 | 83,591 |
| frozen attract | `?qa=1&scene=menu&freeze=1&seed=1` | 147 | 82,377 |
| menu seed=1 pair | `?qa=1&scene=menu&seed=1` ×2 | 147 | 82,377 |

- The paused overlay costs ZERO draw calls (DOM only): paused dusk is 153
  draws vs 2.2's world-only 153.
- Pixel A/B (`.qa/png_diff.mjs`, task 1.2 methodology): same-code same-seed
  noise floor 1.613 mean / 2.28% pixels >8 — at the documented 1.2 floor
  (1.636 / 1.94% night); `freeze=1` vs live same-seed 2.975 / 6.8% (live
  dust drift between loads). The pause screen is `opacity: 0` +
  `pointer-events: none` when hidden — menu/game captures are pixel-clean
  (eyeballed vs `.qa/shots/2.2/`: framing, cards, chips, convoy all
  unchanged). 2.2's regression PNGs used time-based seeds, so a numeric
  cross-version diff is meaningless; the in-range draw/tris + zero-console
  re-runs are the regression evidence.
- Overlay styling verified over dusk AND night: panel uses the card recipe
  (solid charcoal + amber hairlines) chosen in round-2 for night
  legibility; RESUME primary reads amber on both.

### Contract notes for tasks 5.1 / 6.1

- **5.1 (HUD touch pause chip)**: emit the existing `pause` action — it
  toggles through `setPaused` and the overlay follows. Ordering guarantee
  the pause screen relies on (holds for any chip too): pointerup's `tap`
  emission precedes the DOM `click`, so a tap on a control that flips pause
  state processes its action under the OLD flag (ignored while paused) and
  no gameplay action leaks into the mode. Space/Enter on focused shell
  buttons are preventDefault'd by input.js (GAME_KEYS/KEY_ACTIONS), so
  there are no double-fires and keyboard cannot accidentally trigger
  RESTART while playing — Esc remains the only pause keyboard path, by
  design. While the overlay is up its full-viewport scrim blocks the
  `#gameui` chips (QUIT replaces the back chip); HUD chips underneath stay
  unclickable, which is wanted.
- **6.1 (paused capture staging)**: `?scene=paused` is fully staged in
  main.js — pause lands at the ready gates, then `screenshotReady` waits
  `STAGED_PAUSE.settleS` (1.0 s) for the settled overlay. Keep that settle
  in mind for capture timeouts: under SwiftShader the night scene drained
  at ~5.5 s and missed shot.mjs's default 6 s window once
  (`ready: false`) — night paused captures used `--wait 12000`. Dolly
  position still varies by warm-frame timing (2.2's known limitation,
  unchanged class). If 6.1 adds deterministic stat injection, stage it
  before the ready gates like `stagedGameOver` does.
- Behavior change vs the 2.2 report: tab-hide auto-pause no longer
  auto-resumes on return (spec alignment, above). Doc nit inherited from
  2.2: the states table's "MENU cruises at CRUISE.menu" is not what
  `fixedUpdate` does — the MENU dolly is static (simTime/sway/dust still
  animate); `speed` is set but only GAME advances the dolly.

## Task 2.4 — gameover UI

Date: 2026-09-24. `js/ui/gameover.js` (GameoverUI: stats grid / NEW BEST
flag / Retry primary + Menu) + instant retry wired through the pooled
`world.reset()` path. Raw own-JS: 221,466 → 225,218 B (+3.7 KB; amended cap
320 KB).

### What landed

- `js/ui/gameover.js` (new): `GameoverUI` — pure view, pause.js's pattern.
  Constructor binds `#go-retry`/`#go-menu` to injected handlers; `setStats(
  stats, prevBest)` fills the three numerals + the best line (textContent
  only, called once per endRun — never per frame) and gates the NEW BEST
  flag on `floor(distance) > floor(prevBest)`; `show(on)` is a single
  `classList.toggle`. Number formatting matches the menu (`toLocaleString`,
  `BEST — N M` / `BEST — —`). The previous best is READ-ONLY here — no
  `recordBest`/`saveSave` call (task 2.5).
- `index.html`: `#gameover` `.screen` after `#pause` — scrim, charcoal
  panel (pause's card recipe), GAME OVER title, hairline rule, NEW BEST
  flag (hidden unless flagged), stats grid (DISTANCE·M / SCORE / PICKUPS:
  dim tracked labels + 44 px amber tabular numerals over `hairline-soft`
  rules), best line, RETRY (`.pause-btn.primary` amber) + MENU · ESC,
  "ENTER RETRIES" hint. DOM-only; zero draw calls (dusk gameover captures
  at 151 draws vs 2.2's world-only 151).
- `styles.css`: `#gameover` section — flat 0.6 scrim (a touch deeper than
  pause for stats legibility; world stays readable behind — death reveal),
  panel `min(360px, 88vw)`, staged reveal copied from the menu/pause
  pattern (translateY 10px → none, 0.6 s; stats 0.10/0.16/0.22 s, best
  0.28 s, buttons 0.34/0.40 s, hint 0.46 s). Buttons reuse the `.pause-btn`
  recipes so RETRY reads exactly as primary as RESUME does.
- `js/main.js`:
  - `gameoverUI = new GameoverUI({ onRetry: retryRun, onMenu: enterMenu })`
    — buttons land on the shell's existing paths.
  - `endRun(stats)` now calls `gameoverUI.setStats(runStats,
    save.best[mode])` (display-only read) + `gameoverUI.show(true)`.
  - `enterGame()` and `enterMenu()` call `gameoverUI.show(false)` — a fresh
    run or quit leaves the dead run's screen (covers retry, pause
    RESTART and menu-select paths).
  - `retryRun()` — GAMEOVER-gated as in 2.2 — now calls `world.reset()`
    BEFORE `enterGame(mode)`: every active chunk despawns into the pools
    (geometry kept), the next `world.update` re-streams the window around
    the untouched dolly from the run seed. No rebuild, no allocation
    spike, no empty rendered frame (world.update runs before render in the
    same frame). Menu-select / pause RESTART stay on the plain fresh-run
    path (2.2/2.3 verified behavior untouched).
  - `?scene=gameover` settle gate: `stagedGameOverAt` stamped when the
    staged `endRun()` fires during boot, and `screenshotReady`
    additionally waits `CONFIG.STAGED_GAMEOVER.settleS` so captures see
    the overlay SETTLED. All non-gameover scenes' gates byte-identical.
- `js/core/config.js`: `STAGED_GAMEOVER: { settleS: 1.1 }` (covers the
  0.5 s screen fade + last reveal delay 0.46 s + 0.6 s reveal), next to
  `STAGED_PAUSE`.
- `qa/hooks.js`: header contract comment updated (gameover fade gate).
- `world.js` needed NO changes: the pooled `reset()` (despawn-all, pools
  keep geometry) already existed ("Recycle everything (mode restart)");
  this task wires it into the retry path.

### Wiring table

| input / control | handler | shell path |
|---|---|---|
| Enter (`confirm`) in GAMEOVER | `routeAction` (2.2, unchanged) | `retryRun()` → `world.reset()` + `enterGame(mode)` |
| Space (`jump`) in GAMEOVER | `routeAction` (2.2, unchanged) | same |
| tap/click RETRY | `#go-retry` click → `onRetry` | same (touch "tap" action stays ignored in GAMEOVER so a tap on MENU can't double-fire — pointerup precedes click) |
| Esc (`back`) in GAMEOVER | `routeAction` (2.2, unchanged) | `enterMenu()` (screen hidden there) |
| tap/click MENU · ESC | `#go-menu` click → `onMenu` | `enterMenu()` |
| `__QA_SHELL.retry()` / `.quit()` | unchanged 2.2 handles | same paths (retry includes the pooled reset) |
| NEW BEST flag | `setStats` | display only; `d > save.best[mode]` at death |
| previous-best line | `setStats` | display only; `save.best[mode]` read at death |

### Retry round-trip timing (performance.now, page clock)

`.qa/gameover_probe.mjs` `retryMs()`: stamps `performance.now()`, fires one
real input from a settled GAMEOVER, resolves when the shell is back in
GAME, `#gameover` is hidden AND the dolly has advanced past its frozen
death-frame z (fresh sim + re-streamed world). Desktop Chromium, warm page:

| input | round trip |
|---|---|
| Enter | 2.5–3.3 ms |
| Space | 2.6–4.9 ms |
| touch tap on RETRY | 2.4–3.4 ms |

The transition is synchronous (state flip + pooled reset + re-stream all
complete before the next render); even a full SwiftShader frame at the
observed ~0.5 s worst case stays inside the ~1 s spec. No page reload
(the probe never navigates across retries).

### Verification evidence

`.qa/gameover_probe.mjs` (new; real CDP keyboard + synthetic pointer +
click events, `__QA_SHELL`, 800×600, `ok: true`, `problems: []`,
`consoleErrors: []`, `consoleWarns: []`, `pageErrors: []`,
`envNoiseWarnings: 4` — the documented ANGLE boot notices):

- Stats render the exact injected stats: `endRun({distance: 4321,
  pickups: 7, score: 5000})` → DOM "4,321" / "5,000" / "7".
- NEW BEST both branches with injected save state (`addInitScript` writes
  `endless.save.v1` with `best.run = 5000`): distance 4,321 → flag OFF,
  best line "BEST — 5,000 M"; distance 6,000 → flag ON, best line still
  shows the PREVIOUS best. Fresh save (best 0): flag ON for any distance
  > 0, best line "BEST — —" (first run counts; matches 2.5's
  `recordBest` d > best rule).
- GAMEOVER framing: dolly z bit-constant across 700 ms while frames keep
  incrementing (world renders behind the scrim) and `__WORLD.chunks`
  unchanged (8).
- Reveal settles: screen + RETRY computed opacity exactly "1" (capture
  gate mirrors this via `STAGED_GAMEOVER.settleS`).
- Retry: Enter, Space and a tap on RETRY each produce GAME, `runStats`
  null, screen hidden, chunk count re-streamed to the same 8, dolly
  advancing (timings above). `world.reset()` verified in-loop (no reload:
  same page, same JS heap).
- Quit: MENU click, Esc, and `__QA_SHELL.quit()` each reach MENU (menu on,
  gameui + gameover hidden).
- `?scene=gameover&mode=run&time=5&seed=7` boots ENDED and SETTLED:
  distance 38, dolly 57.5, screen + button opacity "1" at
  `screenshotReady`, flag ON (38 > 0); Enter retries into a live run.
- Determinism: two loads of the staged URL render identical DOM stats
  ("38"/"0"/"0"/"BEST — —"/flag ON), identical `stats()` and identical
  dolly; PNG pair diffs 0.528 mean / 1.58% >8 (unseeded dust only).

Regressions: `.qa/state_probe.mjs` (2.2), `.qa/pause_probe.mjs` (2.3),
`.qa/input_probe.mjs` (2.1) all re-run green (`ok: true`, zero
problems/console noise beyond the 4 documented env notices).

Captures (shot.mjs, 1600×900, SwiftShader medium; `ready: true`,
`consoleErrors: []`, `pageErrors: []`, exactly the 4 documented env
notices; PNGs in `.qa/shots/2.4/`):

| capture | url | drawCalls | tris |
|---|---|---|---|
| gameover dusk (60 M + NEW BEST) | `?qa=1&scene=gameover&mode=run&time=8&seed=11` | 151 | 83,963 |
| gameover night | `?qa=1&scene=gameover&mode=run&time=night&seed=11` (`--wait 12000`) | 164 | 84,347 |
| staged determinism pair ×2 | `?qa=1&scene=gameover&mode=run&time=5&seed=7` | 151 | 83,963 |
| menu regression | `?qa=1&scene=menu&seed=1` | 147 | 82,377 |
| paused regression | `?qa=1&scene=paused&mode=run&seed=11` | 153 | 84,337 |
| game regression | `?qa=1&scene=game&mode=drive&seed=1` | 147 | 82,377 |

Pixel A/B (`.qa/png_diff.mjs`): staged gameover pair 0.528 mean / 1.58%
>8 (deterministic stats render); menu new-vs-2.3 **0.121 / 0.24%** —
below the same-code noise floor (1.035 / 0.41% measured new-vs-new), i.e.
the hidden `#gameover` screen is pixel-free on the menu; paused
new-vs-2.3 1.665 / 3.59% sits at the paused staging's own same-code floor
(1.641 / 3.47% new-vs-new — the documented warm-frame dolly variance
class, draws/tris bit-identical at 153 / 84,337). Draw calls unchanged
across the board (gameover overlay costs 0: DOM only).

### Contract notes for tasks 2.5 / 6.1

- **2.5 (persistence)**: `endRun(stats)` in main.js is THE hook — after
  `runStats` is built there, call `recordBest(save, mode, runStats.distance)`
  + currency credit + one `saveSave()` BEFORE `gameoverUI.setStats(...)`
  if the best line should reflect the just-recorded best; as wired today
  the screen deliberately shows the PREVIOUS best with the flag carrying
  the "you beat it" read (spec: "previous best + new-best flag"), so 2.5
  only needs to add the writes, not change the view. Do not move the
  `setStats` read earlier than the record: `save.best[mode]` is read at
  death time. Menu "BEST — N M" per-card lines read `save.best[mode]` in
  `MenuUI` (card footer slot below `.card-desc`).
- **6.1 (gameover capture staging)**: `?scene=gameover` is fully staged —
  boot fast-forwards `?time=S`, `endRun()` fires during boot
  (deterministic stats: `round(CRUISE[mode] × S)`), and
  `screenshotReady` waits `STAGED_GAMEOVER.settleS` (1.1 s) for the
  settled overlay. Deterministic stat injection beyond the computed
  defaults (exact pickups/score) can stage the same way 2.2 noted:
  inject before the ready gates. Night captures need `--wait 12000`
  (SwiftShader drain, same as paused). `&time=night` cannot combine with
  a numeric skip (one `time` param — dusk `time=8` is the hero-numeral
  capture; night ships 0-stats).

## Task 2.5 — persistence

Date: 2026-09-24. `endRun()` now writes the save (best + pickup currency,
exactly ONE localStorage write per death) and menu cards carry per-mode
"BEST — N M" lines. The gameover screen's display contract is UNCHANGED: it
still shows the PREVIOUS best with the NEW BEST flag carrying the beat-it
read (2.4's spec-shaped view). Raw own-JS: 225,218 → 227,309 B (+2.1 KB;
amended cap 320 KB).

### What landed

- `js/main.js` — `endRun(stats)` is THE write path (design 9):
  1. `prevBest = save.best[mode]` is captured BEFORE any write so
     `gameoverUI.setStats(runStats, prevBest)` keeps showing the previous
     best (2.4 display contract; flag still computed vs it).
  2. `save.currency += max(0, floor(pickups)) * CONFIG.SCORE.pickupValue`
     — applied to the IN-MEMORY save first.
  3. `if (!recordBest(save, mode, runStats.distance)) saveSave(save);` —
     exactly one write per death, both branches: `recordBest()` (verified:
     returns false and writes nothing unless `d > best[mode]`; writes once
     via its internal `saveSave()` when improved) piggybacks the currency
     credit when it improves; when nothing improved the explicit
     `saveSave()` is the single write. No other path persists a run:
     menu select / retry / pause-RESTART (`enterGame`) only perform the
     PRE-EXISTING `lastMode` settings write (unchanged since 2.2, value
     identical on retry), and quit paths write nothing.
- `js/ui/menu.js` — `MenuUI.setBests(bests)`: fills each card's
  `.card-best` line with the footer's exact format (`BEST — N M` /
  `BEST — —`, `toLocaleString`, called once per menu reveal, never per
  frame). Footer cross-mode line + `setBest()` unchanged.
- `js/main.js` — `menuUI.setBests(save.best)` called wherever the menu
  becomes visible: boot go-live and `enterMenu()`. Boot now also calls
  `setBest(...)` (the footer previously only refreshed via `enterMenu`, so
  a cold boot with a saved best showed the static "—" — fixed here because
  the spec's "menu SHALL reflect the saved bests" now surfaces on cards).
- `index.html` / `styles.css` — `<span class="card-best">` slot below
  `.card-desc` on all three cards: amber hairline top rule
  (`var(--hairline)`), 10 px tracked caps, `--dim` text turning
  `var(--amber)` on the selected card (the `.card-key` pattern), 0.18 s
  color transition. Footer's cross-mode best stays.
- `js/core/config.js` — `SCORE: { pickupValue: 5 }` (documented economy
  seed; see notes for 4.2/4.4).
- `js/ui/gameover.js` — header comment only (view contract restated; no
  behavior change). `js/core/save.js` — NO changes (recordBest/currency
  API verified as-is).

### Verification evidence

`.qa/gameover_probe.mjs` extended (phase 2.5 + storage-clearing init for
the staged phases, which previously relied on nothing ever writing):
`ok: true`, `problems: []`, `consoleErrors: []`, `consoleWarns: []`,
`pageErrors: []`, `envNoiseWarnings: 4` (documented ANGLE boot notices).
Write counting wraps `Storage.prototype.setItem` in-page. RetryMs 2.2–5.4
ms (unchanged class). Steps, each on a fresh-seeded save
(`best.run=0, currency=0, lastMode="run"`):

1. Fresh-save death `endRun({distance: 4321, pickups: 7})` → writes **1**;
   localStorage `best.run: 0 → 4321`, `currency: 0 → 35` (7×5); view
   "BEST — —" + flag ON (previous-best contract holds on a beating death).
2. Reload → menu readback: RUN card `BEST — 4,321 M`, DRIVE/RIDE cards
   `BEST — —`, footer `BEST — 4,321 M`.
3. Death below best `{distance: 100, pickups: 2}` → writes **1**;
   `best.run` stays 4321; `currency 35 → 45`; view "BEST — 4,321 M",
   flag OFF.
4. Beating death `{distance: 5000, pickups: 3}` → writes **1**;
   `best.run 4321 → 5000`; `currency 45 → 60` (accrual across deaths);
   view still "BEST — 4,321 M", flag ON. Reload → RUN card
   `BEST — 5,000 M`.
5. Quit from PAUSE (Enter → Esc → `#pause-quit` click) → writes **0**;
   save unchanged (`best.run 5000`, `currency 60`); quit-path menu shows
   `BEST — 5,000 M` on the RUN card.

Regression suites re-run green: `state_probe` (2.2), `pause_probe` (2.3),
`input_probe` (2.1) — all `ok: true`, zero problems/console noise beyond
the 4 documented env notices. Phases 1–2 of the gameover probe (2.4
display contract, both NEW BEST branches, retry timing, quit paths) pass
unchanged with writes live.

Captures (shot.mjs, 1600×900, SwiftShader medium; `ready: true`,
`consoleErrors: []`, `pageErrors: []`, exactly the 4 documented env
notices; PNGs in `.qa/shots/2.5/`):

| capture | url | drawCalls | tris |
|---|---|---|---|
| menu (new card lines) | `?qa=1&scene=menu&seed=1` | 147 | 82,377 |
| menu pair | same ×2 | 147 | 82,377 |
| gameover dusk | `?qa=1&scene=gameover&mode=run&time=8&seed=11` | 151 | 83,963 |
| gameover dusk pair | same ×2 | 158 | 84,537 |
| gameover night | `…&time=night&seed=11` (`--wait 12000`) | 164 | 84,347 |
| paused dusk | `?qa=1&scene=paused&mode=run&seed=11` | 153 | 84,337 |

Draw calls/tris match 2.4's numbers (DOM-only change; gameover night and
paused bit-identical). Pixel A/B (`.qa/png_diff.mjs`):

- menu 2.5-vs-2.4: 1.913 mean / 1.91% >8 — new-vs-new same-code floor is
  1.008 / 0.36%, and 91% of changed pixels sit in the y≈450–650 card band
  (row-band profile); the rest is the documented unseeded dust/attract
  variance. Change confined to the cards, as intended.
- gameover dusk 2.5-vs-2.4: 4.542 / 12.1% — AT this URL's same-code
  new-vs-new floor (4.483 / 13.9%, pair re-measured on the current build;
  camera-sway phase at capture time is the documented warm-frame variance
  class). The gameover DOM itself is identical (stats 60/0/0, NEW BEST,
  "BEST — —" in both).
- paused 2.5-vs-2.4: 1.678 / 3.65% — at the paused staging's own
  same-code floor (2.4: 1.641 / 3.47%), draws/tris bit-identical.

### Menu card note for the art critic (6.3)

Cards gain one hairline-ruled line each ("BEST — —" empty state in
`.qa/shots/2.5/menu_seed1.png`; populated readback verified by probe).
Restraint rules followed: 10 px tracked caps, dim by default, amber ONLY
on the selected card (mirrors the card-key treatment; the footer keeps
the single always-on cross-mode read). Empty state uses the footer's "—"
convention. Card block grows ~28 px; header/footer pinning unaffected.

### Contract notes for 4.2 / 4.4 / 6.1 / 6.3

- **4.2 (score.js)**: scoring stays OUT of the shell — `runStats.score`
  is still whatever the caller passes (staged default 0). The currency
  credit is `pickups × CONFIG.SCORE.pickupValue` in `endRun`; if score.js
  wants a different ledger shape, it should replace that one line (and
  the config key), not add a second write path.
- **4.4 (config sweep)**: `SCORE: { pickupValue: 5 }` is a documented
  seed value for the 2.5 wiring — retune/absorb freely, but keep the
  `CONFIG.SCORE` path (referenced only by `endRun` today).
- **6.1 (QA staging)**: probes/pages that assert FRESH-save display must
  seed/clear localStorage at document start (`addInitScript`); staged
  gameover/paused boots now WRITE (the death is real), so leftover saves
  change the best line + flag. `browser.newPage()` contexts do NOT share
  storage. `?scene=gameover&time=night` writes an unchanged save
  (distance 0) — harmless, one write.
- **6.3**: see the menu card note above; gameover/paused pixels unchanged
  vs 2.4 beyond capture-timing variance.

## Task 3.1 — zombies

Date: 2026-09-24. `js/entities/zombies.js` (new): pooled instanced gameplay
zombie manager per design decision 5 — ≤ 32 live figures, TWO InstancedMeshes
(bodies + emissive eyes), CPU pose per fixed step, ≤ 2 added draws. Raw
own-JS: 227,309 → 253,632 B (+26,323; zombies.js 22,811 B + config/main/hooks
wiring; amended cap 320 KB).

### What landed

- `js/entities/zombies.js` (new):
  - `createZombieManager(scene, lib)` — ONE InstancedMesh poses every live
    zombie's 14 body parts as per-part instances of a single unit sphere
    (`SphereGeometry(0.5, 8, 6)`, the BoxGeometry ±0.5 convention so RIG dims
    are full sizes; 80 tris ⇒ 80 × 14 = 1120 tris per figure on screen):
    limb swing via per-part instance matrix composition, no skinning rig.
    A second InstancedMesh carries 2 emissive eye chips per zombie
    (12-tri boxes). Zero per-frame allocation: module-scope scratch
    quaternions/vectors, `Matrix4.compose` into `instanceMatrix`.
  - Materials: shared `shambler` (sickly olive) with per-part instanceColor
    = skin/shirt/pants/boot tone groups × per-zombie variance (instanceColor
    scales diffuse only in r172 — exactly the clothing/skin channel); eyes =
    uniform-only clone of `reflector` (same compiled program) with
    `emissiveIntensity × CONFIG.ZOMBIES.eyeGlow`, inheriting chunks.js's
    dusk/night bake. Only new program in the session: the shambler
    material's instanceColor variant (one-time compile on first staged
    render; menu/attract never construct it).
  - `createZombieStage(scene, lib)` — the temporary QA staging (below).
- `js/core/config.js`: `ZOMBIES` section (max, castShadow, stride, poseEase,
  poses {shamble|run|lunge}, tones, eyeGlow, stage pack/movement).
- `js/main.js` (+1 import, +10 gated lines, +1 fixed-step tick) and
  `qa/hooks.js` (staged whitelist + header): TEMPORARY task-3.1 staging —
  `?qa=1&staged=zombies` constructs the manager + a 32-figure pack around
  the run dolly (18 run / 8 shamble / 6 lunge; 6 in a 4.5–8.5 m near band,
  rest 8–30 m), drives caller-owned movement (chasers at the player,
  lane-weaving crossers, pooled respawn behind the camera) from the shell's
  fixed step; freeze=1 freezes it like every sim path. Exposes
  `window.__QA_ZOMBIES` (?qa=1 + staging only): counts/records,
  `show(on)`, `run(n)`, `measure()`. Task 6.1's `staged=gauntlet` replaces
  this staging; the manager itself is the permanent entity system.
- `.qa/zombie_probe.mjs` (new, kept as the entity regression tool): pool +
  draw/tri A/B + animation + allocation + console checks in one page load.

### API contract (4.2 spawn director / 4.3 mode consume this)

```js
const mgr = createZombieManager(scene, lib);   // once per session
const z = mgr.spawn({ x | lane(-1|0|1), y, z, ry, pose: "shamble"|"run"|"lunge",
                      speed, gaitHz?, scale?, tint?, phase? }); // -> record | null (pool full)
z.x / z.y / z.z / z.ry = ...;                  // caller-owned EVERY fixed step
z.pose = "lunge"; z.gaitHz = ...;              // optional live retune (eased)
mgr.fixedUpdate(dt);                           // AFTER movement: gait + matrices
mgr.release(z); mgr.reset();                   // pooled recycle / release all
mgr.count; mgr.max; mgr.records;               // live, capacity (32), pool array
mgr.gaitHzFor(speed, pose, id);                // m/s -> cycles/s (CONFIG stride)
```

Split (documented in the file header): the manager owns ANIMATION only —
gait phase, pose-parameter easing (11 params, exp rate `poseEase`), limb
matrices. The caller owns ALL movement/gameplay (position, facing, pose
choice, release timing); `z.speed` is informational. The manager consumes NO
rng (phase/tint derive from the pool slot unless the spec overrides), so the
director's seeded streams stay authoritative. Contact detection is 4.3's job
against `z.x/z.z` (a ~0.5 m radial check in the player's lane).

### Pose system

Per fixed step: gait phase advances at the eased `gaitHz` (2π·hz·dt); 11
pose parameters ease toward `CONFIG.ZOMBIES.poses[z.pose]` (shamble /
run / lunge — lunge = both arms thrust forward 77°, deep hunch+crouch,
fast frantic cycle). Root = caller position + step bob (two footfalls per
cycle) + weight-shift roll (YXZ euler — roll in the yawed frame, the
shambler-dressing trick). Torso hunches with a breathing wobble; head
counter-lifts toward its target; eyes ride the head. Limbs: contralateral
swing (arm counters own-side leg), knees flex only on the recovery swing,
feet counter-rotate to keep toes near the ground, elbows curl forward (the
grasping read). 14 parts × ~6 quaternion/vec ops — allocation-free.

### Draw/tri/memory evidence (`.qa/zombie_probe.mjs`, SwiftShader medium)

| check | result |
|---|---|
| pool full | 32/32 live; body mesh count 448 (32×14), eyes 64; pack 18 run / 8 shamble / 6 lunge |
| added draws (one page, meshes hidden vs shown around a direct `renderer.render` via `__QA_ZOMBIES.measure()`) | **+2 exactly** (143 → 145 calls; no post or shadow delta — `castShadow: false` holds the gate; flip `CONFIG.ZOMBIES.castShadow` for +1 shadow-pass draw if the critic wants grounded silhouettes) |
| added tris | **+36,608 exactly** (84,522 → 121,130 = 448×80 body + 64×12 eyes); full staged scene at 120,945 — far under the 500 k cap |
| pose animation | pelvis matrix + gait phase change across samples (bob on y, advance on z, phase mod 2π) |
| allocation, forced GC (`--js-flags=--expose-gc`) | gc → 600 synchronous fixedUpdate steps (≈ 269 k part composes) → gc: **retained delta 0 bytes** |
| live heap series | 10 samples over 10 s of animation: flat 27.6 MB, growth 0 bytes |
| console | `consoleErrors: []`, `pageErrors: []`; only the 4 documented ANGLE boot notices |

### Captures (shot.mjs, 1600×900; PNGs in `.qa/shots/3.1/`; all `ready: true`,
`consoleErrors: []`, `pageErrors: []`)

| capture | url | draws | tris |
|---|---|---|---|
| zombies dusk (run rig) | `?qa=1&mode=run&scene=game&staged=zombies&seed=11` | 155 | 120,945 |
| zombies dusk close | …`&cam=close` | 155 | 120,945 |
| zombies dusk side | …`&cam=side` | 155 | 120,945 |
| zombies night | …`&time=night` (`--wait 12000`) | 166 | 120,955 |
| zombies night close | …`&time=night&cam=close` | 166 | 120,955 |
| menu regression | `?qa=1&scene=menu&seed=1` | **147** | **82,377** — bit-identical to 2.5 |
| game regression | `?qa=1&scene=game&mode=drive&seed=1` | **147** | **82,377** — bit-identical to 2.5 |

Silhouette readability: dusk horde reads as backlit hunched runners with
gait separation + eye glints; night reads pale sickly olive figures with
dark clothing and bright amber eyeshine pairs down the road (the spec's
"emissive eyes at night"). Menu/game regressions bit-identical — attract
paths never construct the manager. `.qa/state_probe.mjs` (2.2 suite)
re-run green (`ok: true`, `problems: []`, clean console).

### Contract notes for 4.2 / 4.3 / 6.1

- **4.2 (spawn director)**: spawn from `onChunkActive` streams; respect the
  `null` return (pool full → skip or release the farthest). `tint`/`phase`
  in the spec override the slot-derived streams if a chunk's rng should
  drive variety. Determinism holds: the manager draws no rng.
- **4.3 (RUN mode)**: construct in `enter(ctx)` (`createZombieManager` —
  NOT the stage), add `mgr.fixedUpdate(dt)` to the mode's `fixedUpdate`
  after movement, `mgr.reset()` on run restart. Death: radial lane check vs
  `z.x/z.z` (~0.5 m). The lunge is `z.pose = "lunge"` — eases in over
  ~0.3 s (`poseEase 6`) — set it when a zombie closes inside ~6 m.
- **6.1 (official staging)**: `staged=zombies` (hooks.js whitelist, main.js
  block, `CONFIG.ZOMBIES.stage`) is a temporary stand-in to be replaced by
  `staged=gauntlet`; keep `window.__QA_ZOMBIES.measure()` — it is the
  cleanest added-draw evidence pattern for every entity task (one page, no
  cross-load variance).
- Known limitations: no render-side interpolation (poses update at the
  fixed 60 Hz; at SwiftShader's ~6 fps capture rate this is invisible in
  stills); no cast shadows (config flag documented above); per-part spheres
  read stylized-blob inside ~3 m — acceptable at contact-kill distances
  with motion + eyeshine, revisit only if 6.3's critic flags it.

## Task 3.2 — obstacles

Date: 2026-09-26. `js/entities/obstacles.js` (new): pooled instanced RUN
obstacle system per design decision 5 — THREE archetypes, ONE InstancedMesh
each (3 draws total), lane-x + z-window + height collision truth in fixed
update, NO physics engine. **Provenance note: the first draft of this module
was left by a CANCELLED agent run and was never verified; this task
re-derived, completed and re-verified everything below from scratch** (the
draft's architecture and its assets.js/config.js support were reviewed,
kept where they held up, and fixed where they did not — see "What landed").
Raw own-JS: 253,632 → 284,605 B (+30,973; obstacles.js 19,346 B + the
atlas pair/material defs in assets.js + config OBSTACLES + main/hooks
wiring; amended cap 320 KB).

### What landed

- `js/entities/obstacles.js`:
  - `createObstacleManager(scene, lib)` — one InstancedMesh per archetype
    (`low` / `gantry` / `block`), each ONE merged boot-time geometry of
    UV-remapped boxes (`remapUV` maps every box face into a region of the
    shared `OBSTACLE_ATLAS` canvas pair in assets.js — albedo + emissive
    mask — so one material per archetype carries rust metal, hazard-stripe
    paint, concrete AND the emissive chips with zero extra draws;
    60/84/84 tris per instance). Silhouettes: trestle roadwork barrier
    (2 rust legs + 2 striped planks, top ~0.83 m — reads jumpable),
    sign gantry / fallen beam (posts outside the lane, beam bottom = the
    1.1 m slide gap, three hazard lamps marking the gap's top edge,
    weathered blank panel above), concrete separator + rusted rebar
    filling the lane (amber-red reflectors on the approaching face —
    the ragged ~1.5 m top kills the "jump it" read). Pooled
    (≤ `maxPerType` 24 live per type, 72 records), zero per-frame
    allocation (module-scope scratch), consumes NO rng (yaw jitter/tone
    derive from the pool slot — the director's seeded streams alone decide
    placement). Static like dressing: spawn/release write matrices;
    nothing moves per frame.
  - Time-of-day bake at construct (chunks.js taillight/reflector
    precedent, module-scope `?time=night` read): dusk keeps stripes/lamps/
    reflectors at a restrained idle (glow 0.55/0.75/0.65, all safely under
    the 0.62 bloom threshold in HDR); night raises them (0.95/1.05) and
    the gantry hazard lamps BLINK between 0.5/2.4 at `blinkHz` 0.85
    (battery roadwork lamps — the gap's top edge reads at night) via one
    shared-material uniform write in `fixedUpdate`. No-op at dusk.
  - `createObstacleStage(scene, lib)` — the temporary QA staging (below).
- `js/core/assets.js`: `OBSTACLE_ATLAS` (512², five UV regions), the
  `obstacleAtlas`/`obstacleGlow` canvas painters (dusty hazard stripes,
  weathered painted metal, dusty concrete, charred chip quadrant with the
  two emissive chips; glow mask twins the stripes + chips), and three
  material defs `obstacleBarrier`/`obstacleGantry`/`obstacleBlock` (one
  program each; emissive tint per archetype amber / amber-red).
- `js/core/config.js`: `OBSTACLES` section — per-type solid Y-window +
  footprint (`types.low {halfW 1.45, zHalf 0.28, y1 0.8}`,
  `gantry {halfW 1.6, zHalf 0.22, y0 1.1, y1 2.45}`,
  `block {halfW 1.62, zHalf 0.55, solidAlways}`), `playerHalfW` 0.35 /
  `playerHalfD` 0.3, `profile.standTop` 1.75 (QA-mock default; the real
  mode always passes its live jump/slide profile), visual-only `jitter`,
  `glow` (dusk/night/blink), `stage.band` (temporary staging).
- `js/main.js` (+1 import, +10 gated lines, +1 fixed-step tick) and
  `qa/hooks.js` (staged whitelist + header): TEMPORARY task-3.2 staging —
  `?qa=1&staged=obstacles` constructs the manager + one band
  (low lane −1 @ +8 m, gantry lane 0 @ +13.5 m, block lane +1 @ +19 m
  ahead of the dolly), CONVEYED each fixed step (re-anchored + `flush()`)
  so captures catch it settled ahead of the camera regardless of
  warm-frame timing; freeze=1 freezes it like every sim path. Exposes
  `window.__QA_OBSTACLES` (?qa=1 + staging only). Task 6.1's
  `staged=gauntlet` replaces this staging; the manager is permanent.
- `.qa/obstacle_probe.mjs` (new, kept as the entity regression tool):
  pool/capacity + collision truth table + occupancy contract + draw/tri
  A/B + night-blink + allocation + console checks in one page load.

### API contract (4.2 spawn director / 4.3 mode consume this)

```js
const mgr = createObstacleManager(scene, lib); // once per session
const o = mgr.spawn({ type: "low"|"gantry"|"block", z,   // z REQUIRED (world m)
                      lane: -1|0|1 | x });               // x (m) wins when both
// -> STATIC live record (caller never moves it; streaming releases behind
//    the player), or null (that type full / bad type — caller back-pressure)
o.type/o.lane/o.x/o.z/o.halfW/o.zHalf/o.y0/o.y1/o.solidAlways  // collision truth
mgr.collide({ x? | lane?, z, y0?, y1? })  // -> hit record | null (table below)
mgr.occupied(z0, z1 [, lane])             // -> bool band query (director)
mgr.release(o); mgr.reset();              // pooled recycle / release all
mgr.count; mgr.max; mgr.records;          // live, per-type capacity (24), pool
mgr.fixedUpdate(dt);                      // night gantry blink ONLY (1 call/step)
mgr.flush();                              // QA staging conveyor ONLY — never in play
mgr.setVisible(on);                       // QA draw A/B
```

### Collision semantics (design 5: lane-x + z-window + height, no physics)

`collide(p)` tests one player profile per fixed step: Z inside the padded
window `|pz − o.z| < o.zHalf + playerHalfD`, X inside
`|px − o.x| < o.halfW + playerHalfW`, then the archetype Y rule on the
profile interval `[y0, y1]` (metres above the road):

| archetype | solid Y-window | hit unless | grounded run (0–1.75) | jump (feet ≥ 0.8) | slide (top 0.85) | dodge (other lane) |
|---|---|---|---|---|---|---|
| low (trestle barrier) | 0 – 0.8 | feet clear the top: `y0 ≥ o.y1` | HIT | clear | HIT (slide top 0.85 > 0.8 — deliberate: sliding under a solid plank is death) | clear |
| gantry (beam over lane) | 1.1 – 2.45 | profile fits under: `y1 ≤ o.y0` | HIT | HIT (arc inside the beam span) | clear | clear |
| block (separator + rebar) | solidAlways | never — Y ignored | HIT | HIT | HIT | clear |

A hit returns the RECORD (archetype + lane/x/z placement) for death
framing; the MODE owns the jump-arc/slide profiles and passes live eased
y0/y1 (config-only tunables, task 4.4's sweep). Edge semantics verified:
the clear threshold is inclusive (`y0 == o.y1` clears; one step shy hits)
and the padded z/x windows are exclusive at `≥`.

**Lane-index vs x-distance decision: collide() tests absolute X with a
half-width tolerance, NOT a discrete lane index.** The mode eases between
the three discrete lanes, so mid-transition the player's body is genuinely
BETWEEN lanes — a lane-index test would lie at both ends of the ease
(hitting an obstacle the body clearly misses, or clearing one it clearly
grazes). `rec.lane` is still recorded per spawn for the director's
BAND validation (`occupied(..., lane)`), where placement is discrete by
design. x/z tolerance constants are `OBSTACLES.playerHalfW/playerHalfD`.

### Occupancy read — contract for the 4.2 director

`occupied(z0, z1 [, lane])` is the read side of the lane z-window
reservation: TRUE when any live obstacle's `[z − zHalf, z + zHalf]`
overlaps `[z0, z1]` (and sits in `lane`, when given). The director calls
it BEFORE accepting a placement so bands never straddle a reserved window
(design risk note: "director reserves lane z-windows so spawns never
straddle a shoulder wreck"). Verified: band windows report occupied, the
lane filter excludes other-lane records, empty gaps report clear, and a
spawn→release cycle frees its window again (spawn/reservation symmetry).

### Draw/tri/memory evidence (`.qa/obstacle_probe.mjs`, SwiftShader medium)

| check | result |
|---|---|
| staged band | 3 live (1 per type); mesh counts 1/1/1 |
| capacity | 24/type → 72/72 filled; overflow `spawn` returns null; invalid type null; release recycles back to 3, band intact |
| collision truth | 22/22 cases pass (run-through hits all 3; jump/slide/dodge clear; slide-into-low, jump-into-gantry, jump-into-block hit; exact y/z/x boundaries both sides; default standing profile hits; hit returns the record with type/lane/x/z) |
| occupancy | 6/6 (overlap, lane hit/miss, empty gap, reserve/clear cycle) |
| added draws (one page, meshes hidden vs shown around a direct `renderer.render` via `__QA_OBSTACLES.measure()`) | **+3 exactly** (143 → 146; `castShadow: false` holds the gate — flip `OBSTACLES.castShadow` for +3 shadow-pass draws if the critic wants grounded shadows) |
| added tris | **+228 exactly** (60 + 84 + 84); staged scene 84,191–84,575 — far under the 500 k cap |
| night blink | gantry lamp material intensity moves across 90 fixed steps (0.69 → 1.01 sampled); dusk fixedUpdate is a no-op (0.5 constant) |
| allocation, forced GC (`--expose-gc`) | gc → 600 synchronous fixedUpdate+collide+flush steps → gc: **retained delta 0 bytes**; 10-sample live heap series flat, growth 0 bytes |
| console | `consoleErrors: []`, `pageErrors: []`; only the 4 documented ANGLE boot notices |

### Captures (shot.mjs, 1600×900; PNGs in `.qa/shots/3.2/`; all `ready: true`,
`consoleErrors: []`, `pageErrors: []`; band staged via `&time=8` so the
capture lands it in a plain chunk clear of the chunk-1 convoy hulls)

| capture | url | draws | tris |
|---|---|---|---|
| obstacles dusk (run rig) | `?qa=1&mode=run&scene=game&staged=obstacles&seed=11&time=8` | 154 | 84,191 |
| obstacles dusk close | …`&cam=close` | 154 | 84,191 |
| obstacles night | …`&time=night` (`--wait 15000`) | 167 | 84,575 |
| obstacles night close | …`&time=night&cam=close` | 167 | 84,575 |
| menu regression | `?qa=1&scene=menu&seed=1` | **147** | **82,377** — bit-identical to 3.1 |
| game regression | `?qa=1&scene=game&mode=drive&seed=1` | **147** | **82,377** — bit-identical to 3.1 |

Silhouette readability (crop-inspected at 2–3×): dusk — the striped
trestle planks read as jumpable roadwork, the gantry reads as a gate with
three amber lamps marking the gap's top edge over an open span, the block
reads as a low concrete mass with two amber-red reflectors; night —
stripes and reflectors glow amber at intensity 0.95/1.05 and the gantry
lamps ride the blink, so all three silhouettes hold against hull dressing
and the headlight pools. Draw delta at the frame level: 147 (game
baseline) → 154 staged dusk (+3 main-pass, +4 post-pipeline variance).
Menu/game regressions bit-identical — attract paths never construct the
manager.

Regressions re-run green with the final code: `.qa/state_probe.mjs`
(`ok: true`, `problems: []`, clean console beyond the 4 documented env
notices), `.qa/zombie_probe.mjs` (32/32 live, +2 draws / +36,608 tris,
animation live, heap retained 0 B, `consoleErrors: []`, `pageErrors: []`).

### Contract notes for 4.2 / 4.3 / 6.1

- **4.2 (spawn director)**: spawn per archetype with `{ type, z, lane }`;
  respect the `null` return (type full → skip or release the farthest).
  Validate every band placement with `occupied(z0 − pad, z1 + pad, lane)`
  BEFORE spawning — the read is exact (window padding included), so a band
  is passable-by-layout exactly when its per-lane windows don't overlap a
  reserved window. Obstacles are STATIC: never re-write `o.z` in play;
  release them when their chunk deactivates (`mgr.release(o)` /
  `mgr.reset()` on retry). Determinism holds: the manager draws no rng
  (yaw/tone derive from the pool slot).
- **4.3 (RUN mode)**: construct in `enter(ctx)` (`createObstacleManager` —
  NOT the stage). Each fixed step: ease the player profile, call
  `mgr.collide({ x: player.x, z: player.z, y0, y1 })` ONCE — pass the
  eased ABSOLUTE x (never the discrete lane) and the live jump/slide
  profile; a non-null return is the death record (`o.type` for the death
  sting / gameover framing). Suggested profiles to tune in 4.4:
  run `{0, 1.75}`, jump `{arcY, arcY + tucked}`, slide `{0, ~0.85}` —
  note slide does NOT clear the low barrier (top 0.85 > plank top 0.8,
  by design). Jump timing: the clear test is `y0 ≥ 0.8` across the whole
  padded z-window `±(0.28 + 0.3)` m, so late jumps at the window edge are
  the intended skill test.
- **6.1 (official staging)**: `staged=obstacles` (hooks.js whitelist,
  main.js block, `CONFIG.OBSTACLES.stage.band`) is a temporary stand-in to
  be replaced by `staged=gauntlet`; keep `window.__QA_OBSTACLES.measure()`
  (the added-draw A/B pattern) and the probe's truth-table shape — the
  gauntlet staging should re-expose the same surface for the 6.2 captures.
  Capture note: stage the band with a `&time=` skip that lands it in a
  plain chunk (chunk 1 is ALWAYS the hero convoy cluster at world 40–80 —
  `time=8` at `CRUISE.run` worked for dusk; night has no numeric skip, so
  shoot `&time=night&cam=close`, where the band reads cleanly in front of
  the hull dressing).
- Known limitations: no cast shadows (`castShadow: false` holds the +3
  gate; the flag is documented if the art critic wants them); collision is
  an AABB profile test — the block's rebar and the gantry's posts are
  visual only (posts sit outside the collision half-width by design);
  `staged=obstacles` shares the ready gates with every scene (no extra
  settle needed — the conveyor keeps the band placed).

## Task 3.3 — pickups + particles

Date: 2026-09-26. `js/entities/pickups.js` (new) + `js/entities/particles.js`
(new): the last two shared entity systems of design decision 5 — pooled
instanced amber supply markers (ONE InstancedMesh = 1 draw) and ONE pooled
Points burst system (1 draw); **+2 added draws total against the ≤ 3 budget**
(headroom note from the report header: zombies +2, obstacles +3 already
landed). Raw own-JS: 284,605 → 310,121 B (+25,516; pickups.js 14,713 B +
particles.js 6,278 B + config PICKUPS/PARTICLES +4,525 B wiring; amended cap
320 KB). Size note vs the ≤ 12 KB combined target: the manager + system
CODE is ~9 KB; the rest is the 4.2/4.3 contract headers and the QA staging
surface (`createPickupStage` + `__QA_PICKUPS` + `measure()`) that mirrors
the mandated 3.1/3.2 pattern — flagged here so 6.1's gauntlet replacement
can reclaim it if the budget tightens.

### What landed

- `js/entities/pickups.js`:
  - `createPickupManager(scene, lib)` — ONE InstancedMesh of a merged
    4-box supply-crate silhouette (~0.44 m tall; weathered body + lid, a
    protruding amber band around the middle, a small hazard stencil on the
    top face — the chase camera looks down on it; 48 tris/instance). Every
    part's UVs are remapped into the shared `OBSTACLE_ATLAS` pair (albedo +
    emissive mask — rust body, hazard-lamp-chip band, stripes top), so ONE
    parameter-clone of `obstacleBarrier` carries all finishes: same
    compiled program, own uniform state (the pulse never moves the
    obstacle archetypes). Per-instance diffuse tone + yaw jitter derive
    from the pool slot (NO rng consumed — bible rule 7). Pooled
    (≤ `CONFIG.PICKUPS.max` 48 live), static like obstacles (spawn/release
    write matrices; nothing moves per frame), zero per-frame allocation.
  - **Emissive pulse — cheapest-channel decision (documented per task):**
    the SHARED material's `emissiveIntensity` breathes between
    `CONFIG.PICKUPS.pulse.{dusk,night}` min/max in `fixedUpdate` — ONE
    uniform write per fixed step (the obstacle gantry-blink precedent; all
    markers breathe in phase). Per-instance emissive would need an
    onBeforeCompile program variant and r172 `instanceColor` cannot reach
    emissive; variety instead rides slot-derived diffuse tone + yaw.
    Dusk peak 1.05 = HDR ~0.56, under the 0.62 bloom threshold (restrained
    amber, no blowout); night peak 2.1 rides bloom deliberately (roadside
    beacon, the zombie-eyeshine class).
  - `createPickupStage(scene, lib)` — the temporary QA staging (below).
- `js/entities/particles.js`: `createParticleSystem(scene, lib)` — ONE
  `THREE.Points` of `CONFIG.PARTICLES.max` 384 preallocated points = 1 draw
  (additive, sizeAttenuation, the shared `dustDot` sprite, `fog: false`,
  renderOrder 2 with the dust motes). Two event types from
  `CONFIG.PARTICLES.types`: `pickup` (12 points, tight, HDR amber) and
  `death` (30 points, wide, dark crimson embers + dust). CPU integration
  per fixed step (dt 0-safe for frozen warmup): gravity + exponential
  drag + ground bounce, quadratic color fade (additive blend → black =
  invisible, so dead points park at y −50 with zeroed colors). Ring
  allocation from a round-robin cursor: a burst never refuses; an exhausted
  pool sacrifices its oldest sparks (fire-and-forget cosmetics). NO rng —
  burst direction/velocity/ttl derive from the slot's golden-ratio streams.
  **Documented trade:** per-point sprite size would need a custom shader,
  so the types read apart through count/spread/tone; "darker" death tones
  ride the additive blend as dim embers + thrown dust, not a darkening puff.
- `js/core/config.js`: `PICKUPS` (max 48, castShadow false, collect windows
  halfW 0.7 / zHalf 0.5 + playerHalfW 0.45 / playerHalfD 0.45 — magnetic by
  design vs the obstacles' 0.35/0.3, jitter, pulse bands + hz, `stage`
  layout) and `PARTICLES` (max 384, size 0.3, renderOrder, gravity 5.5,
  drag 1.6, per-type count/spread/speed/up/ttl/colors).
- `js/main.js` (+1 import, +9 gated lines, +1 fixed-step tick, +1
  ready-flip call) and `qa/hooks.js` (staged whitelist + header):
  TEMPORARY task-3.3 staging — `?qa=1&staged=pickups` constructs manager +
  particles, conveys `CONFIG.PICKUPS.stage.strand` (5 markers lane 0 at
  +8…+16.8 m, 3 markers lane −1 at +20…+24.4 m, 2.2 m spacing) ahead of the
  run dolly (obstacle-stage conveyor: re-anchor + `flush()`), fires ambient
  pickup bursts on a 1.1 s cadence, and at the ready flip fires the
  `stage.flash` pair (pickup lane 0 +6 m, death lane 1 +9.5 m) followed by
  one `update(0)` — so `&freeze=1` captures hold BOTH burst types frozen at
  full fade in frame. Exposes `window.__QA_PICKUPS`. 6.1's `staged=gauntlet`
  replaces this staging; both managers are permanent.
- `.qa/pickup_probe.mjs` (new, kept as the entity regression tool): pool/
  capacity + collection truth table + release contract + pulse band +
  particle lifecycle/recycle + draw/tri A/B + allocation + console checks
  in one page load.

### API contracts (4.2 spawn director / 4.3 mode consume these)

```js
const mgr = createPickupManager(scene, lib);  // once per session
const p = mgr.spawn({ z,                      // z REQUIRED (world m)
                      lane: -1|0|1 | x });    // x (m) wins when both
// -> STATIC live record { alive, id, lane, x, z, ry }, or null (pool full;
//    caller back-pressure). Strand support: spawn per pickup, 3-6 markers
//    down one lane at even spacing (2.2 m staged); per-pickup and agnostic.
mgr.tryCollect({ x? | lane?, z })  // -> consumed record | null (see below)
mgr.release(p); mgr.reset();       // recycle one (chunk despawn) / all
mgr.count; mgr.max; mgr.records;   // live, capacity (48), pool array
mgr.fixedUpdate(dt);               // emissive pulse ONLY (1 call/step)
mgr.flush();                       // QA staging conveyor ONLY — never in play
mgr.setVisible(on);                // QA draw A/B

const fx = createParticleSystem(scene, lib);  // once per session
fx.burst(x, y, z, "pickup" | "death"); // fire-and-forget (unknown -> pickup)
fx.update(dt);                     // once per fixed step; dt 0 keeps frame
fx.reset();                        // kill + park everything (retry)
fx.live; fx.max;                   // live point count, capacity (384)
fx.setVisible(on);                 // QA draw A/B (update re-shows)
```

Collection semantics (`tryCollect`, obstacles.collide contract style):
consumes AT MOST ONE pickup per call — the first live record whose window
holds the profile is released and returned (the mode fires the burst +
score/currency off it); null = nothing in range. Window:
`|px − p.x| < halfW + playerHalfW` AND `|pz − p.z| < zHalf + playerHalfD`
— absolute x-with-tolerance, NOT a lane index (lane easing makes a discrete
test lie mid-transition — the 3.2 precedent); NO Y test (ground-level
pickup, valid in any player state). Exactly-once: a consumed record can
never be collected again (its `alive` is false; the next call scans past
it). Strand run-throughs call once per fixed step — dz per step at max
speed (0.4 m) << the 0.95 m z-window and the 2.2 m strand spacing, so no
pickup is skipped. Missed pickups are NEVER auto-released (spec: they
despawn with the chunk and award nothing) — release is caller-driven:
4.2 releases a chunk's strand on `onChunkInactive`; only `tryCollect` pays.

### Draw/memory evidence (`.qa/pickup_probe.mjs`, SwiftShader medium,
`?qa=1&mode=run&scene=game&staged=pickups&seed=11&time=8`)

| check | result |
|---|---|
| staged strands | 8 live (5 lane 0 + 3 lane −1); mesh count 8, visible |
| capacity | 48/48 filled; overflow `spawn` null; extras recycle; strands intact |
| collection truth | 10/10 cases: x/z hit (exact record id), re-collect null (exactly once), lane-index hit, other-lane + adjacent-lane-x miss, x inside/outside tolerance (1.15 m), z window in/out/behind (0.95 m); missed pickups STAY live (release caller-driven); spawn→release recycles; `release(null)`/double-release safe |
| pulse | shared material intensity moves across 60 fixed steps (0.635 → 0.801 sampled) and stays inside the dusk band 0.5–1.05 |
| particles | pickup burst 12 + death burst 30 = 42 live, visible true; decay reaches exactly 0; after death ALL colors zeroed, ALL points parked at y −50, visible false; later bursts reuse the drained slots (recycle) |
| added draws (one page, system hidden vs shown around a direct `renderer.render` via `__QA_PICKUPS.measure()`) | **+2 exactly** (112 → 114; mesh + points; nothing casts shadows — `castShadow: false` holds the gate) |
| added tris | **+384** (8 instances × 48; the Points draw adds 0 tris); staged scene 84,347 — far under the 500 k cap |
| allocation, forced GC (`--expose-gc`) | gc → 600 fixed steps (pulse + miss scans + particle decay) with 10 interleaved bursts → gc: **retained delta 0 bytes**; 8-sample live heap series flat (27.6 MB), growth 0 bytes |
| console | `consoleErrors: []`, `pageErrors: []`; only the 4 documented ANGLE boot notices |

### Captures (shot.mjs, 1600×900; PNGs in `.qa/shots/3.3/`; all `ready: true`,
`consoleErrors: []`, `pageErrors: []`; dusk staged via `&time=8` to land the
strand in a plain chunk — the 3.2 capture note)

| capture | url | draws | tris |
|---|---|---|---|
| pickups dusk (run rig) | `?qa=1&mode=run&scene=game&staged=pickups&seed=11&time=8` | 152 | 84,347 |
| pickups dusk close | …`&cam=close` | 152 | 84,347 |
| pickups night close | …`&time=night&cam=close` (`--wait 15000`) | 165 | 84,731 |
| menu regression | `?qa=1&scene=menu&seed=1` | **147** | **82,377** — bit-identical to 3.1/3.2 |
| game regression | `?qa=1&scene=game&mode=drive&seed=1` | **147** | **82,377** — bit-identical to 3.1/3.2 |

Readability (crop-inspected at 4×): dusk — markers read as dark supply
crates with a glowing amber band, popping against the asphalt WITHOUT
blowing out (band HDR ≤ 0.56 < bloom threshold 0.62); night — the band
rides bloom as a roadside beacon and the burst pair reads: bright amber
sparks at the collect point, dim crimson/dust embers on the death impact.
Draw delta at frame level: 147 (game baseline) → 152 staged dusk (+2 system
draws + post-pipeline variance). Pixel A/B (`.qa/png_diff.mjs`): menu
3.2-vs-3.3 1.668 mean / 2.48% >8 vs same-code new-vs-new floor 1.676 /
2.51%; game 4.669 / 11.18% vs floor 4.669 / 11.18% — both AT the
documented warm-frame/dust variance floor; draws/tris bit-identical.
Attract paths never construct either system (menu/game unchanged).

Regressions re-run green with the final code: `.qa/zombie_probe.mjs`
(`ok: true`, +2 draws / +36,608 tris, heap retained 0 B), 
`.qa/obstacle_probe.mjs` (`ok: true`, +3 draws / +228 tris, truth 22/22,
occupancy 6/6, heap retained 0 B), `.qa/state_probe.mjs` (`ok: true`,
`problems: []`, clean console beyond the 4 documented env notices — one
transient phase-3 timeout under host load re-ran clean; no code cause).

### Contract notes for 4.2 / 4.3 / 6.1

- **4.2 (spawn director / strand spawning)**: from `onChunkActive` streams,
  lay strands as 3-6 `mgr.spawn({ z, lane })` calls at even spacing
  (2.2 m staged; 0.95 m collect z-window means spacing ≥ ~1.5 m never
  double-collects in one step). Respect the `null` return (pool 48 — a
  strand tail can be dropped). Release each chunk's strand on
  `onChunkInactive` (`mgr.release(p)`; `mgr.reset()` on retry) — uncollected
  pickups award nothing, exactly the spec. Determinism holds: the manager
  draws no rng (tone/yaw derive from the pool slot). Coordinate with
  `obstacles.occupied(z0, z1, lane)` so strands never spawn inside an
  obstacle's z-window.
- **4.3 (collection + burst hooks)**: construct `createPickupManager` +
  `createParticleSystem` in `enter(ctx)` (NOT the stage). Each fixed step:
  `const p = mgr.tryCollect({ x: player.x, z: player.z }); if (p) {
  fx.burst(p.x, 0.35, p.z, "pickup"); score += CONFIG.SCORE.pickupValue;
  pickups++; }` then `mgr.fixedUpdate(dt); fx.update(dt);` — order free.
  Death: `fx.burst(player.x, 0.5, player.z, "death")` before `endRun(stats)`
  (the GAMEOVER world keeps rendering, so the impact reads in the death
  reveal). `fx.reset()` + `mgr.reset()` on run restart. HUD pickup numeral
  (5.1) counts `tryCollect` hits.
- **6.1 (official staging)**: `staged=pickups` (hooks.js whitelist, main.js
  block, `CONFIG.PICKUPS.stage`) is the temporary stand-in to be replaced by
  `staged=gauntlet`; keep `window.__QA_PICKUPS.measure()` (added-draw A/B
  pattern) and the probe's truth-table shape. Capture recipe: `&time=8`
  dusk lands the conveyed strand in a plain chunk; night has no numeric
  skip — shoot `&time=night&cam=close` (`--wait 15000` for the SwiftShader
  drain). The ready-flip flash pair (main.js → `readyFlash(dollyZ)`) is
  what freezes both burst types at full fade under `&freeze=1` — keep an
  equivalent hook in the gauntlet staging so capture bursts stay
  deterministic.
- Known limitations: all markers pulse in phase (per-instance phase needs a
  program variant — documented trade); no per-point sprite size (one
  PointsMaterial; types differ by count/spread/tone); death "dark" burst is
  additive-dim embers, not a darkening puff; pickups/particles skip cast
  shadows (`castShadow: false` / Points never cast — holds the +2 gate);
  particle ring allocation silently recycles the oldest sparks if > 384
  are live at once (worst staged case 42).

## Task 3.4 — player

Date: 2026-09-26. `js/entities/player.js` (new): the RUN player — the ONE
hierarchical low-poly rig per design decision 5. Real `THREE.Group` hierarchy
(hips → pelvis + spine → torso/head/2 arms; hips → 2×(thigh→shin)), NO
instancing, NO skinning; sinusoidal run cycle + lerped jump/slide/dead poses;
fixed-timestep state machine WITH render-side interpolation (the bible-rule-5
step the zombie poses skip as a documented limitation — the player is
center-frame and must not pop). Raw own-JS: 310,121 → **323,036 B** (+12,915;
player.js 10,591 + config PLAYER 1,357 + assets runner kit 487 + main wiring
480; amended cap 320 KB — see the size note below). `.qa/player_probe.mjs`
(new, kept as the entity regression tool).

### What landed

- `js/entities/player.js` — `createPlayer(scene, lib)`:
  - **Rig**: 11 meshes / 11 draws — one mesh + one library material per
    articulated body (runnerJacket / runnerPants / runnerSkin / runnerBoot —
    four new flat MATERIAL_DEFS, the untextured `shambler` program, so zero
    new shader variants); rigid details (jacket hem, backpack, neck, baked
    elbow bend, boots with toes +z) merge into their body's geometry.
    ~0.3k tris total (≈6k under the 1.5–2k budget — readability comes from
    proportions, the clothed-runner palette and rim, not density).
    `castShadow = CONFIG.PLAYER.castShadow` (default true; decision below).
  - **State machine** (sim side, fixed 60 Hz): `run` (cadence =
    clamp(speed/stride, gaitHz band), sinusoidal contralateral limb cycle —
    legs swing/knees flex on recovery, arms counter-swing, hips bob at two
    footfalls per cycle, spine lean + sway, head counter-pitch); `jump`
    (semi-implicit gravity integration, `v0`/`gravity` in CONFIG — apex
    ≈1.01 m, air ≈0.72 s; pose weight eases to the tuck target); `slide`
    (timed, exactly `slideTime`; pose weight eases to the crouch target);
    `dead` (`die()` — one pose target, crumple: hips drop, spine pitches
    forward, arms fling out; y eases to 0 for the gameover framing).
  - **Lane easing**: target lane clamped to −1..1; x eases from the CURRENT
    body position over `laneChangeTime` (0.16 s, smoothstep) — a mid-ease
    re-target restarts the window from where the body is; root rolls into
    the turn (`laneLean`), easing back to 0 at the settle.
  - **Render interpolation**: every animated scalar (x, y, cadence phase
    with TAU-unwrap, lean, slide/tuck/dead weights) snapshots prev/cur each
    fixed step; `updateRender(alpha)` lerps them into the transforms —
    allocation-free (scalars only, no scratch Vector3).
  - **Collision profile**: a single LIVE `profile` object
    `{x, z, y0, y1, state}` rewritten in place per fixed step (never
    reallocated) — pass it straight to `obstacles.collide(player.profile)`.
- `qa/player_stage.js` (new, QA-gated) — `createPlayerStage(scene, lib)` +
  `window.__QA_PLAYER`; wired in main.js (+1 import, +6 gated lines, +1
  fixed-step tick, +1 render-side `update(alpha)` call) and the `staged`
  whitelist in `qa/hooks.js`. **The temporary staging lives in `qa/`, not
  `js/entities/`** (beside `qa/hooks.js` — the established home of runtime
  QA-gated code outside the js/ byte metric): it is throwaway once 6.1's
  `staged=gauntlet` lands, and keeping it out of the shipped entity module
  is what held this task's js/ delta near the budget. The 3.1–3.3 stages
  shipped inside their entity modules when there was headroom.
- `js/core/config.js`: `PLAYER` section — `castShadow`, `stride` 1.35,
  `gaitHz` [1.9, 3.1], `laneChangeTime` 0.16, `laneLean` 0.22,
  `jump {v0 5.6, gravity 15.5}`, `slideTime` 0.7, `poseEase` 12,
  `profile {standTop 1.75, jumpTop 1.0, slideTop 0.85}`, `pose` targets
  (run amplitudes + tuck/slide/dead pose tables). The stage constants moved
  WITH the staging into `qa/player_stage.js` (QA-only, not gameplay numbers).
- `js/core/assets.js`: `runnerJacket 0x7d4630` (dusty rust),
  `runnerPants 0x33383e` (charcoal denim), `runnerSkin 0xa8704f` (tanned),
  `runnerBoot 0x2a1d14` (worn) — muted dust-covered tones per the art bible,
  NOT mannequin white; the raking dusk key + moon rim carry the read.

### API contract (mode 4.3 consumes this)

```js
const player = createPlayer(scene, lib); // once per session (enter(ctx))
player.requestLeft(); player.requestRight(); // edge-latched lane steps
player.requestJump(); player.requestSlide(); // edge-latched actions
player.z = focusZ;                 // MODE-owned: write EVERY fixed step
player.fixedUpdate(dt, speed);     // speed = cadence m/s input only
player.profile                     // LIVE {x,z,y0,y1,state} -> collide()
player.updateRender(alpha);        // EVERY rendered frame (bible rule 5)
player.die();                      // death crumple (mode calls before endRun)
player.reset();                    // fresh run (retry)
player.state / .x / .lane / .z / .vy / .laneT / .w   // live reads
player.group / player.hips         // scene graph (QA + framing)
```

**Ownership split** (the cleaner one given the shell's design decision 2):
the MODE owns z and the speed ramp — the mode's focus z IS the player z (one
integration point; the mode writes `player.z` then calls
`fixedUpdate(dt, speed)`, mirroring the zombies manager's caller-moves
convention). The player owns x (lane easing), y (gravity arc), cadence, pose
and the collide() profile. `speed` never moves the player — it only drives
cadence (m/s → hz via `stride`) so the gait reads the ramp.

**Request semantics** (CONFIG-documented in the config header): requests are
edge-LATCHED and consumed by the next fixed step (actions arrive between
fixed steps; nothing is lost, duplicates collapse). `jump`/`slide` fire ONLY
from `run` — a mid-air or mid-slide request is IGNORED, there is no queueing,
and a slide is never cancelled by a jump (jump+slide latched in the same
step → jump wins). Lane changes fire in any live state (mid-air dodges are
the spec's evasion scenario), never while dead; at the outer lanes an edge
request is a no-op. 4.4 may retune this into buffered input later — the
latch points are the three `if (req.*)` guards in `fixedUpdate`.

**Profile mapping to `obstacles.collide()`** (3.2 semantics table):

| state | y0 | y1 | vs the archetypes |
|---|---|---|---|
| run | 0 | standTop 1.75 | hits low/gantry/block in-lane |
| jump | arc y (feet) | y + jumpTop 1.0 | clears low once y0 ≥ 0.8; still hits gantry (arc inside the beam span) |
| slide | 0 | slideTop 0.85 | clears gantry (0.85 < 1.1); hits low (0.85 > 0.8, deliberate) |
| dead | eased to 0 | standTop | the mode stops colliding |

X in the profile is the EASED absolute x (never the discrete lane — the 3.2
decision); z is the mode-written focus z.

### Shadow decision (measured)

`castShadow: true` by default. The player is the hero at center-frame and a
grounded contact shadow sells the jump arcs — with a 1024 map over the
±44 m shadow ortho the silhouette reads as a soft grounded blob with limb
hints, matching the wreck shadows' language. Cost is NOT the +1 the
headroom note imagined: 11 meshes = **+11 shadow-pass draws**
(`measureShadow()`: 123 → 134 around direct renders). Total added draw
delta **+22** (11 main + 11 shadow) + 576 tris; staged dusk close capture
173 draws — under the 220 cap with 47 to spare. `CONFIG.PLAYER.castShadow`
flips the whole thing off (−11 draws) if a later slice needs the budget
back; there is no per-mesh split flag (keep it all-or-nothing — partial
shadows would read as a glitch).

### Evidence (`.qa/player_probe.mjs`, SwiftShader medium, one page load of
`?qa=1&mode=run&scene=game&staged=player&seed=11&time=8`)

| check | result |
|---|---|
| lane easing (5 cases) | eased x reaches the target lane within `laneChangeTime` +1 step, monotone smoothstep (no overshoot), clamped no-ops at ±1, mid-ease re-target restarts from the current x |
| jump arc (4) | profile.y0 matches the discrete semi-implicit recurrence exactly (1e-9), apex within 8% of v0²/2g (integration droop), airtime ≈ 2v0/g ±3 steps, lands to run and cadence resumes |
| slide window (3) | profile.y1 == slideTop for exactly the CONFIG window (42/60 s minus the end-of-step boundary), y0 stays 0, run resumes after |
| request rules (5) | jump during slide ignored; slide during jump ignored; lane change mid-air allowed; jump+slide latched together → jump wins; all requests ignored while dead |
| render interpolation | `sample(1)` of step k == `sample(0)` of step k+1 exactly (boundary-continuous); mid-alpha hip pops ≤ 0.0012 m per quarter-step; phase unwrap clean across the TAU wrap; y monotone through the arc |
| death | crumple settles (dead weight → 1, y → 0), profile stays live |
| added draws (`measure()`, player staged in view) | **+22 exactly** (112 → 134; 11 main + 11 shadow), +576 tris (288 × 2 passes) |
| shadow A/B (`measureShadow()`) | castShadow off → on: **+11 shadow-pass draws** |
| allocation, forced GC | gc → 600 fixed+render steps with cycling requests → gc: **retained 0 bytes**; heap series flat (27.6 MB, growth 0) |
| console | `consoleErrors: []`, `pageErrors: []`; only the 4 documented ANGLE boot notices |

Probe implementation notes: the probe quiets the capture autopilot
(`__QA_PLAYER.auto(false)`) and drives requests itself; `measure()`/
`measureShadow()` must STAGE THE PLAYER IN VIEW first (`reset()` parks z at
0 — behind the camera after the `?time=` skip — where the frustum cull
rightly zeroes the A/B; the probe re-anchors z at dolly + stage.zAhead).
`reset()` zeroing z is safe in play (the mode writes z before every
fixedUpdate).

### Captures (shot.mjs, 1600×900; PNGs in `.qa/shots/3.4/`; all `ready: true`,
`consoleErrors: []`, `pageErrors: []`; the 4 documented env notices only)

| capture | url | draws | tris |
|---|---|---|---|
| dusk run cycle, close | `?qa=1&mode=run&scene=game&staged=player&seed=11&time=8&cam=close` | 173 | 84,539 |
| night run cycle, close | …`&time=night&cam=close` (`--wait 15000`) | 173 | 84,539 |
| mid-jump (apex hold) | …`&qaact=jump&cam=close` | 173 | 84,539 |
| mid-slide (hold) | …`&qaact=slide&cam=close` | 173 | 84,539 |
| menu regression | `?qa=1&scene=menu&seed=1` | **147** | **82,377** — bit-identical to 3.1/3.2/3.3 |
| game regression | `?qa=1&scene=game&mode=drive&seed=1` | **147** | **82,377** — bit-identical |

Readability (crop-inspected): dusk reads as a backlit runner silhouette
mid-stride down the centre lane — leg separation, knee flex, arm swing,
backpack mass, grounded shadow opposite the low sun (art-bible "quiet
apocalypse" backlit read, same class as the 3.1 horde); night is the hero
read — moonlit rust jacket, charcoal denim, tanned neck/head, arm swing
past the lit convoy bus with a grounded shadow on the asphalt. Mid-jump
holds the tuck at the apex (knees up, arms thrown, off the ground);
mid-slide holds the compact crouch (numerically verified: hips 0.462 m,
slideW 0.95, conveyor at dolly+7) — from dead-behind the backpack dominates
the crouch silhouette at ~11 m (pose is 4.4-tunable; noted as a read nit).
Draw delta at frame level: 147 (game baseline) → 173 (+22 player +4
post-pipeline variance, in line with prior tasks' variance notes).

Regressions re-run green with the final code: `.qa/zombie_probe.mjs`
(+2 draws, heap 0), `.qa/obstacle_probe.mjs` (+3, heap 0, truth 22/22),
`.qa/pickup_probe.mjs` (+2, heap 0), `.qa/state_probe.mjs` (`ok: true`,
`problems: []`, clean console beyond the 4 documented env notices). Menu and
game captures bit-identical — attract paths never construct the player.

### Size note (transparency, 3.3 precedent)

The staging move (`qa/player_stage.js`, 5,270 B outside the metric) plus
dense-but-documented code kept the js/ delta at +12,915 B → total
323,036 B. That is under the 320 KB cap read as 320×1024 = 327,680 B
(4.6 KB margin) but 3.0 KB over a strict 320,000 B reading; player.js is
10,591 B vs the ≤10 KB target (the API contract header it must carry for
4.3 is ~1.4 KB of that). Reclaim path if the strict reading is enforced:
6.1's `staged=gauntlet` replaces all four temporary stagings — the 3.1/3.2
stages still inside js/ total ~10.7 KB — and `4.4`'s sweep can fold the
`OBSTACLES.profile` QA-mock default into `PLAYER.profile`. Flagging rather
than stripping the entity module's contract documentation.

### Contract notes for 4.3 / 4.4 / 6.1

- **4.3 (RUN mode)**: construct `createPlayer(scene, lib)` in `enter(ctx)`.
  Per fixed step: `player.z = focusZ; player.fixedUpdate(dt, speed);` THEN
  `obstacles.collide(player.profile)` (a non-null hit = death record — call
  `player.die()` + the 3.3 death burst before shell `endRun(stats)`) and the
  zombie radial check vs `player.profile.x/z` (~0.5 m). Route actions:
  `left/right/jump/slide` → the matching `request*()` (routing table 2.2).
  Per rendered frame: `player.updateRender(alpha)`. On retry/reset:
  `player.reset()` (pooled world reset keeps the rig; no allocation).
  HUD/camera reads: `player.profile.x/z`, `player.state`,
  `player.group.position`.
- **4.4 (config sweep)**: `PLAYER.profile.standTop` (1.75) is the LIVE
  stand-top the mode passes; `OBSTACLES.profile.standTop` remains only as
  collide()'s QA-mock default — fold them if desired. The jump arc
  (`v0 5.6/g 15.5`, apex ≈1.01 m, air ≈0.72 s) gives ~2.8 m of y0 ≥ 0.8
  clearance span at 8 m/s against the low barrier's ±0.58 m padded window —
  retune `v0`/`gravity` there if the skill window should widen. Slide pose
  leg/arm targets are authored in `PLAYER.pose` beside the run amplitudes.
- **6.1 (official staging)**: `staged=player` (hooks whitelist, main.js
  block, `qa/player_stage.js`) is the temporary stand-in to be replaced by
  `staged=gauntlet` — DELETE this stage module with the 3.1–3.3 stages and
  build the gauntlet on the permanent `createPlayer` + the entity managers
  (the player stage is the only one outside js/, so deleting it is
  budget-positive). Keep the patterns: `window.__QA_PLAYER.measure()`
  (added-draw A/B), the autopilot + `&qaact=jump|slide|left|right|dead`
  pin-with-hold (hold thresholds in `STAGE.freezeAt`; just-past-apex for
  jump, settled pose weights for slide/dead, half a lane ease for lanes),
  and the capture recipe: NO `&freeze=1` for pinned actions — the held pose
  rides the conveyor while the camera settles (freeze=1 also freezes the
  camera lerp mid-flight, the documented variance class; the stage's own
  dt-0 hold is the freeze). `&time=8` lands the conveyor in a plain chunk
  at dusk; night has no numeric skip (`--wait 15000`).
- Known limitations: no back-mounted rim light — rim rides the sky/env like
  every entity (dusk reads backlit, night reads moonlit by design); the
  slide silhouette reads compact-blocky from dead-behind at >10 m (pose
  targets are 4.4-tunable); lane lean is a root roll only (no yaw slip —
  authored choice, the shambler sway language); cadence freezes during
  jump/slide so the run cycle resumes at the phase it left (no pop — the
  pose weights blend the limbs back over ~1/12 s); the stage autopilot
  makes unstaged-`qaact` captures non-deterministic in WHICH action is
  live (motion variance class, same as the unseeded dust).

## Task 4.1 — chunk callbacks + gameplay dressing

Date: 2026-09-26. `js/world/world.js` gains the chunk-activation callback API
(design decision 3) and the `gameplay` dressing flag (design decision 4);
`js/world/chunks.js` buildWrecks shifts ON-road wreck slots to the shoulders
when the flag is set. Raw own-JS: 323,036 → **327,298 B** (+4,262; amended cap
320 KB — 327,298 sits 382 B under the 320×1024 = 327,680 reading and ~4.3 KB
over a strict 320,000 B reading; see the size note). The delta is dominated by
the documented API contracts; the code paths themselves are ~40 lines. Probe
and staging live in `qa/` (outside the metric).

### API added (exact signatures, `js/world/world.js`)

```js
world.onChunkActive(fn);    // fn(index, zStart) — chunk enters the window
world.onChunkInactive(fn);  // fn(index)        — chunk leaves the window
world.setGameplay(on);      // dressing flag; rebuild semantics (below)
world.gameplay;             // getter (probe/4.3 read-back)
```

- Fired from the EXISTING `_spawnChunk`/`_despawnChunk` paths (after the
  `_active` map insert/delete, both pool-fresh and pooled-reuse spawns).
  Order contract (documented on `update()`): every inactive callback fires
  BEFORE every active callback, each pass ascending by chunk index (despawn
  scans `_active` insertion order = spawn order; the spawn pass ascends);
  `reset()` fires inactives only. No callbacks registered = zero behavior
  change (empty-loop no-op, no allocation).
- Factory ctx now carries `gameplay: boolean` at (re)build time:
  `factory(rng, { index, zStart, lib, gameplay })` — `plain` ignores it;
  `wreck`/`convoy` pass it to `buildWrecks(rng, kind, index, gameplay)`.

### Flag semantics decision: a flip REBUILDS every built chunk

`setGameplay(on)` sets the flag, then `reset()` (firing inactive callbacks on
the live window, same path as the 2.4 pooled retry) AND flushes the chunk
pools (groups removed from the scene, per-chunk vehicle InstancedMeshes
disposed; shared archetype geometry and the world-owned dressing/shambler
pools untouched). Rationale: pooled chunks replay their BUILD-time placement
streams (task 1.2 semantics), so a stale pool would resurrect unshifted
attract wrecks mid-run — new-chunks-only would break the corridor guarantee
at every run start (menu attract streams the window the player starts in).
This matches `retryRun()`'s discard-and-restream economics: the next
`world.update()` re-streams the window under the new flag with no allocation
spike. Corollary: the corridor guarantee is per-BUILD (any gameplay build is
safe at any index), so gameplay→gameplay pool reuse stays safe forever.

### Wreck shift (chunks.js buildWrecks)

With `gameplay` set, `addVeh` rewrites each slot's x AFTER its rng draws:
`x = sign(x) * max(|x|, GUARDRAIL.xInner + hullHalfWidth + WRECKS.gameplay.shoulderGap)`
— `hullHalfWidth` from the shared archetype bounding box, `shoulderGap: 0.15`
(new `CONFIG.WRECKS.gameplay` section, the task's only tunable). Every current
slot is ON-road (|x| ≤ 5.9 vs lane edges 5.1), so all of them move out to the
roadside row the streetlights (7.7) and guide signs (7.0) already line, with
seated wheels, spare wheels and contact shadows following (all derive from the
shifted x). Both sides shift symmetrically. Off-road/shoulder dressing
(scrub/rocks/mesas/debris band, shamblers) stays as-is; CHUNK_PLAN identical;
CORRIDOR_CLEAR unchanged (attract-only).

**rng-order preservation argument**: the shift is a placement-only transform
of the value a draw produced — no draw is added, removed, reordered, or
conditioned on the flag anywhere in buildWrecks (the paint/tone/debris draws
are unchanged; downstream consumers — spare-wheel anchors, debris clustering —
clamp or derive without new draws). Evidence: placement hashes of the same
freshly built chunks with all x translations excluded (vehicle matrices'
element 12, stream entries' [0], shambler x) are BIT-IDENTICAL between
attract and gameplay builds — every retained value (z, y, sink, rotations,
scales, instanceColor tones, stream counts, chunk types) matches exactly.

### Evidence

`.qa/chunk_probe.mjs` (new, kept as the world regression tool for 4.2): three
loads of seed=1 — attract ×2 + `?scene=game&mode=run&gameplay=1` — each
driving the world synchronously via `window.__QA_AUDIT.world` (QA surface
gained `world`). `ok: true, problems: []`, `consoleErrors: []`,
`pageErrors: []` (only the 4 documented ANGLE boot notices):

- **Callbacks**: slide-to-400 → inactive [-1..6] then active [9..16]; pooled
  reuse slide-to-100 → inactive [9..16], active [1..8] (reuse still fires);
  `reset()` → inactive [1..8] only; setGameplay flips → inactive for the live
  window, restream → active. Every zStart === index × 40 exactly; all
  inactives before all actives; both passes ascending — including across
  `world.reset()`.
- **Corridor** (placement-data check, not eyeball): gameplay builds — 0 of 13
  vehicle instances intersect the 3-lane corridor; worst inner-flank margin
  6.70 m vs the 5.1 m lane edge (min target = 6.55 + half + 0.15). Attract
  builds — 13 violations, worst inner flank 1.10 m (hulls deep in the lanes;
  the check is meaningful).
- **Determinism** (FNV placement hashes over window -1..6, all-fresh builds):
  attract cross-load bit-identical (`771a74a7`), gameplay-boot vs
  gameplay-flip bit-identical (`5902e083`), attract-no-x vs gameplay-no-x
  bit-identical (`b929219b` — the rng-order proof), setGameplay round trip
  bit-identical (`771a74a7`); hashes stable across probe processes.
- Probe harness note (documented in the file): like-for-like snapshots
  require all-fresh builds — pooled groups replay their build-time layout
  (1.2 semantics), so the probe reset+flushes pools before snapshotting.

Captures (shot.mjs, 1600×900, SwiftShader medium; PNGs in `.qa/shots/4.1/`;
all `ready: true` after `--wait 12000` — the dusk menu missed the default 6 s
drain window once, the documented 2.3 flake):

| capture | url | draws | tris |
|---|---|---|---|
| menu regression | `?qa=1&scene=menu&seed=1` | **147** | **82,377** |
| game regression | `?qa=1&scene=game&mode=drive&seed=1` | **147** | **82,377** |
| gameplay flag on (run rig) | `?qa=1&scene=game&mode=run&seed=1&gameplay=1` | 147 | 82,377 |
| gameplay pair (2nd load) | same | 147 | 82,377 |
| gameplay close | …`&cam=close` | 147 | 82,377 |
| attract dressing (flag off twin) | `?qa=1&scene=game&mode=run&seed=1` | 147 | 82,377 |

Draws/tris bit-identical everywhere — the shift moves instances, adds none
(dressing pools draw unculled; vehicle meshes stay in frame). Pixel A/B
(`.qa/png_diff.mjs`): menu new-vs-3.4-baseline **0.014 mean / 0.05% >8**
(new-vs-2.5: 0.924 / 0.08%) — far below the documented same-code noise floor
(1.035–1.073 mean); gameplay-vs-attract 4.241 / 7.64% — the intended wreck
delta (hulls visibly lined beyond both guardrails, corridor clear); gameplay
same-code pair 3.439 / 6.34% — the documented GAME warm-frame camera-sway
class (2.5 floors: 4.483–4.669). Eyeball: attract twin shows bus/truck
blocking lanes ahead; gameplay shows both on the shoulders past the rails.

Regressions re-run green with the final code: `.qa/state_probe.mjs`
(`ok: true, problems: []`), `.qa/zombie_probe.mjs`, `.qa/obstacle_probe.mjs`,
`.qa/pickup_probe.mjs`, `.qa/player_probe.mjs` (all `ok: true`,
`consoleErrors: []`, `pageErrors: []`).

### Size note

+4,262 B (world.js +972, chunks.js +~1,050 of docs/code, config.js +~350,
main.js +~400, hooks.js +~90, round to the measured total) — flagged per the
3.3/3.4 precedent rather than stripping the API contracts. Reclaim path
unchanged: 6.1's gauntlet retires the 3.1–3.3 in-module stages (~10.7 KB).

### Contract notes for 4.2 (director) / 4.3 (mode) / 6.1

- **4.2 (spawn director)**: register `world.onChunkActive((index, zStart) => …)`
  and `world.onChunkInactive((index) => …)` once at manager construction —
  activation pre-builds a chunk's entity set from the tag-4 seeded streams,
  deactivation releases it (`obstacles.release` / `pickups.release` /
  `zombies` release by chunk bookkeeping). Order contract above means a
  despawned chunk's entities are released before newly activated chunks
  spawn into the freed pools. `world.reset()` (retry) releases EVERYTHING via
  the inactive path — the director must tolerate all-release/all-reactivate
  bursts. The shoulder-shifted dressing is exactly the design-risk mitigation:
  lane obstacles only need `occupied()` checks against EACH OTHER, since no
  dressing hull shares the corridor in gameplay builds.
- **4.3 (RUN mode)**: call `world.setGameplay(true)` in `enter(ctx)` and
  `world.setGameplay(false)` in `exit()` — BEFORE the first `world.update`
  with the mode's focus z (the flip re-streams synchronously on next update;
  no allocation spike). On retry the flag is already true → `setGameplay`
  early-returns (idempotent, zero cost); on quit-to-menu the flip back
  rebuilds the attract window for the menu dolly. QA preview without the
  mode: `?gameplay=1` (qa/hooks param, main.js QA gate).
- **6.1**: `?scene=game&mode=run&seed=1&gameplay=1` stages a settled gameplay
  capture with the corridor visibly clear (`--wait 12000` for SwiftShader);
  the gauntlet staging should keep the flag ON for its run-scoped captures.
  `.qa/chunk_probe.mjs` is the streaming-regression tool: re-run after any
  world/chunk change (callbacks + corridor + determinism in one report).
- Known limitations: gameplay builds shift hulls past the guardrail (crashed-
  through-the-rail read — deliberate; hulls never CLIP the rail: inner flank =
  xInner + half + 0.15); debris/scatter dressing still reaches into the road
  band (small charred panels, unchanged from attract, not a wreck slot); a
  flag flip discards pooled chunk groups (probe-side leaks stay until page
  end; in play the flip happens once per enter/exit — the discarded groups'
  instance buffers are disposed immediately).

## Task 4.2 — score + spawn director

Date: 2026-09-26. `js/game/score.js` (new) + `js/game/director.js` (new): the
per-run scoring ledger and the chunk-keyed spawn director (design decisions 3
+ 9). Raw own-JS: 327,298 → **342,965 B** (+15,667; score.js 1,735 +
director.js 10,230 = **11,965 combined, inside the ≤ 12 KB task target**;
config.js +~2.1 KB for `SPAWN`/`SCORE`, main.js +~1.3 KB, hooks +~0.1 KB).
Size note (3.3/3.4/4.1 precedent): the amended 320 KB cap read as 320×1024 =
327,680 is now exceeded by ~15.3 KB — the reclaim path is unchanged (6.1
retires the in-module 3.1–3.3 QA stages, ~10.7 KB, and the 4.4 sweep can fold
`OBSTACLES.profile` into `PLAYER.profile`); director.js carries its mandated
stream-derivation + contract documentation (~3 KB of the module).

### File layout

- `js/game/score.js` — `createScore()`: `reset()`, `onPickup(n)`, `distance`
  setter (mode focus z − run-start baseline), `snapshot()` →
  `{distance, pickups, score, currency}` (the exact `endRun`/gameover stats
  shape; reuses one object — zero allocation).
- `js/game/director.js` — `createSpawnDirector({world, seed, zombies,
  obstacles, pickups})`: registers `world.onChunkActive/onChunkInactive` once
  at construction; `fixedUpdate(dt, focusZ)` per fixed step; `reset()`;
  `live` Map (QA read-only per-chunk manifests `{bands, zoms, picks}`).
- `js/core/config.js` — `SPAWN` section (all director tunables, ramp tables
  documented in-line) + `SCORE: { pickupValue: 5, pickupScore: 25 }`.
- `js/main.js` — QA-gated preview (`?qa=1&gameplay=1` ONLY): constructs the
  three managers + score + director before the first `world.update`, ticks
  `runScore.distance = dollyZ − runStartZ` + `spawnDir.fixedUpdate(dt,
  dollyZ)` from the shell fixed step, exposes `window.__QA_SPAWN`. 4.3's RUN
  mode replaces this surface (constructs in `enter(ctx)`, drives from its own
  fixed step); attract/menu paths never construct any of it — menu/game
  captures stay bit-identical (below).
- `qa/hooks.js` — header comment only (`gameplay=1` now boots the director).
- `.qa/spawn_probe.mjs` (new, kept as the director regression tool).

### Director algorithm

Per chunk activation (`index`, `zStart = index × CHUNK_LEN`), skipped while
`index < SPAWN.graceChunks` (clear runway):

1. **Streams** (bible rule 7; documented derivation in director.js): tag 4 is
   the dedicated SPAWN tag (builders use 1–3, world.js `TAG`); each feature
   draws from its own `mulberry32(hashSeed(seed, 4, index, featureTag))`
   stream (obstacles 1 / zombies 2 / pickups 3) — appending the feature tag
   keeps the part lists disjoint from the builders' `(seed, 1–3, index)` and
   from each other. Density ramp `t = clamp((index − graceChunks) /
   rampChunks, 0, 1)` consumes no draws. Managers draw no rng (pool-slot
   tone/jitter/phase), so the streams alone decide the layout.
2. **Obstacle bands (0–2)**: count from the ramped `band.chance` (+ `second`
   for a second band in the chunk's other half, ≥ 6 m apart); z from the
   half's span; composition = 1–3 lanes filled with DISTINCT archetypes
   (Fisher–Yates lane + type shuffles; per-lane z jitter ≤ `band.jitter`).
   **Passability validator**: open lanes + clearable (`low`/`gantry`) lanes
   ≥ 1 at spawn time — re-rolled from the SAME stream (≤ 4 candidates), then
   a single clearable barrier fallback (always passable). Distinct-type
   compositions make failure impossible by construction ({low,gantry,block}
   full bands carry 2 clearable lanes); the validator enforces the invariant
   if 4.4 retunes the tables. Each item spawns only if
   `!obstacles.occupied(z − zHalf − pad, z + zHalf + pad, lane)` (skipping an
   item only OPENS lanes; with all features chunk-local this never fires in
   practice).
3. **Zombie pack (0–1)**: ramped `pack.chance`; lane, size 2–4, speed
   2.4–3.4 m/s, member spacing 4–7 m and lead z from the zombie stream;
   members skip a ±1 m window where `occupied()` holds (never spawn inside a
   band); pack truncates to remaining pool room (`ZOMBIES.max 32` — the
   graceful back-pressure guard; bounds below keep it silent on the QA
   medium tier).
4. **Pickup strands (0–2)**: ramped `strand.chance` (+ `second`), 3–6
   markers at `spacing 2.2` m, `perChunkMax 6` per chunk (PICKUPS.max 48 =
   6 × 8-chunk window); the whole strand skips if its lane's span touches an
   obstacle window (`occupied(z0 − pad, z0 + span + pad, lane)`); a pool-full
   tail drops gracefully.
5. **Per fixed step** (`fixedUpdate(dt, focusZ)`): every director zombie
   approaches straight at the focus (`z.z −= speed·dt`, CALLER-OWNED per the
   manager contract), poses `lunge` inside `pack.lungeAt` 7 m, and is
   released once `pack.cullBehind` 14 m behind (passed). Packs always meet
   the player before their chunk deactivates (closing ≥ ~10 m/s vs ~43 s
   window residency at cruise), so chunk-deactivation release is the
   frozen-sim backstop, not the visible path. Then the three managers' own
   passes (gait matrices / night gantry blink / emissive pulse). Allocation-
   free; manifests allocate at ACTIVATION rate only.

Capacity bounds (why layout determinism never degrades to pool state on the
8-chunk medium window): ≤ 6 obstacles/chunk with ≤ 2 of any type (distinct
archetypes per band) vs 24/type; ≤ 6 pickups/chunk vs 48; ≤ 4 zombies/chunk
× 8 window = 32 exactly at the all-chunks-max worst case (the chance ramps
make that improbable; live-play concurrency is far lower — packs only live
while approaching, ~5–7 chunk crossings).

### Scoring formula (design 9, unified with the 2.5 ledger)

```
score    = floor(distance) + pickups × CONFIG.SCORE.pickupScore (25)
currency = pickups × CONFIG.SCORE.pickupValue  (5 — the 2.5 endRun credit)
```

One ledger (`score.js`); `snapshot()` returns
`{distance, pickups, score, currency}` — 4.3 passes it to shell `endRun()`
in place of the ad-hoc stats defaults (the `save.currency += pickups ×
SCORE.pickupValue` line in endRun already matches `snapshot().currency`
exactly — no second write path; 4.4's sweep retunes both values in CONFIG).

### Determinism evidence (`.qa/spawn_probe.mjs`, SwiftShader medium)

Probe registers a second `onChunkActive` (fires after the director's) and
deep-copies each chunk's manifest AT ACTIVATION (pooled records get reused;
zombies move on the first step), then FNV-1a hashes `{type,lane,x,z}` per
chunk over a synchronous 20 → 2000 m window slide (55 chunk manifests, 8 m
steps cross every boundary). `ok: true, problems: []`,
`consoleErrors: []`, `pageErrors: []` (only the 4 documented ANGLE notices):

| check | result |
|---|---|
| same seed, full `world.reset()` + re-run | 55/55 per-chunk hashes identical |
| same seed, second page load (cross-load) | 55/55 identical |
| different seeds (7 vs 8 vs 9 vs 10) | full maps differ (seed-7 chunks 1–8: `e92fcdbc a2cbac68 96ef09b4 6d3b4ccc 7165e885 317d79c4 9487fbc6 ddf646f1`; seed-8 differs from chunk 2 on — chunk 1's `e92fcdbc` is the shared EMPTY-manifest hash: grace/rng can legitimately roll a bare chunk) |
| callback release/leaks | live counts pin to the window baseline `{z:9, o:5, p:11}` across 20 chunk cycles (21 samples, drift 0); `world.reset()` → all zero |
| heap, forced GC | 600 `fixedUpdate` steps (approach+lunge+cull+manager passes): **retained 0 B**; 10 activation cycles: **retained 0 B** (activation-rate manifest churn fully collected) |

### Passability evidence

The probe validates EVERY band at activation across 4 seeds and the full
2000 m slides: **818 bands checked, 0 failures** (open-or-clearable lane ≥ 1
in every band; with the distinct-type composition rule a full band always
carries two clearable lanes, a 2-lane band one open lane).

### Integration smoke (?gameplay=1, director live)

`?qa=1&scene=game&mode=run&seed=11&time=38&gameplay=1` after
`screenshotReady`: 8 chunk manifests, `{zombies 8, obstacles 14, pickups 4}`
live, score ledger at `distance 288` (`CRUISE.run 7.5 × 38 s` + live-frame
drift), `currency` formula verified, 2 zombies closing within 60 m of the
focus, 164 draws / 95,097 tris. A near-field scan across seeds/times confirms
strands and packs stream through the player's frame (e.g. seed 9 t 42:
strand at 5 m; seed 13 night: pack at 26 m).

Captures (shot.mjs, 1600×900; PNGs in `.qa/shots/4.2/`; all `ready: true`
after `--wait 15000` — the first dusk attempt hit the documented 6 s default
drain flake; `consoleErrors: []`, `pageErrors: []` everywhere):

| capture | url | draws | tris |
|---|---|---|---|
| gameplay dusk: band + pack | `?qa=1&scene=game&mode=run&seed=11&time=38&gameplay=1` | 164 | 95,097 |
| gameplay dusk: gantry/low + 2 zombies lane +1 | `…&seed=9&time=38&gameplay=1` | 149 | 95,837 |
| gameplay night: pack beside convoy + headlight pool | `…&seed=13&time=night&gameplay=1` (`--wait 15000`) | 155 | 94,607 |
| menu regression | `?qa=1&scene=menu&seed=1` | **147** | **82,377** — bit-identical to 3.1–4.1 |
| game regression | `?qa=1&scene=game&mode=drive&seed=1` | **147** | **82,377** — bit-identical |

All ≤ 220 draws and far under the 500 k tri cap (gameplay adds ~+13 k tris:
zombie figures + band/strand instances). Crop-inspected at 2–3×: the dusk band
frame reads block (amber reflectors) + striped trestle + gantry lamps with
the pack ahead; the second frame carries two chasing silhouettes in lane +1;
night shows the olive pack beside the lit convoy bus under the headlight
pool. Note: 4.1's `?gameplay=1` capture now includes live director entities
(same URL, new content — the flag boots the director since this task);
`freeze=1` + `cam=` framing was tried and rejected for captures (freezes the
camera lerp mid-flight — the 3.4 documented class) and pickup-strand framing
at the ready flip varies with SwiftShader capture lag (documented
warm-frame variance class) — 6.1's `staged=gauntlet` conveyor is the right
deterministic-framing tool for the 6.2 hero shots.

Regressions re-run green with the final code: `.qa/zombie_probe.mjs`,
`.qa/obstacle_probe.mjs`, `.qa/pickup_probe.mjs`, `.qa/player_probe.mjs`
(all `ok: true`, `consoleErrors: []`, `pageErrors: []`),
`.qa/state_probe.mjs` (`ok: true, problems: []`, clean console),
`.qa/chunk_probe.mjs` (`ok: true, problems: []`; attract cross-load,
gameplay-boot-vs-flip, rng-order and round-trip hashes all bit-identical —
the director's registration does not perturb the callback order contract).
Post-probe trims to director.js/score.js were comment-only (node --check
verified; the final probe run above is post-trim).

### Contract notes for 4.3 (RUN mode) / 4.4 (config sweep) / 6.1

- **4.3**: replace main.js's `?gameplay=1` preview block — in `enter(ctx)`:
  `world.setGameplay(true)` FIRST (4.1), then construct
  `createZombieManager/createObstacleManager/createPickupManager` +
  `createScore()` + `createSpawnDirector({world, seed, …managers})` (the
  director registers its callbacks at construction — do it before the first
  `world.update` with the mode's focus z). Per fixed step, in order: advance
  the player (`player.z = focusZ`), THEN `dir.fixedUpdate(dt, focusZ)`
  (zombie approach uses the fresh focus), then `obstacles.collide(profile)`
  + the zombie radial check vs `player.profile` (director zombies carry
  `x/z`; ~0.5 m lane check), `pickups.tryCollect({x: player.x, z: player.z})`
  → `score.onPickup()` + burst. On death: `endRun(score.snapshot())` — the
  shell's currency line already equals `snapshot().currency`. On retry:
  `world.reset()` fires the inactive burst → everything releases; call
  `score.reset()` and re-baseline the distance (the shell's `runStartZ`
  does this for the preview). On `exit()`: `dir.reset()` +
  `world.setGameplay(false)` + `mgr.reset()` ×3. Zombie lunge/cull and all
  densities are already director-owned; the mode owns ONLY its own movement
  and death checks.
- **4.4**: sweep `CONFIG.SPAWN` (graceChunks/rampChunks; band
  chance/second/lanes/jitter/pad; pack chance/size/speed/spacing/lungeAt/
  cullBehind; strand chance/second/size/spacing/perChunkMax/pad) and
  `SCORE.pickupScore`/`pickupValue`. Constraints to preserve while tuning:
  the capacity bounds in the SPAWN comment (≤ 6 obstacles and ≤ 6 pickups
  per chunk, ≤ 4 zombies/chunk on an 8-chunk window) keep layout
  determinism free of pool back-pressure; `strand.spacing ≥ ~1.5` keeps
  one collect per fixed step; the band validator will refuse impossible
  compositions if `lanes` ever allows 2+ blocks in a full band (re-roll
  makes it passable, but densities silently drop — keep distinct types).
- **6.1**: `staged=gauntlet` should stage its deterministic sequence
  THROUGH the director's surface where possible — the manager-level
  conveyors (`flush()` re-anchor) remain the capture tool for exact
  framing; `window.__QA_SPAWN` (director/score/managers) is the probe
  surface to keep. `?gameplay=1` is now a live-run preview (director
  spawning as the dolly streams) — the 4.1 corridor capture URL is
  unaffected in framing but now carries entities. Passability is enforced
  at spawn (director validator); the probe's band check
  (`.qa/spawn_probe.mjs`) is the regression to re-run after any SPAWN
  retune.

## Task 4.3 — RUN mode

Date: 2026-09-26. `js/modes/run.js` (new, **14,455 B** vs the ≤ 15 KB target):
the playable RUN mode against the full Mode contract — the first real consumer
of the 3.x entity systems and the 4.2 director. The temporary task-3.1/3.2/3.3
in-module QA stages are DELETED from `js/` (the planned ~10.7 KB reclaim, plus
main.js's stage/preview wiring) and the probe fixtures moved OUT of the byte
budget to `qa/entity_stage.js`; main.js replaces the stub shim with real mode
activation + focus-z dolly ownership (design 2); `window.__QA_SPAWN` is
replaced by the mode-owned `window.__QA_RUN`. Raw own-JS: 342,965 → **344,138 B**
(**net +1,173 B**: run.js +14,455, config RUN section + grace note ≈ +1.5 KB,
offset by entities −11,980 [zombies 22,772→18,866, obstacles 19,346→15,841,
pickups 14,713→10,144], main.js −1,299 [stage/preview blocks deleted, mode
activation added], config stage tables −1,850). Amended 320 KB cap: over by
~16.5 KB (×1024 reading) — the prior reclaim path is now SPENT on run.js; the
remaining documented trims are 4.4's (`OBSTACLES.profile` fold) and a future
doc-diet pass. qa/ additions (outside the metric): `qa/entity_stage.js`
+13,056 B, `qa/hooks.js` whitelist ±0, `qa/player_stage.js` unchanged (now
probe-installed in-page instead of main-constructed).

### What landed

- `js/modes/run.js` — `createRunMode()` (one instance per session, main-owned):
  - **enter(ctx)** — ctx = `{scene, world, input, audio, save, hud, seed,
    staged, startZ, endRun}` (main.js builds it; `hud` is null until 5.1).
    `world.setGameplay(true)` FIRST (4.1: before the first world.update with
    our focus — shoulder-shifted dressing + director registration), then the
    pooled systems are built ONCE per session (player + 3 managers + particles
    + score + director; enter/exit only scene.add/remove them, so retry cycles
    never re-allocate GPU buffers) and the run re-baselines at `startZ`
    (fresh runs CONTINUE from the dolly — retry keeps the world's z).
  - **exit()** — director.reset() + all manager resets + fx.reset(),
    scene objects removed (menu attract carries ZERO gameplay draws),
    `world.setGameplay(false)` (attract window restreams, 4.1).
  - **restart(startZ)** — fresh run without exit/enter (retry, pause RESTART,
    menu select): pooled resets + ledger reset + focus re-baseline. The
    retry round-trip measured **0.1–0.2 ms** synchronous (run_probe).
  - **fixedUpdate(dt)** (shell calls it in GAME only) — stepwise speed ramp →
    focus advance (focus IS player z; main.js reads `.focus` and drives both
    `world.update(dt, focusZ)` and the camera dolly with it) → gauntlet
    conveyor (staged only) → `player.z = focus; player.fixedUpdate(dt,
    speed)` → `director.fixedUpdate(dt, focus)` (zombie approach + the three
    manager passes) → `fx.update(dt)` → `pickups.tryCollect(player.profile)`
    → `score.onPickup(1)` + pickup burst → death checks (below). Score
    distance tracks `focus − baseline` every step.
  - **update(dt, alpha)** — `player.updateRender(alpha)` only (bible rule 5);
    entities ride the fixed-step matrices (documented 3.1 limitation).
  - **cameraRig()** — CONFIG.RIGS.run on a reused scratch object with the
    lane term riding the runner: `laneX0 = RIGS.run.laneX0 + player.renderX ×
    RUN.camFollowX (0.65)` — edge lanes keep the runner in frame; main.js
    lerps toward it on the EXACT menu-dolly path (same `updateCamera`), fov
    blend included. Returns null until entered (?cam override and
    menu/GAMEOVER fallbacks unchanged).
  - **hudLayout()** — `{ root: "hud-run" }`, allocated once. 5.1's mount
    contract; the mode holds `ctx.hud` (null today) and pushes nothing —
    see the 5.1 note below.
  - **stagedScenarios()** — the gauntlet spec verbatim (below).
  - Mode extensions: `restart(startZ)`, `focus` getter (null when not
    entered), `onReady(focusZ)` (ready-flip staging hook), `systems()`
    (?qa=1 only → `window.__QA_RUN`), `staged` getter, `handleAction`.
  - **handleAction(action)** — `left/right/jump/slide` → the matching
    `player.request*()` (2.1 action strings; 2.2 routing table untouched).
- `js/main.js` — the stub shim becomes real mode activation:
  `activateMode(next)` swaps stub ↔ runMode (exit on leave, enter on run,
  `__QA_RUN` published under ?qa=1); `setMode()` calls it (covers the live
  `mode-N` switch in GAME); `enterGame()` calls `activeMode.restart(dollyZ)`
  after activation (fresh-run path for menu select / pause RESTART / retry);
  `enterMenu()` exits the mode. fixedUpdate syncs `dollyZ = activeMode.focus`
  when the mode supplies one, else the legacy `dollyZ += speed × dt` shell
  dolly drives DRIVE/RIDE/attract unchanged. rigTargets prefers
  `activeMode.cameraRig()` in GAME/GAMEOVER (no `?cam`). staged=beauty stays
  mode-free (`activateMode` early-returns) — the beauty diorama keeps its
  static dolly. Deleted: the four temporary stage blocks + ticks, the 4.2
  `?gameplay=1` preview block (`__QA_SPAWN`), their imports. Kept: the 4.1
  `?gameplay=1` menu-boot gate (chunk_probe A/B).
- `js/core/config.js` — new **RUN** section (below); `SPAWN.graceChunks
  1 → 2`; the three temporary `*.stage` tables deleted.
- `js/entities/{zombies,obstacles,pickups}.js` — `create*Stage` exports
  deleted verbatim from js/ (the managers themselves untouched); pickups.js
  drops its now-unused particles import.
- `qa/entity_stage.js` (new) — the three stages moved out of the byte budget
  with their constants localized (`Z_STAGE`/`O_STAGE`/`P_STAGE` — QA-only,
  deliberately not gameplay CONFIG). Surfaces (`__QA_ZOMBIES/__QA_OBSTACLES/
  __QA_PICKUPS`) are byte-identical; the probes now import + construct them
  in-page (`stageZombies()` etc. on `__QA_AUDIT.scene`) and re-anchor a
  conveyor with `fixedUpdate(0, focusZ)` — nothing ticks them but the probes.
- `qa/hooks.js` — `staged=` whitelist is now `beauty | gauntlet`; header
  rewritten.
- `.qa/run_probe.mjs` (new) — the E2E suite (below). Entity probes +
  spawn_probe retargeted (fixtures self-staged; `__QA_SPAWN` → `__QA_RUN`).

### CONFIG.RUN (speed ramp + death + rig tunables)

| key | value | meaning |
|---|---|---|
| `speedStart` | 7.5 m/s | == CRUISE.run so staged-gameover defaults (`round(CRUISE × t)`, tasks 2.2/2.4 evidence) stay exact at the base step |
| `speedStep` | 0.6 m/s | added per ramp step (spec: "increases stepwise") |
| `stepDist` | 250 m | metres covered per step |
| `speedMax` | 11.7 m/s | cap — reached at 1,750 m (~3 min live) |

Ramp table: `speed(d) = min(11.5→11.7, 7.5 + 0.6 × floor(d / 250))` — i.e.
7.5 (0 m) → 8.1 (250) → 8.7 (500) → 9.3 (750) → 9.9 (1000) → 10.5 (1250) →
11.1 (1500) → 11.7 (1750). Pure function of distance (determinism), cadence
clamps at PLAYER.gaitHz 3.1 so the gait saturates gracefully.

| key | value | meaning |
|---|---|---|
| `contactR` | 0.6 m | zombie contact radius (radial vs the live profile x/z; ~0.5 m body + lunge arms read; per-step closing ≤ 0.25 m — no tunneling) |
| `evadeY` | 0.5 m | a lunge cannot catch feet above this — jump evasion (spec scenario); y0 ≈ 0 at the arc ends, so landing ON a zombie still kills |
| `deathSettleS` | 0.55 s | live-world settle between die() and shell endRun(): the crumple eases in (poseEase 12) and the death burst fades while the world still ticks — the gameover reveal holds a readable death frame instead of a mid-stride freeze. Stats are final at die(); endRun fires exactly once |
| `camFollowX` | 0.65 | run-rig lane-follow (laneX0 rides the player; RIGS.run untouched) |

### Death paths + one config fix

- **Obstacle**: `obstacles.collide(player.profile)` once per fixed step with
  the LIVE eased profile (3.2 contract). A hit ends the run.
- **Zombie contact**: radial `contactR²` vs `player.profile.x/z` over the
  zombie pool, gated by `profile.y0 < evadeY` (jump evades mid-arc, landing
  doesn't; lane changes evade by geometry — 3.4 m lane pitch vs 0.6 m radius).
- **Sequence**: `player.die()` → `fx.burst(x, 0.5, focus, "death")` →
  `dying = deathSettleS` (world stays live: manager passes animate the pack,
  particles fade, focus holds) → `ctx.endRun(score.snapshot())` — ONE call
  (state guard in the shell + `dead` latch in the mode). Verified formulas:
  distance 84 / pickups 1 → score 109 = 84 + 1×25, currency 5 = 1×5 (run_probe).
- **`SPAWN.graceChunks` 1 → 2**: the 4.2 comment always said "chunk 0–1 stay
  clear" but the code only skipped index 0 — harmless while nothing could
  die, and fatal with a live player (a chunk-1 pack spawns at lead ≥ 48 m vs
  the z=20 start, closing ~10.5 m/s ⇒ contact in under 3 s, no skill
  window). Two grace chunks ≈ 8 s of runway; chunk 1 (the always-convoy
  hero cluster) also stays entity-free. Layout hashes change accordingly
  (spawn_probe re-run: 818 bands, 0 passability failures; determinism
  same-load + cross-load + cross-seed all green).

### Gauntlet staging contract (for 6.1 / 6.2)

`stagedScenarios().gauntlet`, applied by the mode when `?staged=gauntlet`
(ctx.staged). Capture URL:

```
?qa=1&mode=run&scene=game&staged=gauntlet&seed=11[&time=night][&time=12][&freeze=1][&cam=close|side]
```

- **Conveyed tableau** — every staged record is re-anchored at
  `focus + offset` each fixed step (obstacles via `flush()`, pickups via
  `flush()`, zombies by position before the manager pass), so captures catch
  the exact same framing regardless of warm-frame/drain timing (the 4.2
  lesson) and `&time=night` needs no numeric skip. Offsets (m ahead):
  low barrier lane 0 +22 · zombie run lane 0 +30 / +33 · zombie lunge
  lane +1 +37 · pickup strand lane −1 +40…+48.8 (5 × 2.2 m) · gantry
  lane 0 +56 · block lane +1 +63. At the default start (focus 20) the
  tableau spans world z 42–83 = grace chunks 0–1, so director spawns stay
  background depth; if the player runs on, `obstacles.occupied()` reserves
  the conveyed windows against director bands/strands (packs may cluster
  harmlessly — conveyed zombies are not in the director's approach list).
- **Autopilot** — `{first 0.9 s, every 1.7 s, [jump, left, slide, right]}`
  fired through the player's request API: pure pose variety (conveyed
  hazards never arrive). Capture pose varies with freeze phase (the
  documented motion variance class).
- **Ready-flip flash** — `onReady(focusZ)` fires the 3.3 burst pair
  (pickup lane 0 +6, death lane +1 +9.5) + `fx.update(0)`, so `freeze=1`
  captures hold BOTH burst types at full fade in frame.
- **Settle** — `screenshotReady` additionally waits
  `gauntlet.settleS = 2.6 s` (main.js reads it from `stagedScenarios()`):
  the menu-rig → run-rig camera glide completes BEFORE the freeze, so
  `freeze=1` holds the settled chase framing (freeze without settle would
  catch the lerp mid-flight — the documented 3.4 class).
- **Death suppressed while staged** (QA-only exception, documented in the
  mode header): the collide/contact checks are skipped so a long SwiftShader
  drain window can never end a capture. Everything else (ramp, streaming,
  director, collection) runs live.
- Recipe: dusk `…&staged=gauntlet&seed=11&freeze=1`; night add `&time=night`
  (`--wait 15000` for the SwiftShader drain); a numeric `&time=` combines
  with the stage (conveyed framing identical). If 6.3's critic wants pinned
  action poses, the 3.4 `qaact` pin-with-hold pattern can be rebuilt probe-
  side over `__QA_RUN.player` — the stage that hosted it retired with this
  task.

### window.__QA_RUN (replaces __QA_SPAWN)

`{ player, zombies, obstacles, pickups, fx, score, director, focus(),
speed(), step(dt) }` — the LIVE mode systems, published by main.js under
`?qa=1` only (nulled on exit). `step(dt)` drives one full mode fixed step
synchronously (heap + deterministic contact tests). `?gameplay=1` no longer
boots a preview — with `scene=game&mode=run` the real mode IS the gameplay
surface; the flag remains meaningful only as the 4.1 menu-boot dressing gate.

### Verification evidence

`.qa/run_probe.mjs` (new; real CDP keys + the QA surfaces, 800×600,
`ok: true`, `problems: []`, `consoleErrors: []`, `consoleWarns: []`,
`pageErrors: []`, `envNoiseWarnings: 4` — the documented ANGLE boot notices):

- MENU → `1` + Enter (real keys) → GAME: `__QA_RUN` live, `world.gameplay`
  true; a real `a` routes to the mode (`__QA_SHELL.routed`) and the lane
  changes.
- **Autopilot survival**: an in-page 80 ms driver reading the live director
  layout and firing request*() (jump lows, slide gantries, dodge blocks and
  zombies via lane-clear scoring) survives 10.5 s of director-spawned
  hazards, distance 74.6 m accrued.
- **Pickups**: in-lane marker spawned ahead → ledger +1 (burst via fx).
- **Evasion + contact, deterministic** (shell paused, `__QA_RUN.step()` drives
  the mode synchronously): a jump clears a zombie dead ahead at +1.6 m
  (run continues); a grounded pass at +1.6 m ends the run — stats
  `{distance 84, pickups 1, score 109, currency 5}` — formulas exact.
- **Collision death once**: spawned block at +2 m → gameover in ≤ 1.1 s
  (0.55 s of that is the death settle), stats stable across 300 ms.
- **Retry**: synchronous round-trip **0.1–0.2 ms** (spec ≤ ~1 s); stats and
  ledger cleared, player alive, focus re-advancing.
- **Determinism**: same seed — per-chunk director layout hashes
  (FNV-1a over `{type,lane,z} / {x,z,speed}` manifests, 24 chunks over a
  20→800 m synchronous slide) identical across reset+re-run AND cross-load;
  seed 9 differs. (Layout hashing now also asserted on the REAL mode, not
  just the preview.)
- **Heap**: gc → 600 real `step(1/60)` hot-path iterations (ramp + player +
  director + collide scans + collect + bursts, hazards cleared ahead to keep
  the run alive) → gc: **retained 0 bytes**.

Regression probes, all re-run green on the final code (`ok: true`,
`problems: []`, clean console beyond the 4 documented env notices):

| probe | result |
|---|---|
| `.qa/run_probe.mjs` (new, above) | all 20 checks pass |
| `.qa/state_probe.mjs` (2.2) | green incl. `?scene=paused/gameover&mode=run` boots |
| `.qa/input_probe.mjs` (2.1) | green (menu path byte-identical) |
| `.qa/pause_probe.mjs` (2.3) | green (paused staged run freezes the mode too) |
| `.qa/gameover_probe.mjs` (2.4/2.5) | green — staged gameover stats unchanged (38 M at t=5), writes 1/death |
| `.qa/chunk_probe.mjs` (4.1) | green — attract/gameplay boot-vs-flip hashes bit-identical |
| `.qa/spawn_probe.mjs` (4.2, retargeted to `__QA_RUN`) | green — 818 bands 0 failures, determinism 3/3, leak drift 0, heap 0/0, new synchronous smoke (ledger formula + chase proof: zombies close to 0 m gap) |
| `.qa/zombie_probe.mjs` (self-staged fixture) | 32/32 live, +2 draws / +36,608 tris, anim live, heap 0 |
| `.qa/obstacle_probe.mjs` (self-staged fixture) | truth 22/22, occupancy 6/6, +3 draws / +228 tris, heap 0 |
| `.qa/pickup_probe.mjs` (self-staged fixture) | collection truth, pulse in band, particles recycle, +2 draws / +384 tris, heap 0 |
| `.qa/player_probe.mjs` (installs `qa/player_stage.js` in-page) | sim/interp/death green, +22 draws / +576 tris, shadow +11, heap 0 |

Perf (`.qa/perf_probe.mjs`, live gameplay `?qa=1&mode=run&scene=game&seed=11`,
SwiftShader medium): settled in-page **8.2–8.3 fps** idle / 7.4 during
captures — above the menu attract baseline (6.1 fps; the run rig sees fewer
chunks than the drive rig). **179 draws / ~88.7k tris** with ALL systems live
(player 11+11, zombies +2, obstacles +3, pickups+particles +2, director
entities in-world) — inside the ≤ 220 / ≤ 500k budgets.

Captures (shot.mjs, 1600×900; PNGs in `.qa/shots/4.3/`; `ready: true`,
`consoleErrors: []`, `pageErrors: []`, only the 4 documented env notices):

| capture | url | draws | tris |
|---|---|---|---|
| run gameplay dusk (hero) | `?qa=1&mode=run&scene=game&seed=11` | 179 | 88,849 |
| run gameplay dusk close | …`&cam=close` | 179 | 88,849 |
| run gameplay night | …`&time=night` (`--wait 15000`) | 190–197 | 88,859 |
| gauntlet dusk (freeze) | `?qa=1&mode=run&scene=game&staged=gauntlet&seed=11&freeze=1` | 181 | 92,749 |
| gauntlet night (freeze) | …`&time=night&freeze=1` (`--wait 15000`) | 192 | 92,759 |
| gauntlet + time skip | …`&staged=gauntlet&seed=11&time=12&freeze=1` | 155 | — |
| menu regression | `?qa=1&scene=menu&seed=1` | **147** | **82,377** |
| menu night regression | …`&time=night` | 159 | 85,875 |
| game regression (drive) | `?qa=1&scene=game&mode=drive&seed=1` | **147** | **82,377** |
| paused staged run | `?qa=1&scene=paused&mode=run&seed=11` | 179 | 88,849 |
| staged gameover | `?qa=1&scene=gameover&mode=run&time=8&seed=11` | 175 | 88,989 |

Pixel A/B (`.qa/png_diff.mjs`): menu new-vs-4.1 **0.125 mean / 0.23% >8** —
far below the same-code noise floor (1.035), i.e. the attract path is
pixel-clean; game (drive attract cruise) 1.90 / 1.73% — the documented GAME
warm-frame camera-sway class, draws/tris bit-identical. The paused/staged
gameover deltas (+22–26 draws vs 2.3/2.4's 153/151) are the runner + rig now
IN the frame (the mode is real): the staged captures show the runner
mid-road behind the shell chips — correct content, verified by probe.

### Contract notes for 4.4 / 5.1 / 6.1

- **4.4 (config sweep)**: RUN section is complete and in one place
  (`speedStart/speedStep/stepDist/speedMax/contactR/evadeY/deathSettleS/
  camFollowX`). Constraints to preserve: `speedStart == CRUISE.run` (staged
  gameover determinism, tasks 2.2/2.4 evidence), `contactR ≥ ~0.3` (per-step
  closing at speedMax is 0.25 m — smaller radii can tunnel), `stepDist` and
  the SPAWN ramp (`graceChunks 2 / rampChunks 40`) are tuned together so
  early chunks stay survivable at 7.5–8.1 m/s. Candidate fold: the
  `OBSTACLES.profile.standTop` QA-mock default into `PLAYER.profile` (3.4
  note) — obstacles.js reads `O.profile.standTop` only as collide()'s
  fallback; `qa/entity_stage.js`'s `run()` also reads it.
- **5.1 (HUD)**: `hudLayout()` returns `{ root: "hud-run" }` (allocate-once;
  slots/labels/chips are the HUD's own — distance/score/pickups numerals +
  touch pause chip; the chip should emit the existing `pause` action, 2.3
  note). The mode stores `ctx.hud` (null today) and currently pushes nothing:
  wire updates either by passing a hud object with an `update(stats)`
  method in main.js's mode ctx and calling it from the mode's `update()`
  when present, or by polling — the ledger source of truth is the mode's
  `score` (distance/pickups getters + `snapshot()`); live focus/speed are on
  the mode (`focus` getter is null-safe outside GAME). The HUD must exist in
  GAME only (shell toggles `gameui`; the HUD root mounts under the mode's
  class).
- **6.1 (QA contract)**: `staged=gauntlet` is fully staged NOW (URL +
  semantics above) — hooks.js whitelist is `beauty | gauntlet`; add new
  scene stagings there. `scene=paused/gameover` staging is untouched and
  mode-aware (the real RUN mode freezes/ends correctly under both —
  state_probe re-verified). The temporary `staged=zombies/obstacles/pickups/
  player` params are GONE; entity fixtures live in `qa/entity_stage.js`
  (probes self-stage in-page; captures needing a conveyed entity close-up
  can reuse the same module against `__QA_AUDIT.scene`). Keep the
  `measure()` A/B pattern — the exact added-draw numbers above (zombies +2 /
  +36,608 tris, obstacles +3 / +228, pickups+points +2 / +384, player +22 /
  +576) remain the per-system budget evidence.
- Known limitations: no audio calls yet (5.2 owns sfx — the ctx carries
  `audio` unused); death settle holds the world live for 0.55 s before the
  gameover screen (deliberate); no turn/crossroad mechanics (slice scope);
  gauntlet death-suppression is QA-only by design; the run rig's look target
  remains main.js's `sway × 0.4` formula (the runner reads slightly
  off-center at edge lanes — a 6.3 tuning knob via `camFollowX` if flagged).

## Task 4.4 — config sweep

Date: 2026-09-26. Grep-driven audit of every gameplay code path
(`js/modes/`, `js/game/`, `js/entities/`, gameplay touches in `main.js`);
all placement/spawn-shape literals CONFIG-sourced, the flagged
`OBSTACLES.profile` duplication folded, and a numeric playability pass over
the tuning tables. **Value-identical sweep** — every moved literal kept its
exact value AND its exact position in the rng draw order, so layouts are
bit-identical (verified: spawn_probe per-chunk hashes equal the pre-change
run's, below). Raw own-JS: 344,138 → **343,580 B (net −558 B)** — the fold
plus a doc-diet of the CONFIG headers that duplicated their consumer
modules' API-contract comments verbatim (obstacles/pickups/particles
semantics + the passability paragraph — all documented at the consumers).
Amended 320 KB cap (327,680 B): over by 15.9 KB, the known pre-existing gap
(run.js + contract headers); no new reclaim landed here beyond the fold.

### Flagged items

1. **`OBSTACLES.profile` fold (3.2/3.4 note)** — DONE. `PLAYER.profile`
   is the ONE source of the collide y-heights; `obstacles.collide()`'s
   QA-mock default now reads `CONFIG.PLAYER.profile.standTop` (hoisted once
   per manager), and `qa/entity_stage.js`'s `run()` mock + the exposed
   `__QA_OBSTACLES.playerProfile` follow (the obstacle probe reads the new
   surface key). The drift-prone second `standTop: 1.75` is gone.
2. **SCORE constants** — verified: `SCORE.pickupValue` (5) +
   `pickupScore` (25) are the only scoring numbers anywhere; consumers are
   `score.js snapshot()` and the one `endRun` currency credit (2.5/4.2
   shape). run_probe re-confirms the formulas exactly (109 = 84 + 1×25,
   currency 5 = 1×5).
3. **Playability sanity pass** — numeric check, NO retune needed (every
   value sits inside the documented safe bounds and produces grace +
   gentle escalation):
   - Grace: `graceChunks 2` ⇒ first spawnable content at z 80; at
     `speedStart 7.5` from `START_Z 20` that is **8.0 s** of clear runway.
   - First minute: ~466 m covered (speed 7.5 → 8.1 at the 250 m step);
     ramp t ≤ 0.25 ⇒ band chance ≤ 0.57, pack ≤ 0.31, strand ≤ 0.46 —
     gentle escalation over the ~12 chunks seen.
   - Jump arc (`v0 5.6 / g 15.5`): apex 1.012 m, air 0.723 s; the feet
     ≥ 0.8 span is 0.330 s = 2.48 m at 7.5 m/s (3.87 m at `speedMax`) vs
     the low barrier's 1.16 m padded window ⇒ **1.32 m initiation
     margin** — a real but fair skill window; `evadeY 0.5` < apex, so
     mid-arc jump evasion works and landing still kills.
   - Slide 0.7 s covers 5.3–8.2 m vs the gantry's 1.04 m window —
     generous, as intended for the harder read.
   - Contact: per-step closing at `speedMax` is 0.195 m vs
     `contactR 0.6` (≥ 0.3 anti-tunnel bound held); lunge at 7 m gives
     1.4–1.7 s of reaction at pack-closing speeds.
   - Bounds: strand `spacing 2.2` ≥ 1.5 (one collect/step); capacity
     bounds unchanged (≤ 6 obstacles, ≤ 6 pickups, ≤ 4 zombies/chunk vs
     24/48/32 pools).
   Constraints preserved: `RUN.speedStart == CRUISE.run` (staged-gameover
   determinism — gameover_probe re-verified 38 M at t=5), `contactR ≥ 0.3`,
   distinct band types (validator: 818 bands, 0 failures).

### Moved into CONFIG (all value-identical)

| file | literal | new key |
|---|---|---|
| director.js | band z margins `6` / second-band mid gap `3` | `SPAWN.band.edge` / `.splitGap` |
| director.js | validator re-roll cap `4` | `SPAWN.band.maxRolls` |
| director.js | pack lead inset `8` (lead range `len−2×inset−tail`) | `SPAWN.pack.inset` |
| director.js | member spawn-clear window `±1` m | `SPAWN.pack.clearWin` |
| director.js | member scale `0.94 + r()×0.12` | `SPAWN.pack.scale [0.94, 1.06]` (lerp — same draw) |
| director.js | strand start inset `4` | `SPAWN.strand.inset` |
| run.js | pickup burst origin `0.35` / death burst `0.5` | `PARTICLES.types.pickup.y` / `types.death.y` |
| main.js | gameplay dolly start z `20` | `START_Z` |
| player.js | initial cadence `2.5` | derived `(gaitHz[0]+gaitHz[1])/2` (same value) |
| particles.js | ground plane `0.03` / restitution `−0.35` / spawn jitter `0.12` | `PARTICLES.bounceY` / `.bounce` / `.jitterY` |

Config comment trims (behavior-free): the `OBSTACLES`/`PICKUPS`/
`PARTICLES`/`SPAWN` header blocks shortened to pointers — the full
collision/pulse/ring-allocation/passability semantics live verbatim in the
consumer module headers (obstacles.js, pickups.js, particles.js,
director.js).

### Residual-literal audit (what remains and why it is acceptable)

| file | remaining numbers | disposition |
|---|---|---|
| run.js | `STAGED.gauntlet` table (settle 2.6, auto cadence 0.9/1.7, convey offsets, flash offsets) | QA-staging constants, consumed only under `?staged=gauntlet` — the 4.3 precedent (qa staging deliberately not gameplay CONFIG); documented in stagedScenarios() |
| director.js | `TAG_SPAWN 4`, `FEAT_TAG 1/2/3`, `LANES/TYPES` | stream-derivation protocol (bible rule 7 structure, documented in the header) — retuning these re-keys the streams, they are not tuning values |
| director.js | `len * 0.5`, `Math.floor(r() * 3)`, `Math.max(…, 1)` guards | structural idioms (chunk midpoint, LANES-length, anti-degeneracy floor) |
| entities/*.js | `RIG` anatomy tables | documented precedent (config says so): part dimensions authored beside the pose composer |
| player.js / zombies.js | pose-composer internals (per-side asymmetries ±0.12/0.25/0.35, knee phase 2.8/0.55, wobble amps 0.035/0.05, splay blends, elbow flex) | authored pose-table blending internals, same class as RIG; the tunable amplitudes ARE in `PLAYER.pose`/`ZOMBIES.poses` |
| zombies.js / player.js | gait tempo `0.9 + frac×0.2`, breathing/knee bases | per-slot variance streams + composer bases (documented in gaitHzFor comment) |
| obstacles/pickups.js | golden-ratio hash constants (0.381966, 0.618034, …), tone `0.12` | determinism protocol + visual instanceColor variance channel (WRECKS.tone-class art authoring) |
| particles.js | `0.35 + 0.65` horizontal share, `0.4 + 0.8` up-variance | normalized distribution-shape internals of the slot streams (direction spread, not physical tuning) |
| main.js | camera lerp rate 5.5, breath roll 0.3/0.004, look `sway × 0.4` | camera-rig engine smoothing; per-rig tunables live in `CONFIG.RIGS` (the 4.3 note keeps `camFollowX` as the 6.3 knob) |
| main.js | routed-array cap 256 | QA trace tooling cap |
| particles.js | parked y `−50`, ground bounce sign | parking/sign idioms |

### Verification

- **Determinism**: `.qa/spawn_probe.mjs` re-run — per-chunk layout hashes
  **bit-identical to the pre-change run** (same values + draw order),
  same-load + cross-load identical, cross-seed differs, 818 bands 0
  passability failures, leak drift 0, heap retained 0. run_probe
  determinism: 24/24 chunk hashes identical, sample `75eccef9` stable
  across three runs.
- **All probes green on the final code** (`ok: true`, `problems: []`,
  `consoleErrors: []`, `pageErrors: []`, only the 4 documented ANGLE boot
  notices): run_probe (all 20 checks), spawn_probe, state_probe,
  input_probe, pause_probe, gameover_probe, chunk_probe, zombie_probe
  (32/32 live, +2 draws), obstacle_probe (occupancy 6/6, +3 draws —
  re-pointed at the folded profile surface), pickup_probe (+2 draws),
  player_probe (+22 draws). state/input/pause/gameover/chunk/zombie/
  pickup/player ran pre-trim, spawn/run/state re-ran post-trim; the trims
  are comment-only (node --check) and the post-trim runs reproduce
  bit-identical hashes — behavior identical.
- **Probe fix (harness race, not app code)**: run_probe's cross-load
  layout check failed intermittently during this task's re-runs.
  Diagnostic (two loads, per-chunk manifest dump): 24/24 identical when
  measured clean. Root cause: the probe's OWN contact-test spawns stay
  manager-live but out of director manifests, so `world.reset()` never
  releases them; enough leftovers skew the slide's
  `zombies.max − count` back-pressure and truncate late packs
  differently per page. Fix in `.qa/run_probe.mjs` hashLayouts: reset
  the three managers before `world.reset()` (idempotent — release() is
  a no-op on dead records; director zomList stays consistent via its
  indexOf guard). run_probe re-run green twice consecutively after the
  fix, determinism sample unchanged (`75eccef9`).
- **Playability smoke**: `?qa=1&mode=run&scene=game&seed=11` boots
  settled at 179 draws / 88,849 tris (identical to 4.3's hero numbers);
  run_probe's autopilot survival post-sweep: **75.1 m ≈ 10 s** of
  director-spawned hazards — same class as pre-sweep (74.6 m / 10.5 s),
  pickups collected, contact/evasion/retry formulas exact, heap
  retained 0.
- **Captures** (shot.mjs 1600×900; PNGs in `.qa/shots/4.4/`; all
  `ready: true`, `consoleErrors: []`, `pageErrors: []`):

  | capture | url | draws | tris |
  |---|---|---|---|
  | run gameplay dusk | `?qa=1&mode=run&scene=game&seed=11` | 179 | 88,849 |
  | run gameplay night | …`&time=night` (`--wait 15000`) | 190 | 88,859 |
  | menu regression | `?qa=1&scene=menu&seed=1` | **147** | **82,377** — draws/tris bit-identical to 3.1–4.3 |

  Menu regression pixel A/B (`.qa/png_diff.mjs`) against a PRE-change
  capture: **0.924 mean / 0.089% >8** — below the documented same-code
  noise floor (1.035–1.073 mean), i.e. the attract path is pixel-clean;
  gameplay draws/tris identical to 4.3's captures.

### Known limitations

- The amended-cap overshoot (15.9 KB) is unchanged in kind: run.js's
  mandated API/gauntlet documentation is the bulk; a dedicated doc-diet
  pass (beyond this task's duplication-only trims) remains the reclaim
  path.
- run_probe's hashLayouts now also depends on the mode's `systems()`
  surface exposing the three managers (it did — the fix consumes the
  existing `__QA_RUN` contract).

## Task 5.1 — HUD

Date: 2026-09-26. `js/ui/hud.js` (new, **3,161 B** vs the ≤ 5 KB target): the
in-run DOM HUD — distance/score/pickups numerals + touch pause chip, mode-
supplied placement class, `textContent`-only cached updates. Raw own-JS:
343,580 → **348,201 B (+4,621**: hud.js 3,161 + main.js/run.js wiring
≈ +1,460; amended 320 KB cap — the documented pre-existing overshoot grows by
this task's +4.6 KB). CSS +23 lines of HUD rules; `.qa/hud_probe.mjs` (new,
outside the metric).

### What landed

- `js/ui/hud.js` — `HudUI`, pause.js's pure-view pattern:
  - Constructor binds `#hud-pause` click → injected `onPause` and starts
    hidden. `show(on)` is a single `classList.toggle`, GATED on a mounted
    placement class — a layout-less mode can never show the HUD.
  - `setLayout({root}|null)` mounts/strips the mode's `hudLayout()` class
    (`hud-run`); `null` clears AND hides (enterMenu's quit path).
  - `update(stats)` — cached, textContent-only: each numeral writes ONLY
    when its integer value changed (caches start unset so the first real
    value always writes; the caches mirror what is ON SCREEN, so retry needs
    no reset()). `toLocaleString` formatting matches gameover.
- `index.html`: `#hud` `.screen` BETWEEN `#gameui` and `#pause` — DOM order
  stacks the pause scrim over the idle numerals and blocks the chip (2.3's
  "HUD chips underneath stay unclickable, which is wanted"). Structure:
  `.hud-strip` → 3 × `.hud-stat` (`.hud-label` over `.hud-num`; distance's
  numeral carries a static `M` unit span) separated by `.hud-sep` hairlines;
  `#hud-pause` chip after the strip. DOM-only, no canvas UI.
- `styles.css` (`#hud` section): root `pointer-events: none` in EVERY state
  (`#hud, #hud.on`) — only `.hud-chip` re-enables, so the full-viewport root
  can never eat gameplay swipes (window-level input listeners are unaffected
  either way; the guarantee is for clicks). Placement lives under the mode's
  class: `.hud-run .hud-strip` top-centre (top 16px, centred), `.hud-run
  .hud-chip` bottom-right (right 22 / bottom 18 — thumb corner). Numerals:
  32 px/700 `tabular-nums` amber with ONE restrained charcoal text-shadow
  (the only legibility scrim — no boxes; the chip reuses the shell's
  `.chip` recipe); labels 10 px tracked `--dim`; separators
  `--hairline-soft` 1 px. Matches the gameover stats treatment.
- `js/main.js`:
  - `hudUI = new HudUI({ onPause: () => routeAction("pause") })` — the chip
    lands on the shell's EXISTING action path, the exact route Esc's `pause`
    action takes (design 6). `modeHud = { update: (stats) => hudUI.update(
    stats) }` is the mode-ctx surface (4.3's contract) and replaces
    `hud: null` in `runMode.enter`.
  - `activateMode()` ends with `hudUI.setLayout(activeMode.hudLayout ?
    activeMode.hudLayout() : null)` — RUN supplies `hud-run`; the DRIVE/RIDE
    stub supplies none, which keeps their scenes HUD-free (regression
    guard). Same-mode re-activation early-returns, so retry keeps the class.
  - State wiring: `enterGame()` + the boot go-live block call
    `hudUI.show(true)` (GAME only); `endRun()` calls `hudUI.show(false)`
    (GAMEOVER hides); `enterMenu()` calls `hudUI.setLayout(null)`. PAUSED is
    inside GAME: nothing is hidden — the numerals stay and the pause scrim
    covers them, exactly like the `#gameui` chips (2.3 pattern).
- `js/modes/run.js`: `update()` pushes `score.snapshot()` to `ctx.hud` when
  present (render tick; main.js calls mode.update in GAME only and never
  while frozen/paused, so the numerals hold when the sim does — including
  the death settle, whose stats are final). snapshot() reuses its object;
  zero allocation. Header/hudLayout docs updated (the 4.3 "DOM hook does
  not exist yet" note retired).
- `.qa/hud_probe.mjs` (new): 7-phase suite — visibility per state, live
  numerals vs `score.snapshot()`, write-count/no-redundant-write over 300
  steady rAF frames (patched per-instance textContent setters), layout-read
  A/B (patched `getBoundingClientRect`/`getClientRects`/`offset*`/
  `getComputedStyle` counters, running vs paused windows), chip wiring
  (mouse click + CDP touch tap + scrim-block + ordering), collection (probe-
  spawned in-lane marker), GAMEOVER/retry/quit, stub-mode + staged boots.

### Update policy + evidence

`.qa/hud_probe.mjs` (`ok: true`, `problems: []`, `consoleErrors: []`,
`consoleWarns: []`, `pageErrors: []`, `envNoiseWarnings: 4` — the documented
ANGLE boot notices):

- **Values live + exact**: five 220 ms samples while running — DOM numerals
  equal `__QA_RUN.score.snapshot()` every time (distance/score/pickups,
  `toLocaleString` parsed back). Probe-spawned in-lane pickup → ledger AND
  DOM +1. Distance advances between samples; after retry it restarts near 0
  (< 15 m at +250 ms).
- **Write policy** (300-frame window, staged gauntlet run): distance
  **148** writes, score **148** (lockstep — score = floor(distance) +
  pickups×25), pickups **0**, redundant writes **0** (a setter call whose
  value already matched never happened). Distance is throttled to
  integer-metre changes by the cache; paused/frozen frames cost ZERO writes
  (mode.update is state-gated upstream).
- **Layout thrash: zero**. Patched layout-read APIs counted **0** calls
  during 300 running frames AND **0** during a 100-frame paused A/B window
  on the same scene — the HUD path never reads layout (pure textContent
  writes; no offset/rect/computed-style access anywhere in the loop).
- **Visibility**: MENU hidden (bare `screen` class) · GAME shown
  (`screen hud-run on`) · paused still `on` (numerals under the scrim) ·
  GAMEOVER hidden (live endRun AND `?scene=gameover` boot; layout class
  stays mounted but the root is hidden) · quit → MENU hidden AND class
  stripped · DRIVE stub GAME hidden, class bare, numerals untouched
  (`0|0|0`) — the drive attract capture stays HUD-free.

### Chip wiring

`#hud-pause` click → `routeAction("pause")` — no separate handler, no new
plumbing; `setPaused` toggles and the pause screen follows (the same
one-action-one-toggle contract as Esc). Evidence:

- Mouse click on the chip pauses in ONE toggle (`__QA.paused` true, pause
  screen on, dolly/sim bit-frozen, numerals frozen with the sim). A double
  toggle would have landed back on `false` — single-fire is proven by the
  flag itself. `__QA_ACTIONS` does NOT log the chip (that trace mirrors
  InputManager emissions only) — the ordering check shows exactly the inert
  `tap` preceding the click (2.3's pointerup-before-click note), routed to
  the mode once and ignored.
- While paused, a RAW mouse click at the chip's coordinates toggles nothing
  (the `#pause` scrim covers it) — screen stays up, still paused.
- CDP touch tap on the chip pauses in one toggle; the trace records taps
  only (Chromium's touch + compat-mouse pointerups = two inert `tap`
  entries — input-layer artifact, both harmless). RESUME via the pause
  screen keeps the HUD mounted (`screen hud-run on`, gameui on) and the
  numerals advance again.

### Captures (shot.mjs, 1600×900, SwiftShader medium; PNGs in `.qa/shots/5.1/`)

| capture | url | draws | tris |
|---|---|---|---|
| run gameplay dusk (HUD live) | `?qa=1&mode=run&scene=game&seed=11` | **179** | **88,849** |
| run gameplay night (HUD live) | …`&time=night` (`--wait 15000`) | 190 | 88,859 |
| gauntlet dusk freeze (HUD live) | `?qa=1&mode=run&scene=game&staged=gauntlet&seed=11&freeze=1` (`--wait 9000`) | 181 | 92,749 |
| gauntlet night freeze | …`&time=night&freeze=1` (`--wait 15000`) | 192 | 92,759 |
| menu regression | `?qa=1&scene=menu&seed=1` | **147** | **82,377** |
| menu night regression | `?qa=1&scene=menu&time=night&seed=1` | **159** | **85,875** |
| game regression (drive stub, HUD-free) | `?qa=1&scene=game&mode=drive&seed=1` | **147** | **82,377** |
| paused staged run (numerals under scrim) | `?qa=1&scene=paused&mode=run&seed=11` (`--wait 12000`) | 179 | 88,849 |
| staged gameover (HUD hidden) | `?qa=1&scene=gameover&mode=run&time=8&seed=11` | 168 | 88,415 |

- **The HUD adds ZERO draw calls**: run dusk/night and the gauntlet freezes
  are draws/tris BIT-IDENTICAL to 4.3/4.4's no-HUD references
  (179/88,849 · 190/88,859 · 181/92,749 · 192/92,759); menu and drive-game
  regressions bit-identical to the 3.1–4.4 line (147/82,377; menu night
  159/85,875).
- Pixel A/B (`.qa/png_diff.mjs`): menu 5.1-vs-4.4 **0.197 mean / 0.16%
  >8** — far below the documented same-code noise floor (1.035): the menu is
  pixel-clean with the HUD wired. Drive game 5.1-vs-2.4 0.953 / 2.53% — at
  the documented GAME warm-frame sway class. Run dusk 5.1-vs-4.4 (HUD
  added): 0.356 / 0.49% total, changed pixels attributed by region —
  **strip 1,428 px + chip 384 px**, the rest (5,238 px) the documented
  unseeded-dust/sway variance class. Gameover 5.1-vs-2.4 crosses eras
  (2.4 predates the real RUN mode in frame — 4.3 documented that jump);
  same-code gameover pair on the current build: 2.15 / 5.84% (the URL's
  sway class), and the gameover DOM is probe-deterministic (2.4) with the
  HUD hidden (hud_probe).
- **Legibility over dusk AND night** (crops of the strip region, x 600–1000
  × y 0–80, contrast = WCAG relative luminance): amber numerals vs
  background mean contrast **10.15:1 dusk / 9.99:1 night** (large-text AAA
  is 7:1) — the fixed top-centre mount sits in the dark upper sky band on
  both times of day, so the numerals never cross the bright horizon. The
  dim tracked labels read over both crops; the PAUSE chip holds via the
  `.chip` charcoal backing. The one text-shadow is the whole scrim.

### Regressions

All green on the final code (`ok: true`, `problems: []`, clean console
beyond the 4 documented env notices): `.qa/state_probe.mjs` (2.2),
`.qa/run_probe.mjs` (4.3 — all 20 checks, determinism sample `75eccef9`
stable, autopilot survival 74.9 m, heap retained 0), `.qa/input_probe.mjs`
(2.1), `.qa/pause_probe.mjs` (2.3), `.qa/gameover_probe.mjs` (2.4/2.5 —
retry 2.5–3.4 ms).

### Contract notes for 6.2 / 6.3

- **6.2 (HUD-inclusive capture list)**: every `scene=game` /
  `staged=gauntlet` capture now carries the HUD (numerals top-centre +
  PAUSE chip bottom-right) — the list as verified above: menu dusk+night
  regression pair, run gauntlet dusk+night
  (`?qa=1&mode=run&scene=game&staged=gauntlet&seed=11[&time=night][&freeze=1]`),
  gameover, paused, `&cam=close|side` action shots (close/side move the
  camera, not the DOM HUD — numerals stay put). Waits: gameplay night
  `--wait 15000`, gauntlet freeze dusk `--wait 9000` (2.6 s settle gate),
  paused `--wait 12000` (the documented 2.3 note). Paused/gameover captures
  include the runner (the 4.3 note); paused shows the DIMMED numerals under
  the scrim — that is the spec'd state, not a leak. Menu/gameover must show
  NO HUD (hud_probe asserts both; a stray numeral there is a bug).
- **6.3 (legibility crops to check)**: crop the strip region
  (x ≈ 600–1000, y 0–90 at 1600×900) on run dusk + night — measured
  10.15:1 / 9.99:1 amber-vs-sky; verify the dim labels still read at 1:1
  and that restraint holds (no boxes around the numerals — the single
  charcoal text-shadow is the only scrim; the numerals are the gameover
  stats treatment at 32 px). Crop the chip corner (x ≥ 1440, y ≥ 830): the
  `.chip` recipe matches `ESC · MENU`. Check the paused capture: numerals
  dimmed UNDER the scrim (equal to the world's dimming) and the panel
  unchanged. If the critic wants bigger numerals, `--hud-num font-size` is
  the single CSS knob (no JS constant involved).
- Known limitations: the amended-cap overshoot is now ~20.5 KB (the
  documented pre-existing 15.9 KB + this task's +4.6 KB; hud.js itself is
  3.2 KB) — the doc-diet reclaim path is unchanged. CDP touch taps emit two
  trace `tap` entries (compat-mouse artifact, inert in play). DRIVE/RIDE
  keep no HUD until their slices supply `hudLayout()` — the shell contract
  (ctx.hud, setLayout, show-gating) is ready for them.

## Task 5.2 — audio

Date: 2026-09-26. `js/core/audio.js` (rewrite of the silent stub, **4,646 B**
raw; the slice-1 stub was 954): six procedural SFX voices behind the existing
lazy-context unlock, master gain 0.8 at the first gesture. Hook points are a
documented split: shell/UI confirms at the main.js action/state layer,
gameplay events inside the RUN mode where the accepted-transition truth
lives. Audio is a side-effect observer everywhere — no play call reads or
writes game state. Raw own-JS: 348,201 → **354,479 B (+6,278**: audio.js
+3,692, config AUDIO +~830, main.js hooks +~330, run.js hooks +~830,
qa/hooks.js mirror +~230; ≤ 6 KB target hit within 0.3%, amended 320 KB cap —
the documented pre-existing overshoot grows by this task's +6.3 KB).

### Sound inventory + synth params (all tunables in `CONFIG.AUDIO`)

Master gain **0.8**, opened once at unlock; one shared 1.0 s looped
white-noise buffer (Math.random — audio noise, not gameplay rng; allocated
once at unlock, reused by every noise voice via BufferSource). Voices (f0/f1
Hz, dur s, vol linear gain; blips = one oscillator with an exponential pitch
move + gain decay to 0.001; noise voices = the shared buffer through a swept
band-pass; every voice self-stops at `t + dur`):

| voice | synth | params |
|---|---|---|
| `ui()` | triangle blip, pitch falls | 1160 → 880, 0.07 s, 0.35 |
| `pickup()` | triangle chirp, rises | 840 → 1680, 0.10 s, 0.40 |
| `jump()` | sine tick, high | 1350 → 1750, 0.05 s, 0.28 |
| `whoosh()` | noise band-pass sweep (subtle) | 480 → 1500 Hz, Q 1.1, 0.13 s, 0.20 |
| `swish()` | the whoosh path, lower/longer/softer | 240 → 640 Hz, Q 0.9, 0.22 s, 0.16 |
| `death()` | sawtooth pitch-drop **+** noise burst | 240 → 48 Hz, 0.50 s, 0.50; noise 900 → 120 Hz, Q 0.7, 0.30 s, 0.50 |

Node cost per play (verified by the probe's API-boundary counters): blips 2
(osc+gain), noise voices 3 (source+filter+gain), death 5. One bug found and
fixed by the probe's first run: `_burst()` originally started the node it
was handed, but the noise path hands it the FILTER (no `start()`) — the
signature now takes `(src, entry)` separately.

### Unlock flow (zero autoplay warnings by construction)

`routeAction()` already headed every action with `audio.unlock() +
audio.resume()` — the unlock rides the InputManager's action emissions, so
the first REAL gesture (any keydown or pointerdown, including DOM-button
clicks, whose window pointerdown precedes the click) creates the context,
sets master to 0.8 and resumes within the gesture (Chromium grants user
activation → state "running"; the 0-gain stub comment "silent until later
slices" is retired). Nothing at boot: no constructor, no listener, no
context outside a gesture — captures, which never gesture, never create one
and play nothing even when mode events fire (QA-injected deaths, staged
autopilot, director hazards). `dispose()` unchanged.

### Hook-point map (event → sound) — the documented split

**main.js (shell action/state layer — UI confirms):**

| event | path | sound |
|---|---|---|
| menu mode select (`mode-N` in MENU) | `routeAction` → before `menuUI.setMode` | `ui()` |
| run start (menu confirm), pause RESTART, gameover retry (Enter/Space/RETRY tap) | all funnel into `enterGame()` → one `ui()` each | `ui()` |
| pause RESUME (button or Esc-toggle) | `setPaused(false)` → `ui()` (idempotence guard = no stray sounds; pausing itself stays silent) | `ui()` |
| quit to menu (pause QUIT, gameover MENU/Esc, back chip) | `enterMenu()` → `ui()` | `ui()` |

Boot stagings (`?scene=game|gameover` → `enterGame`) call these paths with
no context yet → silent no-ops. Live in-game `mode-N` switches stay
deliberately silent (not a listed moment).

**run.js (mode event layer — gameplay, all `if (ctx.audio)`-guarded):**

| event | hook | sound |
|---|---|---|
| lane change left/right | `fixedUpdate`: `player.lane` diff around `player.fixedUpdate` — fires on ACCEPTED changes only (edge-lane nudges are player-level no-ops and stay silent) | `whoosh()` |
| jump | same diff: state run→jump (landing run←jump silent) | `jump()` |
| slide | same diff: state run→slide (slide-end silent) | `swish()` |
| pickup collect | the existing `tryCollect` success block (next to score/burst) | `pickup()` |
| death | the existing death block at the IMPACT (next to `player.die()` + burst), not at `endRun` — the sting lands with the crash, ~0.35 s before the gameover screen | `death()` |

Gameplay voices deliberately live in the mode, not in `routeAction`: the
player latches requests (mid-air jump/slide presses are dropped,
edge-lane nudges clamped), and only the mode sees the accepted transition;
the DRIVE/RIDE stub modes (whose `handleAction` is a no-op) correctly play
nothing. Shell endRun injection (`__QA_SHELL.endRun`) plays nothing — only
the mode's real death does.

### Verification evidence (`.qa/audio_probe.mjs`, new; real CDP keys,
800×600, context-level addInitScript spies on the AudioContext constructor
+ every create* call — proof at the API boundary, independent of the app's
own mirror; `ok: true`, `problems: []`, `consoleErrors: []`,
`consoleWarns: []`, `pageErrors: []`, `envNoiseWarnings: 4` — the
documented ANGLE boot notices):

- **Pre-gesture silence**: cold `?qa=1&scene=menu` — 0 AudioContexts, 0
  nodes, 0 plays; plain non-QA `/` load — 0 contexts, 0 nodes, zero console
  noise of any kind (no autoplay warnings anywhere, QA or not).
- **First gesture**: one CDP keydown → exactly ONE context, state
  **"running"**, a live gain at exactly 0.8, and the select confirm fired
  (`__QA_SFX.ui = 1`).
- **Event → sound mapping** (exactly-one per event, nothing else, node
  counts matching the voice table): `a`/`d` → whoosh (+3 nodes each), `w` →
  jump (+2), `s` (post-landing) → swish (+3), Esc-pause → silent, gameplay
  keys while paused → zero plays AND zero routed actions (gated upstream,
  confirmed), Esc-resume → exactly one `ui`, pickup spawned in-lane →
  exactly one `pickup`, block spawned into the lane → exactly one `death`
  + gameover, sting NOT repeated through the 0.35 s settle, shell
  `endRun()` silent, retry → one `ui`, GAMEOVER Esc-quit → one `ui`, menu
  select+start → two `ui`, gameplay key on the DRIVE stub → nothing.
- **Heap** (`--expose-gc`, `performance.memory`): 2 × 240 direct voice
  round-trips on the running ctx — usedJSHeapSize flat at every sample
  (before / after-loop+gc / after-settle+gc / after-round-2: all
  31,200,000, deltas 0 at Chromium's ~100 KB reporting granularity).
  Documented: WebAudio nodes are transient by design (JS wrappers retained
  only until their scheduled stop time passes, then GC-absorbed); there is
  no pooling layer and no per-frame allocation — nothing audio-side runs in
  the frame loop at all (event-driven only).
- **Fix found by this probe**: the `_burst` start-the-filter bug above
  (surfaced as a pageerror on the first whoosh; fixed, probe re-run green).

Regressions on the final code, all `ok: true` / `problems: []` / clean
console beyond the 4 documented env notices: `.qa/state_probe.mjs` (2.2),
`.qa/run_probe.mjs` (4.3 — all checks, determinism sample `75eccef9`
stable, autopilot survival 75 m), `.qa/hud_probe.mjs` (5.1), plus
`.qa/input_probe.mjs` (2.1), `.qa/pause_probe.mjs` (2.3 — resume/quit now
carry a `ui()` with zero behavioral drift), `.qa/gameover_probe.mjs`
(2.4/2.5 — retry 2.1–2.9 ms). One state_probe flake ("game dolly advances"
350 ms window) did not reproduce on re-run — the documented SwiftShader
frame-stall variance class (worst frames 383–517 ms, task 1.1).

### Captures (shot.mjs, 1600×900, SwiftShader medium; PNGs in `.qa/shots/5.2/`)

| capture | url | draws | tris |
|---|---|---|---|
| run gameplay dusk | `?qa=1&mode=run&scene=game&seed=11` | **179** | **88,849** |
| menu regression | `?qa=1&scene=menu&seed=1` | **147** | **82,377** |

Both `ready: true`, `consoleErrors: []`, `pageErrors: []`, exactly the 4
documented env notices, ZERO audio-related warnings — draws/tris
BIT-IDENTICAL to 5.1/4.4/4.3's no-audio references: audio adds zero draw
calls, zero tris, zero render cost (DOM/JS side-effect only).

### Capture-safety statement

`--mute-audio` was ALREADY in `.qa/shot.mjs`'s launch args (browser-level
output mute); the belt-and-braces guarantee is structural: captures never
gesture → `unlock()` never runs → `ctx === null` → every play no-ops
before touching WebAudio, and even gesture-free in-page events (staged
autopilot, injected deaths) count in `__QA_SFX` without creating a single
node. The 5 warm-frame `screenshotReady` gate adds no audio path. Verified
negatively by the probe (0 contexts / 0 nodes on cold menu, plain `/`, and
booted game scenes) and positively by every capture (no autoplay-policy
warnings — those fire on context creation without activation, which cannot
happen here).

### Notes for 6.2 / 7.2

- **6.2**: nothing changes in the capture list — audio is invisible to
  frames (bit-identical draws/tris above). `window.__QA_SFX` (?qa=1 only)
  is available if a staged capture ever wants to prove a sound FIRED
  (counts work without a context); `.qa/audio_probe.mjs` is the permanent
  regression tool for the mapping.
- **7.2 (E2E touch playthrough)**: touch swipes/taps emit the same action
  strings, so the same sounds map 1:1; the touch pause chip routes through
  `routeAction("pause")` (silent pause, `ui()` on resume). First-gesture
  unlock on touch = the first `pointerdown` (the "pointer" action
  unlocks before zone consumption).
- DRIVE/RIDE (later slices): the shell confirm hooks are mode-agnostic
  already; gameplay voices should follow the run.js pattern (accepted-
  transition hook inside each mode), and `CONFIG.AUDIO` takes new voices
  without structure changes. Engine/ambient loops (design 8's explicit
  out-of-scope) plug into `unlock()`'s context the same way.
- Known limitations: sounds are non-positional mono through the master
  gain (no panning/layering this slice); the amended-cap overshoot grows
  to ~26.8 KB (the documented doc-diet reclaim path unchanged); heap
  granularity is Chromium's coarse `performance.memory` buckets — the flat
  0-delta series is the honest bound available in this harness.

## Task 6.1 — QA contract

Date: 2026-09-26. Consolidation + verification of the full QA param/gate
surface (most of it was built incrementally by 2.2/2.3/2.4/4.3 — this task
made the CONTRACT true and verified it end to end rather than rebuilding).
**Raw own-JS delta: 0 bytes** (354,479 B total, bit-identical to 5.2 — every
change landed in `qa/` + `.qa/`, outside the metric). New tool:
`.qa/contract_probe.mjs` (11.9 KB) — the ONE consolidated matrix probe; it
boots every documented scene/param combination and asserts the ready gate,
the `__QA` mirror, `__PERF`/`__WORLD` population inside the bible budgets,
state-machine truth via `__QA_SHELL`, and zero console noise per cell.

### What landed

- `qa/hooks.js` — header rewritten into the AUTHORITATIVE param table
  (`?qa`, `&seed`, `&time=S|dusk|night`, `&freeze`, `&mode`, `&scene`,
  `&staged`, `&cam`, `&gameplay`, `&quality`) plus the ONE consolidated
  `screenshotReady` gate doc (below). No behavior change except one
  documentation-driven resolution: `scene=mode_select` is now an EXPLICIT
  accepted alias of menu (the menu IS the mode-select screen — three mode
  cards); `scene=shop` is documented as RESERVED (no screen this slice,
  falls back to menu like any unknown value). `__QA.scene` only ever
  mirrors a real machine scene: menu | game | paused | gameover.
- Audit result vs the AGENTS.md table: every documented param works.
  `cam=close|side|front|beauty` all resolve (each is a `CONFIG.RIGS` key;
  verified by fov/up assertions); `staged=gauntlet` requires
  `&scene=game&mode=run` (stages nothing in menus — now stated in the
  header); `?qa=1` service-worker bypass re-verified in-page
  (`getRegistration()` null under qa=1; sw.js skips any `qa=1` URL).
- `js/` — no changes needed; the gates in `main.js` frame() are already
  uniform (`resolveReady()` in hooks.js is the only ready arbiter).

### screenshotReady gate semantics (the one place)

Ready flips ONLY after ALL of (applied in main.js `frame()` via
`resolveReady()`, doc in `qa/hooks.js` header):

| gate | value | source |
|---|---|---|
| warm frames | >= 5 rendered frames | `CONFIG.WARM_FRAMES` |
| queue drained | `world.pending === 0` | main.js frame() |
| settle: staged=beauty | 1.5 s | `CONFIG.STAGED_BEAUTY.settleS` |
| settle: staged=gauntlet | 2.6 s | `run.js stagedScenarios().gauntlet.settleS` (menu-rig -> run-rig glide before freeze; QA-staging constant by the 4.3/4.4 precedent, NOT gameplay CONFIG) |
| settle: scene=paused | 1.0 s from the staged pause landing at the base gates | `CONFIG.STAGED_PAUSE.settleS` (pause overlay fade + reveal) |
| settle: scene=gameover | 1.1 s from the boot `endRun()` | `CONFIG.STAGED_GAMEOVER.settleS` (gameover overlay fade + reveal) |
| every other scene | no settle term (0 s) | — |

`freeze=1` then stops simulation time (rendering + grain continue). All
four settle values were verified as correct by their own tasks (2.3/2.4
probe opacity checks, 4.3 glide evidence) and re-pass here unchanged.

### The verified matrix (`.qa/contract_probe.mjs`, 19 cells)

`ok: true`, `problems: []`, `consoleErrors: []`, `consoleWarns: []`,
`pageErrors: []`, `envNoiseWarnings: 4` (see quirks: per browser PROCESS,
not per page). Every cell: screenshotReady flipped within its bound,
`__QA.{mode,scene,seed}` mirrored the URL, `__PERF` populated with
draws <= 220 / tris <= 500k, `__WORLD.chunks` = 8. Waits shown are the
per-cell probe bounds (all comfortably inside them).

| cell | params (after `?qa=1`) | ready ms | draws | tris | scene | mode | seed |
|---|---|---|---|---|---|---|---|
| menu-dusk | `&scene=menu&seed=1` | 5420 | 147 | 82,377 | menu | drive | 1 |
| menu-night | `&scene=menu&time=night&seed=1` | 5935 | 159 | 85,875 | menu | drive | 1 |
| mode-select-alias | `&scene=mode_select&seed=1` | 5115 | 147 | 82,377 | menu | drive | 1 |
| game-run | `&mode=run&scene=game&seed=11` | 5404 | 179 | 88,849 | game | run | 11 |
| game-run-freeze | `…&freeze=1` | 5338 | 179 | 88,849 | game | run | 11 |
| game-run-gauntlet-freeze | `…&staged=gauntlet&freeze=1` | 5332 | 181 | 92,749 | game | run | 11 |
| game-run-gauntlet-live | `…&staged=gauntlet` | 5501 | 181 | 92,749 | game | run | 11 |
| game-run-cam-close | `…&cam=close` | 9403 | 186 | 89,277 | game | run | 11 |
| game-run-cam-side | `…&cam=side` | 9461 | 186 | 89,277 | game | run | 11 |
| game-run-night | `…&time=night` | 5488 | 190 | 88,859 | game | run | 11 |
| game-run-time5 | `…&time=5` | 5489 | 186 | 89,277 | game | run | 11 |
| gameover | `&scene=gameover&mode=run&time=8&seed=11` | 5781 | 163 | 88,315 | gameover | run | 11 |
| paused | `&scene=paused&mode=run&seed=11` | 6242 | 179 | 88,849 | paused | run | 11 |
| cam-front-menu | `&scene=menu&cam=front&seed=1` | 9015 | 137 | 82,077 | menu | drive | 1 |
| cam-beauty-menu | `&scene=menu&cam=beauty&seed=1` | 8959 | 147 | 82,377 | menu | drive | 1 |
| seed-repro-a | `&scene=gameover&mode=run&time=5&seed=7` | 5508 | 175 | 97,923 | gameover | run | 7 |
| seed-repro-b | same URL, second load | 5718 | 175 | 97,923 | gameover | run | 7 |
| menu-gameplay-flag | `&scene=menu&seed=1&gameplay=1` | 5431 | 147 | 82,377 | menu | drive | 1 |
| shop-absent-fallback | `&scene=shop&seed=1` | 4774 | 147 | 82,377 | menu | drive | 1 |

Per-cell behavioral asserts (beyond the table): menu cells show the menu
and no HUD; `mode_select` boots the identical menu scene (draws/tris
bit-identical to menu-dusk); game cells show the HUD, the RUN mode live
(`__QA_RUN`), dolly advancing; freeze holds the dolly BIT-constant while
frames keep incrementing; gauntlet cells carry `staged=gauntlet` and the
freeze variant matches 4.3/5.1's bit-identical 181/92,749; cam cells match
`RIGS.{close,side,front,beauty}` fov (66/58/55/57) and front's up 1.75;
`time=5` fast-forward lands the dolly past 57.5 (START_Z 20 + 7.5 x 5);
gameover is GAMEOVER with deterministic stats distance 60 (round(7.5 x 8))
and NO HUD; paused is GAME + paused mirror true, dolly bit-frozen, HUD
still mounted under the scrim (the spec'd 5.1 state); the seed-repro pair
is boot-exact — distance 38, dolly 57.5, draws/tris bit-identical
(175/97,923); `scene=shop` boots the menu cleanly.

### Absent screens

- **shop** — does not exist anywhere this slice (no `#shop` DOM, no state,
  no UI module). `scene=shop` is reserved in hooks.js and falls back to
  the menu without noise (verified cell). Do NOT capture it for 6.2.
- **mode_select** — not a separate screen BY DESIGN: the menu carries the
  three mode cards, so the documented param resolves to the menu scene.

### Pre-slice scene regression (menu + beauty framing)

No `staged=beauty` PNG baseline was ever stored (1.2 recorded its draw
count only), so the beauty check is a same-code self-pair at the documented
noise floor plus the composition read; the plain-menu check diffs against
the stored 4.x baseline PNGs (same recipe `?qa=1&scene=menu&seed=1`,
147/82,377 — the bit-identical 3.1 -> 5.2 signature). PNGs in
`.qa/shots/6.1/`:

| pair | mean abs diff (0–255) | % pixels > 8 | floor? |
|---|---|---|---|
| beauty self-pair (6.1 a/b) | 0.355 | 0.93 | below the 1.035–1.073 attract floor (beauty's static dolly is MORE deterministic) |
| menu 6.1 vs 4.3 baseline | 0.226 | 0.23 | far below floor (4.3 itself measured 0.125/0.23) |
| menu 6.1 vs 4.4 baseline | 0.121 | 0.05 | far below floor |

Beauty framing re-verified by eye against `CONFIG.STAGED_BEAUTY`'s
composition notes: lit bus flank filling the right + lower third,
jackknifed trailer rear doors centre-left, guardrail sweeping in from the
right edge, sun disc + corona upper-left, spare wheel + shadow wedge at
the bus base. Draws/tris for beauty: 147/82,377 (1.2 recorded 157 for the
OLD pre-recompose pose — the pose moved in round-5; current numbers are
the correct signature and match the menu pool line).

### Known capture-environment quirks (for 6.2 planning)

- **The 4 ANGLE notices fire once per browser PROCESS, not per page**: the
  probe saw exactly 4 `[WebGL] GL Driver Message … GPU stall due to
  ReadPixels` warnings across 19 navigations in one browser (first boot's
  shader-compile stall). A shot.mjs run launches one browser per capture →
  4 notices per report, as documented since 1.1. Environment noise; not
  suppressible from app code.
- **`__PERF.fps` read at the ready flip is warmup-polluted** (~1.7–1.9 in
  the matrix; the cam cells that sampled 4 s later read 8–9.8). Never
  quote fps from a fresh-flip sample — use `.qa/perf_probe.mjs` (3 s
  settle) per the 1.1 note.
- **Camera-rig lerp converges for a few frames AFTER the ready flip** on
  non-staged scenes (rawDt clamped to 0.1 s, SwiftShader frames run long):
  `cam=close` sampled instantly read fov 65.07 vs 66 target. shot.mjs
  captures are unaffected (the screenshot round-trip adds settle time);
  probe-side samplers should allow ~2–4 s before asserting rig values
  (the probe uses 4 s on cam cells).
- **SwiftShader waits**: dusk menu/game/gameover/gauntlet freeze ready in
  ~5–6 s (default `--wait 6000` is tight; `--wait 9000` is the safe
  dusk bound, used for gauntlet's 2.6 s settle). Night needs
  `--wait 12000` (menu/paused/gameover) to `--wait 15000` (gameplay/
  gauntlet — the live director + entities lengthen the drain). These are
  the 2.3/4.3/5.1 bounds, re-confirmed here.

### Notes for 6.2 / 7.1

- **6.2 (authoritative capture recipes)** — all verified this task:
  - menu dusk `?qa=1&scene=menu&seed=1` (`--wait 9000`) + menu night
    `…&time=night` (`--wait 12000`)
  - run gameplay dusk `?qa=1&mode=run&scene=game&seed=11` + night
    `…&time=night` (`--wait 15000`)
  - gauntlet dusk `?qa=1&mode=run&scene=game&staged=gauntlet&seed=11&freeze=1`
    (`--wait 9000`) + night `…&time=night&freeze=1` (`--wait 15000`)
  - action shots: add `&cam=close` / `&cam=side` (HUD stays put; draws 186)
  - gameover `?qa=1&scene=gameover&mode=run&time=8&seed=11` (dusk hero:
    60 M + NEW BEST; night `--wait 12000`)
  - paused `?qa=1&scene=paused&mode=run&seed=11` (`--wait 12000`)
  - beauty (art-critic extra): `?qa=1&scene=menu&staged=beauty&seed=1`
    (`--wait 9000`)
  - `scene=mode_select`/`scene=shop` need NO captures (alias / absent).
  Every cell above already shows `consoleErrors: []` and in-budget
  draws/tris; 6.2 can reuse `.qa/contract_probe.mjs` as the pre-flight
  before the PNG pass.
- **7.1**: the matrix doubles as the per-scene budget evidence — worst
  observed draws 190 (run night) / 197 (4.3's gauntlet night history),
  worst tris 97,923, all versus the 220 / 500k caps; raw own-JS unchanged
  at 354,479 B (the documented amended-cap overshoot is unchanged and
  still rides the doc-diet reclaim path).
- The probe is the permanent contract regression tool: add a `run()` cell
  here (and a hooks.js header line) whenever a new param/staged scene
  lands.

## Task 6.2 — capture set

Date: 2026-09-26. Full 1600×900 PNG pass over the 6.1 recipe table (URLs and
waits used verbatim; `bun .qa/shot.mjs`, one browser per capture). **No code
changes** — captures + this report only. All 12 captures: `ready: true`,
`consoleErrors: []`, `pageErrors: []`, and consoleWarns = EXACTLY the 4
documented ANGLE/SwiftShader boot notices (all four `GPU stall due to
ReadPixels`; 6.1 quirk re-confirmed — one set per browser process). Draws ≤
220 and tris ≤ 500k in every report. PNGs in `.qa/shots/6.2/` (JSON reports
alongside; settled-fps probe reports in `.qa/shots/6.2/perf/`).

### The capture table (7.1's source — draws/tris from the shot.mjs reports; fps settled via `.qa/perf_probe.mjs` idleFps, 3 s settle + 4 s idle rAF count, NO capture running)

shot.mjs's own `__PERF.fps` read at the ready flip is warmup-polluted
(~1.5–1.9 here, same class 6.1 documented) — IGNORED. The fps column is the
probe's settled in-page fps (capture fps during continuous screenshots shown
in parentheses; 1.1's verdict stands: idle ≥ capture, screenshots cost wall
clock but not frame rate).

| name | url (after `?qa=1`) | wait ms | draws | tris | fps settled (capture) | consoleErrors |
|---|---|---|---|---|---|---|
| menu dusk | `&scene=menu&seed=1` | 9000 | **147** | **82,377** | 8.66 (8.02) | [] |
| menu night | `&scene=menu&time=night&seed=1` | 12000 | **159** | **85,875** | 8.48 (7.89) | [] |
| gauntlet dusk freeze | `&mode=run&scene=game&staged=gauntlet&seed=11&freeze=1` | 9000 | **181** | **92,749** | 8.21 (7.58) | [] |
| gauntlet night freeze | `&mode=run&scene=game&staged=gauntlet&seed=11&time=night&freeze=1` | 15000 | **192** | **92,759** | 8.18 (7.65) | [] |
| run gameplay dusk (hero) | `&mode=run&scene=game&seed=11` | 9000 | 179 | 88,849 | 7.19 (5.86) | [] |
| run gameplay night | `&mode=run&scene=game&seed=11&time=night` | 15000 | 190 | 88,859 | 7.32 (6.03) | [] |
| action cam=close | `&mode=run&scene=game&seed=11&cam=close` | 12000 | 179 | 88,849 | 6.68 (5.75) | [] |
| action cam=side | `&mode=run&scene=game&seed=11&cam=side` | 12000 | 179 | 88,849 | 6.49 (5.30) | [] |
| gameover dusk hero | `&scene=gameover&mode=run&time=8&seed=11` | 9000 | 168 | 88,415 | 8.86 (7.79) | [] |
| gameover night | `&scene=gameover&mode=run&time=night&seed=11` | 12000 | 177 | 85,139 | 7.82 (6.67) | [] |
| paused | `&scene=paused&mode=run&seed=11` | 12000 | 179 | 88,849 | 6.89 (6.68) | [] |
| beauty (6.3 extra) | `&scene=menu&staged=beauty&seed=1` | 9000 | **147** | **82,377** | 5.95 (5.58) | [] |

- `scene=mode_select` / `scene=shop`: NO captures per 6.1 (menu alias /
  reserved-absent, boots the menu cleanly).
- Waits follow 6.1's SwiftShader bounds (`--wait 9000` safe dusk, 12000
  night menu/paused/gameover, 15000 night gameplay); the cam cells used
  12000 (6.1's probe saw their ready flip at ~9.4–9.5 s, above the 9000
  dusk bound). No retries were needed — zero failed captures.
- Draw-count variance note: the cam cells read 179 here vs 186/89,277 in
  6.1's matrix — the probe sampled those ~4 s after the flip (rig glide +
  dolly further down the road → more hulls in frustum). Same documented
  warm-frame/sway class; every reading inside budget. Same class explains
  gameover dusk 168 here vs 163 (6.1 matrix) — 168/88,415 is bit-identical
  to 5.1's gameover; the probe's later settled sample read 133/87,405
  (sway-phase frustum culling). All in the documented variance band.

### Budgets + headroom (for 7.1)

- Raw own-JS: **354,479 B** (`wc -c` over `js/**/*.js`) — byte-identical to
  5.2/6.1, 0 delta this task; the amended-cap overshoot is unchanged and
  still rides the documented doc-diet reclaim path.
- Draw-call headroom: worst observed ANYWHERE this task = **198 draws**
  (gauntlet night freeze, probe settled sample; the shot report itself read
  192 — capture worst 192, probe worst 198) → **22 draws of headroom** under
  the 220 cap (28 using the capture-report worst). Worst tris **92,959**
  (same cell) → ~407 k under the 500 k cap. Settled SwiftShader fps range
  5.95–8.86 — inside 1.1's documented 5–8 band (±25% host variance); the
  fps verdict and its escalation remain 1.1's, unchanged by this task.

### Regression pair (menu dusk + night vs the established baselines)

Draws/tris EXACT against the 3.1→6.1 bit-identical signature: menu dusk
147/82,377 (== 4.3/4.4/5.1/6.1), menu night 159/85,875 (== 5.1/6.1);
paused 179/88,849, gameover dusk 168/88,415 and beauty 147/82,377 also
bit-identical to their 5.1/6.1 references. Pixel A/B
(`.qa/png_diff.mjs`, 1600×900):

| pair | mean abs diff (0–255) | % pixels > 8 | floor? |
|---|---|---|---|
| menu dusk 6.2 vs 6.1 `menu_seed1` | 0.115 | 0.20 | far below the 1.035–1.073 attract floor |
| menu dusk 6.2 vs 5.1 `menu_seed1` | 0.035 | 0.06 | far below floor |
| menu dusk 6.2 vs 4.3 `menu_regression` | 0.141 | 0.08 | far below floor (cf. 6.1-vs-4.3's 0.226/0.23) |
| menu night 6.2 vs 5.1 `menu_night` | 0.044 | 0.03 | far below floor |
| menu night 6.2 vs 4.3 `menu_night_regression` | 1.409 | 0.95 | below the 1.636/1.94% night same-code floor |

All pairs at/below their documented floors — the menu (and the paused /
gameover / beauty stagings by bit-identity) is pixel-clean; residual diffs
are the documented unseeded dust + sway class. **PASS.**

### Files (6.3 consumes these PNGs next)

`.qa/shots/6.2/menu_dusk.png`, `menu_night.png`, `gauntlet_dusk_freeze.png`,
`gauntlet_night_freeze.png`, `run_dusk.png`, `run_night.png`,
`run_dusk_cam_close.png`, `run_dusk_cam_side.png`, `gameover_dusk.png`,
`gameover_night.png`, `paused_dusk.png`, `beauty_dusk.png` (per-capture JSON
reports alongside; settled-fps probe reports under `perf/`).

## Task 6.3 — visual critic

Date: 2026-09-26. Harsh-critic A/B of the 6.2 set against the AGENTS.md art
bible (palette discipline, value structure, silhouette readability, UI
restraint), with fix authority. Method: every PNG reviewed at 1:1 plus 3–6×
NEAREST zoom crops of the suspect regions; sky/road palette MEASURED per
region (mean RGB → HSV hue band, PIL) rather than eyeballed; UI crops
compared against the shell's own treatments (HUD numerals, chip recipe).
Pre-fix record: the 6.2 PNGs (kept); post-fix re-captures: `.qa/shots/6.3/`
(same recipes/waits as 6.2, tables below).

### Per-capture verdicts on the 6.2 set (pre-fix)

| capture | verdict | evidence |
|---|---|---|
| menu_dusk | PASS | title restraint (no gradient/drop-shadow cheese), cards = charcoal + amber hairlines, selected card amber-only, footer tracked caps; world holds the reference bar (convoy hero, sign, lamp) |
| menu_night | PASS | lamp pools + lit SOLACE sign + city glow read; cards legible; stars + red horizon band |
| beauty_dusk | PASS | lit bus flank, jackknifed trailer, sun disc upper-left, contact shadows — composition intact |
| run_dusk | FAIL | top-left `ESC · MENU` chip is a live-run lie: Esc PAUSES in GAME (2.2 routing), the chip's click (`back`) is consumed — a dead, contradictory affordance next to the PAUSE chip; player head is a bare box slab (minor at this distance) |
| run_night | FAIL | same chip; eyeshine/pickups/reflector amber dots all read; road/fog values good |
| gauntlet_dusk_freeze | FAIL | same chip; striped low barrier reads jumpable, gantry hazard lamps mark the slide gap, pickup orbs + zombie pack read |
| gauntlet_night_freeze | FAIL | same chip; barrier stripes glow, eyeshine pairs visible (pale green-amber — usefully DISTINCT from amber pickups), moon/road split reads |
| run_dusk_cam_close | FAIL | player head = 0.21×0.24×0.23 BOX skull — the exact "toy" read the bible forbids ("stylized-realistic, not toy"); reads Minecraft at QA-close range; zombies (sphere rig) read fine |
| run_dusk_cam_side | FAIL | same box skull |
| gameover_dusk | FAIL | DISTANCE unit "M" floats ORPHANED at the row's right edge (`.go-stat-head` space-between) — a stray glyph where the eye expects a value; inconsistent with the HUD's tight "3 M" |
| gameover_night | FAIL | same orphaned M |
| paused_dusk | FAIL | ESC·MENU chip (dimmed, dead) contradicts the panel's "ESC RESUMES"; numerals correctly dimmed under scrim; panel hierarchy correct (RESUME amber primary) |

**Measured palette finding (report-only, see tensions):** dusk sky has ZERO
teal — mean hue 0–26° (RED/ORANGE) in every sampled band (top-right
rgb(4,2,3), mid-right rgb(47,18,14), horizon rgb(137,26,15) on run_dusk);
the bible's "deep teal-blue sky" + teal-shadow split-tone is absent at dusk.
Night HAS the cool dimension (road + upper sky hue 225 BLUE). The red dusk
is the established signature of every baseline since 1.1 — fixing it means
re-baselining the whole capture history, forbidden by this task's
menu-bit-identity constraint. Reported, not forced.

### Fixes applied (round 1)

1. **Player skull** — `js/entities/player.js`: box skull → low-poly sphere
   (`ball()` helper, SphereGeometry 7×6, r 0.125 @ y 0.25), matching the
   zombie family's rounded read. 11 meshes/11 draws unchanged; +116 tris
   (88,849 → 88,965 on run scenes; budget-fine).
2. **Gameover unit** — `index.html` + `styles.css`: `M` moved from the
   `.go-stat-head` row into `.go-num` after `#go-distance` (`.go-unit`
   14px/dim, mirroring `.hud-unit`'s treatment) — "60 M" now reads like the
   HUD's "3 M".
3. **ESC · MENU chip** — `js/main.js` (+3 lines) + `styles.css` (+1 rule):
   `#gameui` gains a `live` class in `enterGame` (removed in `endRun` /
   `enterMenu`); `#gameui.live #back-btn { display: none }`. The chip now
   appears ONLY in GAMEOVER, where its affordance is TRUE (Esc → menu).
   `#gameui.live #mode-label { margin-left: auto }` keeps RUN pinned
   right (with the chip hidden, space-between slid the label left — caught
   and fixed in round 1's own re-captures).
4. **Settle-gate margin (latent, exposed by 1–3)** — `js/core/config.js`:
   `STAGED_PAUSE.settleS` 1.0 → **1.3**, `STAGED_GAMEOVER.settleS` 1.1 →
   **1.5**. The old gates ignored up to one SwiftShader frame of
   CSS-transition START lag (~0.4 s worst frame): with any boot-time
   perturbation (here +671 B of JS) `pause_probe`'s settled-opacity check
   deterministically sampled 0.9975 instead of 1 (reproduced 2×, and the
   pre-fix tree passes — proven not an app-logic regression). The gates now
   cover reveal + lag honestly; captures just wait ~0.3–0.4 s longer.

### Re-capture verdicts (6.3 set, 6.2 recipes verbatim)

All 11 captures `ready: true`, `consoleErrors: []`, `pageErrors: []`,
exactly the 4 documented ANGLE env notices.

| capture | draws | tris | verdict |
|---|---|---|---|
| run_dusk | 179 | 88,965 | PASS — corner clean, skull reads human-stylized |
| run_night | 190 | 88,975 | PASS — amber road accents + reflectors read, chip gone |
| gauntlet_dusk_freeze | 181 | 92,865 | PASS — barrier/gantry lamps/pickups/pack all read |
| gauntlet_night_freeze | 192 | 92,875 | PASS — eyeshine + striped barrier + light pool hold |
| run_dusk_cam_close | 179 | 88,965 | PASS — rounded skull kills the toy read (hero evidence) |
| run_dusk_cam_side | 179 | 88,965 | PASS |
| gameover_dusk | 168 | 88,473 | PASS — "60 M" hugs the numeral like the HUD; RETRY dominates |
| gameover_night | 177 | 85,197 | PASS — chip correctly BACK (Esc truly quits there) |
| paused_dusk | 179 | 88,965 | PASS — no Esc contradiction; numerals dim under scrim |
| menu_dusk (regression) | **147** | **82,377** | PASS — bit-identical signature |
| menu_night (regression) | **159** | **85,875** | PASS — bit-identical signature |

(beauty_dusk not re-captured: the menu path is untouched and the menu pair
is pixel-clean; the 6.2 PNG remains valid.)

### Regression evidence (final code)

- **Menu bit-identity**: `png_diff` 6.2-vs-6.3 menu dusk **0.113 mean /
  0.19% >8** (floor 1.035–1.073 attract) and menu night **0.090 / 0.11%**
  (floor 1.636/1.94%) — both far below floor; draws/tris signatures exact.
- **Probes, all green** (`ok: true`, `problems: []`, clean console beyond
  the 4 env notices): `contract_probe` (the full 19-cell 6.1 matrix),
  `state_probe` (2.2), `run_probe` (4.3 — determinism sample `75eccef9`
  UNCHANGED: the skull is render-only, seed reproducibility intact),
  `player_probe` (3.4 — heap retained 0, growth 0), `hud_probe` (5.1),
  `input_probe` (2.1), `gameover_probe` (2.4/2.5), `pause_probe` (2.3 —
  green only AFTER fix 4; see above).
- **Budgets**: worst draws **192** (gauntlet night freeze) ≤ 220; worst
  tris **92,875** ≤ 500 k; raw own-JS 354,479 → **355,150 B** (+671: player
  skull + helper, main.js live-class toggles, config comment) — the
  documented amended-cap overshoot grows by +0.7 KB, doc-diet path
  unchanged.

### Final overall verdict: **PASS**

Every 6.2 failure mode is fixed and re-verified; the world signature, UI
voice and budgets are intact.

### Remaining known limitations (reported, not fixed)

1. **Dusk sky has no teal** (measured above): the bible's "deep teal-blue
   sky" and the cool half of the split-tone exist only at night. Fixing
   means a sky/grade retune shared with the menu → full capture-history
   re-baseline; needs its own slice (sky-v2) with the bit-identity
   constraint explicitly lifted. Same block applies to the **sun elevation**
   (reads ~25° up, not "low sun") and the **faint dusk city-fire glow** on
   the horizon; night versions of all three read well.
2. **Gauntlet block archetype never enters frame** in the official gauntlet
   freezes (band spawns beyond the frozen dolly's view / occluded); its
   dodge-only silhouette was verified in 3.2's own staging, and the
   in-frame archetypes (low/gantry) read their verbs — a staging-depth
   choice, not a render failure.
3. **Boxy torso slab** remains on the player (jacket/backpack read is
   plausible clothing; only the head was the toy-tell).
4. CDP-swiftshader cadence makes the settled-opacity gates
   load-sensitive by nature (fix 4 widens the margin; a re-brand of the
   constants belongs to 7.1's sweep if capture waits ever tighten).

## Task 7.1 — budget report

Date: 2026-09-25. Every number below RE-MEASURED against the live tree on
report day — nothing carried forward stale: raw own-JS via `wc -c` over
`js/**/*.js` (24 files), the full 6.1 19-cell contract matrix re-run
(`bun .qa/contract_probe.mjs` → `ok: true`, `problems: []`,
`consoleErrors: []`, `consoleWarns: []`, `pageErrors: []`,
`envNoiseWarnings: 4` — the documented ANGLE boot notices, one set per
browser process), both allocation probes re-run, one fresh dusk gameplay
capture. **This task changed zero code.** Verification runs: contract_probe
(19/19 cells green), player_probe (`ok: true`, console clean), run_probe
(`ok: true`, `problems: []`), perf_probe (menu dusk), shot.mjs
(`?qa=1&mode=run&scene=game&seed=11` → 179 / 88,965 — see sanity below).
`tasks.md` 7.1 deliberately left UNCHECKED pending the sign-offs below.

### Budget table

| metric | bible value | amended / proposed | measured (live, 2026-09-25) | verdict |
|---|---|---|---|---|
| Raw own-JS | ≤ 150 KB (153,600 B) | working cap 320 KB (327,680 B @×1024, design.md d10); **PROPOSED tracked cap 384 KB (393,216 B) — PENDING SIGN-OFF** | **355,150 B** (24 files) | bible exceeded; 320 KB exceeded by **27,470 B** (the documented contract-header mass, pre-existing since 4.2, last moved +671 B in 6.3); inside the PROPOSED 384 KB cap with 38,066 B headroom |
| Draw calls | ≤ 220 | — | worst **190** (live matrix, game-run-night); worst-ever settled 198 (6.2 probe, gauntlet-night-freeze) | **PASS** — 30 draws headroom (22 vs the 198 settled worst) |
| Triangles | ≤ 500 k | — | worst **97,981** (seed-repro gameover cells) | **PASS** — 402,019 headroom (5.1× under cap) |
| Fixed timestep + interpolation | 60 Hz fixed, 0.1 s dt clamp, render interp (rule 5) | — | verified line-level (below) + behavior probes green | **PASS** |
| Hot-path allocation | none per frame | — | retained **0 B** over 600 steps (player_probe AND run_probe, re-run today) | **PASS** |
| SwiftShader fps | ≥ 18 fps @1600×900 | **PROPOSED: regression-tracked metric; real-GPU 60 fps stays the shipped bar — PENDING SIGN-OFF** | settled **5.95–8.86** (6.2 capture set); live re-check 9.14 idle / 7.66 capture (menu dusk, today) | **DEVIATION — PENDING SIGN-OFF**; PRE-EXISTING (1.1 baseline 4.9–6.1 on the menu alone, before any gameplay code; all viable trims measured art-fatal) |
| Console | zero errors/warnings | — | `consoleErrors: []` in every probe/capture this task; only the 4 documented ANGLE env notices | **PASS** |

Raw own-JS top-5 (`wc -c`): `js/core/assets.js` 67,854 ·
`js/world/chunks.js` 59,844 · `js/core/config.js` 43,550 · `js/main.js`
26,923 · `js/core/sky.js` 22,444 — 220,615 B = 62.1% of the total. The
gameplay slice's own per-task targets were all hit (run.js 14.5 KB ≤ 15,
score+director 12.0 KB ≤ 12, hud.js 3.2 KB ≤ 5, audio.js 4.6 KB ≤ 6); the
cap overshoot is the accumulated API-contract/gauntlet-staging documentation
those tasks each flagged in their size notes.

### Draw-call + tri headroom

The live 19-cell matrix (below) worst is **190 draws** (game-run-night —
night is the binding case: streetlight kit + headlight pools); the worst
reading ever recorded is **198** (6.2's probe settled sample on the same
gauntlet-night-freeze cell whose capture read 192). Headroom vs the 220 cap
is therefore **30 draws** on live evidence, 22 on worst-ever. That must
cover DRIVE/RIDE's future rig/entity load — the landed per-system costs to
budget against: player +22 (11 main + 11 shadow), zombies +2, obstacles +3,
pickups+particles +2. Tri headroom is comfortable: worst 97,981 vs 500 k
(≈ 80% free; the zombie pack is the big lever at +36,608 tris for a full
32-figure pool, and pool meshes draw unculled per the 1.2 trade).

### Live 19-cell contract matrix (re-run 2026-09-25; Δ = vs the 6.1 table)

`ok: true`, zero problems, zero console noise beyond the 4 documented env
notices; every cell ready within bound, `__QA` mirror + `__WORLD.chunks` 8.

| cell | draws | tris | Δ vs 6.1 |
|---|---|---|---|
| menu-dusk | 147 | 82,377 | identical |
| menu-night | 159 | 85,875 | identical |
| mode-select-alias | 147 | 82,377 | identical |
| game-run | 179 | 88,965 | +116 tris = the 6.3 skull fix |
| game-run-freeze | 179 | 88,965 | +116 tris, same |
| game-run-gauntlet-freeze | 181 | 92,865 | +116 tris, same |
| game-run-gauntlet-live | 181 | 92,865 | +116 tris, same |
| game-run-cam-close | 186 | 89,393 | +116 tris, same |
| game-run-cam-side | 185 | 89,357 | +116 tris; −1 draw = documented frustum-sway class |
| game-run-night | 190 | 88,975 | +116 tris, same |
| game-run-time5 | 186 | 89,393 | +116 tris, same |
| gameover | 152 | 88,027 | 6.2-documented sway-cull class for this URL (133–168 recorded); +58 tris base = skull |
| paused | 179 | 88,965 | +116 tris, same |
| cam-front-menu | 137 | 82,077 | identical |
| cam-beauty-menu | 147 | 82,377 | identical |
| seed-repro-a | 175 | 97,981 | +58 tris = skull on the gameover scene (88,415→88,473, 6.3) |
| seed-repro-b | 175 | 97,981 | same; pair bit-identical |
| menu-gameplay-flag | 147 | 82,377 | identical |
| shop-absent-fallback | 147 | 82,377 | identical |

**No unexplained drift.** Every delta from the 6.1 matrix is exactly the
6.3 player-skull fix (+116 tris on run/paused scenes, +58 on gameover-class
scenes) or the documented warm-frame/sway variance class. The menu attract
signature 147/82,377 remains bit-identical from 3.1 through today.

### Fixed-timestep + interpolation verification (line-level)

- `js/core/config.js:697` `FIXED_DT: 1/60` (60 Hz); `:698`
  `MAX_FRAME_DT: 0.1` (the bible's 0.1 s clamp); `:699`
  `MAX_STEPS_PER_FRAME: 8` (spiral-guard bound).
- `js/main.js:551` `const rawDt = Math.min((now - lastTime) / 1000,
  CONFIG.MAX_FRAME_DT)` — the clamp.
- `js/main.js:558–565` the accumulator: `accumulator += rawDt;`
  `while (accumulator >= FIXED && steps < CONFIG.MAX_STEPS_PER_FRAME)
  { fixedUpdate(FIXED); accumulator -= FIXED; }` +
  `if (steps === CONFIG.MAX_STEPS_PER_FRAME) accumulator = 0` (spiral
  guard).
- `js/main.js:570–571` render interpolation: `const alpha =
  accumulator / FIXED;` `const renderZ = prevDollyZ + (dollyZ - prevDollyZ)
  * alpha;` — `:572` hands `alpha` to the mode, and
  `js/modes/run.js:338` calls `player.updateRender(alpha)` (the
  center-frame hero is interpolated; bible rule 5).
- `js/main.js:132` `FIXED` is hoisted above boot's `fastForward` (the 2.2
  fix) — `&time=S` steps the same FIXED; `js/main.js:538–544`
  `visibilitychange` auto-pause (GAME-gated).

Behavior evidence, all green today: contract_probe's freeze cells hold the
dolly BIT-constant while frames keep incrementing (and `?scene=paused`
likewise, mirror true); state_probe's paused checks hold z AND prevZ AND
simTime constant; player_probe verifies render interpolation is
boundary-continuous (`sample(1)` of step k == `sample(0)` of step k+1
exactly) and pop-free mid-alpha. Documented exception (proposed tension #3
below): zombie POSES ride fixed-step matrices only (3.1 limitation).

### Hot-path allocation verification

Re-run today, both with `--js-flags=--expose-gc`:

- `.qa/player_probe.mjs`: forced GC → 600 fixed+render steps with cycling
  requests → forced GC: **retained 0 B**; 8-sample live heap series flat at
  27.6 MB, growth **0 B**.
- `.qa/run_probe.mjs`: forced GC → **600 REAL mode steps** (ramp + player +
  director + collide scans + collect + bursts, hazards cleared ahead to
  keep the run alive) → forced GC: **retained 0 B**; hot path stayed live
  (77 m accrued inside the measurement window).

Consistent with the per-system probes' historical 0-byte results
(zombie/obstacle/pickup/spawn probes, tasks 3.1–4.2) and the structural
guarantees (module-scope scratch vectors, in-place matrix compose,
`score.snapshot()` object reuse, HUD cached textContent-only writes,
dressing-pool sync early-out on an unchanged chunk key).

### Slice perf narrative (baseline → final)

The slice started at the 1.1 baseline: menu attract at 206–220 draws /
64–75 k tris, settled SwiftShader fps 4.9–8.7 — already below the bible's
≥ 18 before any gameplay existed, with every trim to reach 18 measured
art-fatal (post-off 7.9, +shadows-off 13.3; MSAA free). Task 1.2's dressing
merge banked the headroom (attract 206→163 frame-total, floor cells
147/82,377). The gameplay slice then SPENT that headroom deliberately:
player +22 draws (11 main + 11 shadow), zombies +2, obstacles +3,
pickups/particles +2, plus director entities in-world — landing the final
RUN gameplay signature at **179 draws / 88,965 tris dusk (190 night,
gauntlet freezes 181/92,865)**, all ≤ 220 / ≤ 500 k. Settled fps did NOT
move through any of it — 1.1's verdict that SwiftShader cost is
fill/shader-bound held in both directions: draw reductions didn't raise it,
gameplay additions didn't lower it (live run 7.2–8.2 vs menu 8.7 in the 6.2
set; live re-check today 9.14 idle menu — inside the ±25 % host-variance
band). What did move: tris 64–75 k → 88–98 k (unculled pools + zombie pack
+ player), and the attract floor stayed pixel/draw bit-identical throughout
because every gameplay system is mode-scoped. The SwiftShader fps gap is
therefore reported as a PRE-EXISTING, regression-tracked environment
constraint (proposal below), with real-GPU 60 fps untouched as the shipped
bar.

### Sanity capture (live tree vs the 6.3 signature)

`bun .qa/shot.mjs "http://127.0.0.1:8123/?qa=1&mode=run&scene=game&seed=11"
/tmp/run_dusk_71.png --wait 9000` → **179 draws / 88,965 tris — EXACTLY the
6.3 critic's final numbers**; `ready: true`, `consoleErrors: []`,
`pageErrors: []`, exactly the 4 documented env notices,
`__WORLD.chunks: 8`, tier medium.

### ORCHESTRATOR DECISIONS — PROPOSED, PENDING SIGN-OFF

Recorded by the 7.1 reporter at the orchestrator's direction after an
unanswered budget question; NONE of these are settled facts until
signed off. They keep the slice shippable without silently redefining the
bible.

1. **Raw own-JS cap → 384 KB tracked (393,216 B @×1024).** Measured
   355,150 B. The working 320 KB amendment (327,680 B) is exceeded by
   27,470 B of thorough per-task contract/gauntlet header documentation —
   the code itself hit every per-task byte target (size notes in
   3.3/3.4/4.1/4.2/4.3/5.1/5.2). Under the proposed cap by 38,066 B. The
   documented doc-diet reclaim pass remains available if a later slice
   needs the room.
2. **SwiftShader "≥ 18 fps @1600×900" becomes a regression-tracked metric;
   real-GPU 60 fps stays the shipped bar.** Measured settled 5.9–8.9 fps
   across the final capture set — PRE-EXISTING at 5–8 fps on the menu ALONE
   before this slice wrote any gameplay code (1.1), and all viable trims
   were measured art-fatal in 1.1's lever ladder. SwiftShader capture keeps
   its role as the zero-console-error + draws/tris budget regression gate;
   fps there is tracked for regressions, not gated at 18.
3. **Documented future-slice tensions (reported, not fixed, carried
   forward):** (a) **dusk-sky teal** — 6.3 measured zero teal at dusk
   (hue 0–26°, red/orange) vs the bible's "deep teal-blue sky"; the fix is
   the sky-v2 retune with the capture-history bit-identity constraint
   explicitly lifted; (b) **zombie render interpolation** — poses update at
   the fixed 60 Hz only (3.1 limitation); invisible in ~6–9 fps SwiftShader
   stills, but a real-GPU 60 fps play read may expose stepping — revisit
   when DRIVE/RIDE or a GPU-gate slice lands; (c) **DRIVE/RIDE are
   HUD-less until their slices** — the 5.1 shell contract
   (`ctx.hud` + `hudLayout()` mount gating) is ready and verified with the
   DRIVE stub hidden; their slices supply layout + push updates.

## Task 7.2 — playthrough

Date: 2026-09-26. The human-perspective acceptance pass: two full E2E
sessions through the REAL input paths only — desktop keyboard (1600×900,
CDP `Input.dispatchKeyEvent` at ~120 ms decision cadence) and touch-emulated
iPhone-class mobile (390×844, DPR 3, `isMobile`/`hasTouch`, CDP
`Input.dispatchTouchEvent` taps + swipes ≥ `INPUT.swipePx` 24 px). Fresh
storage per session (`browser.newPage` context). New permanent tools:
`.qa/playthrough_desktop.mjs` (42/42 checks), `.qa/playthrough_touch.mjs`
(47/47), `.qa/seed_scan.mjs` (per-seed early-road layout scanner). Screenshots
in `.qa/shots/7.2/` (mid-run + settled gameover per modality, dusk). Zero
console errors/warnings in BOTH sessions beyond exactly the 4 documented
ANGLE/SwiftShader boot notices; zero autoplay warnings (no `AudioContext`
exists before the first gesture — verified at the constructor boundary via an
init-script spy; exactly 1 context, state "running", after it).

### BUG FOUND AND FIXED: retry respawned inside the hazard that killed you

`retryRun()` kept the death-spot dolly z and re-streamed the SAME seeded
layout — a run that died on any director band/pack (the common death) re-died
on frame 1 against the identical hazard. Measured: retry after a band death →
gameover again at distance 1 m, every time (the re-death is unavoidable by
any human). That makes 7.2's own "second run reaches a further distance"
impossible and contradicts the retry contract's intent ("instant retry",
design risk note — which only ever covered pooled-chunk performance). Fix
(minimal, config-tunable):

- `js/main.js` `retryRun()`: after `world.reset()`, skip the dolly to the next
  chunk boundary (`floor(z / CHUNK_LEN) + RUN.retrySkipChunks`) and hold the
  camera rig there (clean cut, no 40 m catch-up swoosh). Every chunk start is
  guaranteed clear by the spawn geometry's own insets (`SPAWN.band.edge` 6 m,
  `SPAWN.pack.inset` 8 m) — free runway without perturbing the seeded
  per-chunk streams. Menu-select / pause-RESTART (alive players) are
  untouched: `enterGame` keeps its plain fresh-run path.
- `js/core/config.js`: `RUN.retrySkipChunks: 1`.
- Post-fix: run 2 reaches further cleanly (desktop: 170 m in 2 attempts; touch:
  35 m past the on-screen death in 3). Regression probes re-run green:
  `run_probe` (`ok: true`; determinism hashes bit-identical, sample
  `75eccef9` unchanged — the skip changes WHERE a retry starts, never the
  layouts), `gameover_probe` (retry 2.6–3.6 ms, save writes correct),
  `state_probe`, and the menu bit-identity capture **147 / 82,377 — exact**.

Probe-side companion fix in `.qa/run_probe.mjs` (harness, not game): the
autopilot-survival distance margin was wall-clock-calibrated (~60 m assumed
the documented 8.7–9.1 fps); under host load the sim ratio drops and the
check flaked (43–50 m accrued, autopilot alive). It now asserts cruise-rate
progress over SIM seconds actually elapsed (`simTime` delta × 7.5 m/s × 0.9)
— load-independent. Measured environment during this task: settled idle
**3.88–4.24 fps** (`perf_probe`, vs 8.66 in 6.2 / 9.14 in 7.1 — an Android
emulator + a 40 % CPU Chromium helper were live in `ps`); both playthroughs
above still passed fully under that load.

### DESKTOP (1600×900, real keys, human-ish cadence) — seed 47, condensed

| step | input | expected | observed | pass |
|---|---|---|---|---|
| boot | load `?qa=1&seed=47`, fresh storage | menu, no save, 0 AudioContexts, 0 warns | all as expected | ✅ |
| select | key `1` | RUN card selected; audio unlocked (1 ctx, running) | yes | ✅ |
| start | Enter | GAME, HUD on, `__QA_RUN` live, gameplay flag | yes | ✅ |
| play | a/d/w/s at ~120 ms cadence, 26 s | distance + all verbs via real keys | 154 m, 1 jump, 1 slide, 6 dodges, 9 inputs | ✅ |
| death (deliberate) | stop evading, steer into nearest hazard (gantry @11 m) | dead; cause record = real overlap | dead; plan=gantry, actual=gantry | ✅ |
| gameover | death settle → screen | stats = ledger: 154 / 304 / 6; NEW BEST ON; "BEST — —"; HUD hidden | exact | ✅ |
| save | localStorage after death | best.run 154; currency 30 = 6×5 | exact | ✅ |
| retry | Enter | fresh GAME, stats null | yes (2 attempts incl. one real mid-run death) | ✅ |
| run 2 | keys past 154 m +15 | further, clean | 170 m clean | ✅ |
| pause | Esc mid-run | paused + overlay; z/prevZ/simTime bit-constant 500 ms; numerals frozen | exact | ✅ |
| resume | Esc | one press = one toggle; dolly advances | +1.5 m | ✅ |
| restart | Esc, click RESTART | fresh GAME unpaused | yes | ✅ |
| quit | Esc, click QUIT · MENU | menu; card + footer `BEST — 154 M` = save | exact | ✅ |
| reload | page reload | card line + save persist | `BEST — 154 M`, currency 30 | ✅ |

### TOUCH (390×844 @3×, taps + swipes only) — seed 46, condensed

| step | input | expected | observed | pass |
|---|---|---|---|---|
| boot | load `?qa=1&seed=46`, device emulation | 390×844 @3×, menu, fresh save, 0 AudioContexts | yes | ✅ |
| menu layout | DOM rects at 390 px | no horizontal scroll; 3 cards inside, h 125 px each | doc/body 390 | ✅ |
| select + start | tap RUN card ×2 (select, then start) | sel=run → GAME+HUD; ONE enterGame (no double-fire) | yes; stats null | ✅ |
| play | swipes (±70-80 px), 5 lives, natural deaths retried by real RETRY taps | distance + verbs via real swipes | best life 286 m; 2 jumps + 11 slides (state-verified) + 48 dodges | ✅ |
| deaths ×5 | every death | real overlap at the impact frame (no tunneling) | 5/5 zombie contacts (in-page one-frame recorder) | ✅ |
| death (deliberate) | final life: steer into nearest hazard | dead on a real overlap | yes (zombie contact) | ✅ |
| gameover | settle → screen | stats = ledger (9 / 9 / 0); NEW BEST per contract vs previous best; best line = previous best | exact (L1 first-run flag ON; later deaths flag only when beaten) | ✅ |
| gameover layout | DOM rects | panel 343.2 px = min(360px, 88vw), inside viewport; buttons h 41 px | exact | ✅ |
| save | localStorage after deaths | best.run = max life (286); currency = Σ pickups×5 (140) | exact | ✅ |
| retry | tap RETRY | fresh GAME, stats null; exactly ONE click (no double-fire) | yes, clicks = 1 | ✅ |
| run 2 | swipes past the on-screen 9 m +25 | further, clean | 35 m clean (3 attempts) | ✅ |
| pause | tap HUD PAUSE chip | paused + overlay in ONE toggle (still paused 500 ms later; 1 click); panel 320 px = min(320px, 84vw); buttons h 41 px | exact | ✅ |
| pause inert | swipe while paused | lane unchanged | px frozen | ✅ |
| resume | tap RESUME | unpaused, 1 click; distance advances | 38.9 → 42.1 m | ✅ |
| quit | tap chip, tap QUIT · MENU | menu; card `BEST — 286 M` = save | exact | ✅ |
| reload | page reload | card line == save; best + currency persist | `BEST — 286 M`, 140 | ✅ |

### Friction notes (reported, not fixed — none are spec violations)

1. **Menu card tap semantics**: the first tap SELECTS, the second STARTS
   (menu.js: same-card click confirms). Correct per contract, but on a phone
   there is no visible START affordance — a first-time player taps RUN and
   waits. A "TAP TO START" state on the selected card would remove the hiccup.
2. **HUD PAUSE chip is a ~30 px-tall touch target** (76×30 px at 390 px; the
   pause/gameover buttons are 41 px). The only sub-40 px control on the
   screen, and it sits in the thumb corner. `--hud-*` padding is the knob.
3. **Transient overlap during the gameover fade at 390 px**: the outgoing HUD
   DISTANCE numeral crosses the incoming `ESC · MENU` chip for ~0.5 s (both
   top-left/top-centre). Settles clean (verified in the settled captures);
   only visible in mid-fade frames.
4. **SwiftShader pacing collapses the reaction windows** (environment, not
   code): at the measured 3.9–10 fps the sim advances ~1-4.5 m per readable
   frame while the jump/slide initiation windows are 1.3-1.6 m wide —
   reactive jumping is a coin flip and lane-dodging-first is the only
   reliable human strategy. This is exactly the 7.1 proposal's
   "SwiftShader = smoke gate, real-GPU 60 fps is the shipped bar"; on a 60 Hz
   device the same windows are ~160-200 ms of reaction time (fair).
5. **The early road is sparse by design** — grace 2 chunks + a 40-chunk
   density ramp: first obstacle measured at 90–260 m across 18 seeds
   (`.qa/seed_scan.mjs`). The first ~15-30 s of every run sees almost no
   hazards. If the empty open feels long to players, `SPAWN.rampChunks` (and
   the grace count) is the single tuning pair; reported for 4.4-style tuning,
   not changed here.

### Verdict: PASS

Playable end-to-end on both input modalities at the real user paths — boot →
select → play (dodge/jump/slide) → verified deaths → gameover stats matching
the on-screen run → NEW BEST → retry → further run → pause/resume → restart →
quit → menu bests → reload persistence — with zero console noise beyond the 4
documented environment notices, audio unlocking on the first gesture only, no
double-fires on any touch control, and every death verified as a real
collision/zombie contact. One real bug found and fixed (retry respawn), all
affected probes + the menu bit-identity re-verified.

## Post-slice fix — mirrored lane controls + SW shell (2026-09-26)

**Player report: "controls are reversed" in RUN.** Root cause: the chase rigs face +z
(back > 0, lookAhead > 0), and for a +z-facing camera screen-right = forward × up = **−x**;
the beauty capture confirms it empirically (the lit bus at world x −2.42 renders screen-right).
`x = lane × LANE_W` therefore puts lane +1 on screen-LEFT, while the 2.1 action strings mapped
"right" to lane +1 — every lane input played mirrored.

**Fix** (screen-intent boundary only): `js/modes/run.js` handleAction now maps
"left"→requestRight / "right"→requestLeft (comment documents the camera convention). Player,
collision, spawn director and determinism are untouched — the gauntlet autopilot drives the
player API directly, so all judged captures keep their framing.

**Verification**: new `.qa/lane_direction_probe.mjs` — through the real input layer
(KeyA/KeyD/arrows + CDP PointerEvents swipes, integer-lane assertions, condition waits):
all directions mirrored correctly, both rails clamp. `run_probe` green (its real-key lane
assertion updated to the mirrored contract; determinism hash unchanged), `state_probe` green.

**Also fixed (found during this fix)**: `sw.js` SHELL predated the gameplay slice — the 12
new modules (modes/game/entities/ui) were missing from the offline cache. SHELL extended and
VERSION bumped to `endless-v2` (v1 runtime-cached the old `run.js`, so a forced re-fetch is
required for the fix to reach installed clients: one hard refresh, or two normal reloads).

**Probe-env note**: long interactive SwiftShader sessions can stop rAF mid-probe (page alive,
no crash) — the established retry-once pattern covers it; not app-facing (real GPUs unaffected).
