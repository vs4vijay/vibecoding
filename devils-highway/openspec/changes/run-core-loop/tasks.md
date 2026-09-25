# Tasks

## 1. Perf + budget baseline (before new load lands)

- [x] 1.1 Verify the SwiftShader fps gap: capture menu/game at 1600×900 (`bun .qa/shot.mjs`), compare `__PERF.fps` in-page vs capture, and record a baseline table (fps, drawCalls, tris, raw JS bytes) in the QA report; if in-page fps is genuinely < 18 under SwiftShader, apply quality-tier/chunk-dress trims and re-measure before gameplay work starts.
- [x] 1.2 Draw-call audit of the attract scene: enumerate per-material-group call counts via `renderer.info`, identify ≥ 30 mergeable draws in chunk dressing (scatter/debris merges), and land the merge so the dusk menu sits ≤ 220 draws; verify with `bun .qa/shot.mjs "http://127.0.0.1:8123/?qa=1&scene=menu" /tmp/audit.png` reporting drawCalls ≤ 220 and zero console errors.

## 2. Shell: state machine, input, save

- [x] 2.1 Extend `js/core/input.js`: gameplay key bindings (A/D/←/→ left-right, W/↑/Space jump, S/↓ slide, Esc pause) and touch swipe/tap detection (pointerdown/up delta, 24 px threshold, dominant axis) emitting action strings; verify by logging actions in a temporary QA-only listener, menu keys unchanged, zero console warnings.
- [x] 2.2 Add GAMEOVER state + PAUSED flag to the `main.js` state machine with transitions (mode-death → gameover, retry → fresh GAME, quit → MENU), wire action routing by state (menu / mode / shell), keep `?scene=` QA mapping working; verify manually via console-driven death injection that all transitions fire and Esc pauses instead of exiting.
- [x] 2.3 Build `js/ui/pause.js` (Resume/Restart/Quit, `.screen` styling per menu pattern) with auto-pause on `visibilitychange`; verify sim freezes (dolly z constant), resume continues exactly, and frozen-attract QA captures are unaffected.
- [x] 2.4 Build `js/ui/gameover.js` (distance/score/pickups stats grid, NEW BEST flag, Retry primary + Menu) and wire instant retry (Enter/Space/tap → fresh run ≤ ~1 s, pooled `world.reset()`, no reload); verify retry round-trip timing via `performance.now()` in QA logging.
- [x] 2.5 Wire persistence: on death call `recordBest()` + credit currency + single `saveSave()`; add per-mode "BEST — N M" lines to menu cards; verify best survives reload and currency accrues (`localStorage` inspect + menu readback).

## 3. Entities (shared, pooled)

- [x] 3.1 Build `js/entities/zombies.js`: pooled instanced manager (≤ 32 live, body + emissive-eye meshes ≈ 2 draws), CPU pose update (shamble/run cycle, lunge), spawn/release API, per-instance color variance; verify 32 instances animate in a QA-staged scene at zero per-frame allocation (scratch vectors) and ≤ 2 added draw calls.
- [x] 3.2 Build `js/entities/obstacles.js`: three instanced archetypes — low barrier (jump), overhead gantry (slide), full-lane block (dodge) — with lane + z-window + height collision checks against a player profile (run/jump/slide states); verify each archetype kills on run-through, is cleared by its intended action, in a staged scene.
- [x] 3.3 Build `js/entities/pickups.js` (instanced amber markers, emissive pulse, lane strands) + `js/entities/particles.js` (one pooled Points system: pickup burst, death impact); verify collection consumes pickup, fires burst, ≤ 3 added draws total.
- [x] 3.4 Build the player runner: hierarchical low-poly rig (hips/torso/head/arms/legs ≈ 1.5–2k tris, library materials, shadow-casting), sinusoidal run cycle, lerped jump/slide poses, lane easing + jump gravity + slide timer state machine; verify silhouette readability in dusk/night captures at close cam, no per-frame allocation.

## 4. RUN mode + spawn director

- [x] 4.1 Add chunk-activation callbacks to `js/world/world.js` (`onChunkActive/onChunkInactive` fired from existing spawn/despawn paths, `gameplay` flag in factory ctx) and the `chunks.js` on-road→shoulder wreck shift when gameplay; verify menu attract renders byte-identical framing (regression capture vs baseline) and gameplay mode shows shoulder-shifted wrecks.
- [x] 4.2 Build `js/game/score.js` + the spawn director: per-chunk seeded streams (tag 4, sub-streams per feature) generating obstacle bands / zombie packs / pickup strands with passability validation (every band leaves an open or clearable lane); verify same `?seed=` produces identical layouts across two runs (log layout hash per chunk) and every staged band passes the validator.
- [x] 4.3 Implement `js/modes/run.js` against the Mode contract: `enter/exit/fixedUpdate/update/cameraRig/hudLayout/stagedScenarios` — forward speed ramp, lane/jump/slide integration with entity systems, death detection (obstacle/zombie), focus-z reporting driving `world.update`, run-rig camera blend; verify a full run end-to-end: menu → run → dodge/jump/slide → death → gameover → retry, zero console errors.
- [x] 4.4 Add `CONFIG` gameplay tunables section (lane change time, jump arc, slide duration, speed ramp table, spawn densities, score/currency values) and sweep all new gameplay numbers into it; verify no magic numbers remain in gameplay code (grep review) and `?seed=` run reproducibility still holds.

## 5. HUD + audio

- [x] 5.1 Build `js/ui/hud.js` (DOM: distance/score/pickups numerals + touch pause chip, mode-supplied placement class, `textContent`-only updates) shown in GAME, hidden otherwise; verify legibility over dusk+night captures and no layout thrash (devtools performance profile clean).
- [x] 5.2 Extend `js/core/audio.js` with procedural SFX (pickup blip, lane whoosh, jump tick, death sting, UI confirm) behind the lazy-context unlock, master gain ~0.8; verify sounds fire on first gesture onward, no autoplay-policy console warnings, and QA captures stay silent-safe (`--mute-audio`).

## 6. QA contract + captures

- [x] 6.1 Extend `qa/hooks.js`: `staged=gauntlet` (staged obstacle/zombie/pickup sequence via `stagedScenarios()`), `scene=gameover|paused` staging with deterministic stats, settle gates per scene; verify `screenshotReady` gating still holds for all existing scenes.
- [x] 6.2 Capture the QA set at 1600×900 and confirm every report has `consoleErrors: []`: menu dusk+night regression pairs, run gauntlet dusk+night (`&mode=run&staged=gauntlet`), gameover, paused, plus `?cam=close|side` action shots; attach the perf/draw-call/raw-bytes table to the slice report.
- [x] 6.3 Run the harsh visual critic A/B on the new run/gameover/paused captures vs the art bible bar (palette, value structure, UI restraint); fix flagged issues and re-capture until the verdict passes.

## 7. Definition-of-done sweep

- [x] 7.1 Full budget report: raw own-JS bytes ≤ 320 KB (amended cap), draw calls ≤ 220 in menu + run gameplay, tris ≤ 500 k, fixed-timestep + interpolation intact (no per-frame allocation in hot paths); record numbers in the slice report.
- [x] 7.2 End-to-end playthrough on desktop keyboard and touch-emulated mobile viewport (390×844): complete run, pause/resume, death, retry, menu bests updated; zero console errors/warnings throughout.
- [x] 7.3 Commit the slice with a descriptive message (code + QA artifacts), verifying `git status` is clean afterwards.
