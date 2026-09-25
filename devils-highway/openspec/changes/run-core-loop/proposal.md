# Proposal

## Why

ENDLESS has a polished title screen and no game: ~20 art-polish rounds shipped a AAA-grade
menu diorama, but `js/modes/` and `js/entities/` do not exist, the PLAYING state is a passive
dolly cruise, and there is no HUD, death, gameover, or retry. The runner genre's UX *is* the
core loop — run → die → stats → instant retry — so the first playable mode must land together
with its UX layer, or there is no user experience to improve.

## What Changes

- **First playable mode (RUN)**: on-foot runner in the shared desert-highway world — 3 lanes,
  jump/slide, speed ramp, obstacles, chasing zombies, pickups, death on hit. First caller for
  the `Mode` interface (`enter/exit/fixedUpdate/update/cameraRig/hudLayout/stagedScenarios`).
- **Shared entity foundations** (reused later by DRIVE/RIDE): pooled zombie factory
  (InstancedMesh, per-instance anim, emissive eyes), obstacle set, pickup set, particles.
- **Shell UX loop** (mode-agnostic): real state machine PLAYING → PAUSED → GAMEOVER; HUD
  overlay (distance/score/pickups); pause screen (fixes the current Esc-exits-run trap);
  gameover screen with stats + one-keystroke instant retry; `recordBest()` and currency
  accrual finally wired into `endless.save.v1`.
- **Input extension**: gameplay keyboard (lanes/jump/slide/pause) + touch swipes and tap
  zones; menu keys unchanged.
- **Gameplay-aware chunk dressing**: RUN re-plans chunks via the existing `world.setPlan()`
  and passes a gameplay context to chunk factories so on-road wrecks shift to the shoulders;
  a deterministic per-chunk spawn director owns lane obstacles/zombies/pickups
  (`hashSeed(chunkIndex, runSeed)` — `?seed=` stays reproducible).
- **Minimal gameplay audio**: procedural WebAudio SFX for pickup, death, lane move, UI
  confirm (first real output through the currently silent `AudioManager`).
- **QA extension**: `staged=gauntlet` for RUN, `scene=gameover|paused` captures, per-scene
  shots at 1600×900, perf + draw-call report.
- **Budget amendment (needs sign-off)**: the bible's "own JS ≤ 150 KB raw" is already
  breached by the art-polish slices (`js/` ≈ 205 KB raw today, before any gameplay code).
  This change adds ~70–90 KB. Proposal: amend the budget to **≤ 320 KB raw own-JS, reported
  in every QA run**, and add a draw-call trim task to restore the ≤ 220 cap headroom the
  attract scene currently exceeds (233 on the dusk menu).

Deliberate scope decisions (v1): no guns/weapon system in RUN (dodge-focused, per the
Temple Run 2 reference); instant death on hit (no health bar); pickups accrue currency but
the shop arrives in a later slice; DRIVE and RIDE untouched.

## Capabilities

### New Capabilities

- `modes/run`: the RUN gameplay mode — lane running, jump/slide, obstacles, zombies,
  pickups, speed ramp, collision death, deterministic seeding, run camera rig, staged QA
  scenarios.
- `game-shell`: the mode-agnostic play shell — state machine (playing/paused/gameover),
  HUD frame, pause, gameover + instant retry, save integration, gameplay input mapping,
  QA contract extension.

### Modified Capabilities

(none — `openspec/specs/` is empty; this is the project's first specd capability pair)

## Impact

- **New code**: `js/entities/*` (zombies, obstacles, pickups, particles), `js/modes/run.js`,
  `js/ui/hud.js`, `js/ui/gameover.js`, `js/ui/pause.js`, `js/game/scoring.js` (or core/),
  extensions to `js/core/input.js`, `js/core/audio.js`, `js/core/config.js`, `js/main.js`,
  `qa/hooks.js`, `index.html`, `styles.css`.
- **Touched systems**: `js/world/chunks.js` (gameplay ctx param for on-road dressing),
  `js/world/world.js` (setPlan call-through, mode reset), state machine in `js/main.js`
  (add PAUSED/GAMEOVER), `js/core/save.js` (already has `recordBest`/`currency` — no change
  expected).
- **Budgets**: raw own-JS grows ~205 → ~275–295 KB (amendment proposed above); draw calls
  must be brought back under the 220 cap with gameplay systems live; fixed-timestep +
  interpolation, pooling, and zero-console-noise rules all apply to the new code.
- **Risk**: menu/beauty captures must not regress — attract path stays the default; gameplay
  systems activate only in PLAYING.
