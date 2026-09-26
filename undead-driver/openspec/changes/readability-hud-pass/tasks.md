# Tasks

## 1. Config + pure helpers (foundation)

- [x] 1.1 Add `CONFIG.hud` (`warnAt: 0.5`, `critAt: 0.75`, `popupCount: 6`, `popupLifeS: 1`) and `CONFIG.readability` (`obstacleWarnDist`) plus world tuning values (hemisphere intensity, road albedo, fog color/density band) consumed by scene/world; run `rtk vitest run` + `bun run typecheck` green
- [x] 1.2 Add `unlocksForLevel(level)` to `src/game/difficulty.ts` (returns types whose `unlockLevel === level`) with failing-first tests (level 2 → runner, 3 → brute, 1/4+ → empty) in `tests/difficulty.test.ts`; `rtk vitest run tests/difficulty.test.ts` green
- [x] 1.3 Add pure `worldToScreen(x, y, z, cameraLike, width, height)` helper under `src/ui/` with node-env tests using a stub camera (projects to px, clamps to viewport, returns off-screen flag); `rtk vitest run` green

## 2. Kill event payload

- [x] 2.1 Extend `GameEvents.kill` to `[type, viaScrape, points, worldX, worldZ]`; `Session.registerKill` captures `Scoring.registerKill`'s return and forwards points + `wx`/`wz` it already holds; update `tests/session.test.ts` to assert the full payload on a forced kill; `rtk vitest run tests/session.test.ts` green

## 3. Scene & mesh readability (render/)

- [x] 3.1 Exposure lift: hemisphere/sun intensities, fog color, road/sand/rail material albedos read from the new config values in `scene.ts`/`world.ts`; verify `rtk vitest run` + `bun run typecheck` green (visual check deferred to 6.2)
- [x] 3.2 Car: add two red emissive (`MeshBasicMaterial`) tail-light boxes on the rear face mirroring the headlamps, lift `BODY_COLOR`, add dim rear-fill directional light (no shadows) in `carMesh.ts`/`scene.ts`; typecheck green
- [x] 3.3 Zombies: brighten `TORSO_TINT`/head/skin constants, separating walker (mossy green) from runner (yellow-green); typecheck green
- [x] 3.4 Obstacles: brighten wreck/barrier materials, add alternating chevron stripe quads to the barrier face and emissive brake-light quads to the wreck rear in `obstacleMesh.ts`; typecheck green
- [x] 3.5 Obstacle warning rings: one additive-blended `InstancedMesh` (capacity 16) of flat rings, per-instance color lerped black→red by proximity to `carZ` inside `syncObstacleMeshes`, far instances parked under road, no per-frame allocation; typecheck + full suite green
- [x] 3.6 Telegraph ground flash: one additive `InstancedMesh` (capacity 24) bound in `updateZombieMeshes`, shown only while `state === "telegraphing"`, pulse driven by the telegraph timer, unused instances parked; typecheck + full suite green

## 4. HUD v2 (ui/)

- [x] 4.1 Add `weights: { left, right }` to `HudState`, fill from `session.car.leftWeight/rightWeight` in `writeHudState`; rebuild tilt gauge DOM (~120×64) with `warn`/`critical` severity classes driven by `CONFIG.hud` thresholds (CSS amber/red/flash); full suite + typecheck green
- [x] 4.2 Per-side weight pips (4 cells per flank inside the gauge, filled by capacity units) with dirty-checked updates; DOM probe in the 6.2 pass verifies attach/remove
- [x] 4.3 Side danger glow: fixed left/right screen-edge overlays in `#hud`, toggled by `(heavierSide, critical)` pairs, CSS transition ramp, never intercepting pointer events; style.css green
- [x] 4.4 Score popups: preallocated pool of `CONFIG.hud.popupCount` divs in `#hud`, round-robin reuse with class-restart animation, positioned via `worldToScreen` from the kill event payload, text = awarded points + `×N` when multiplier ≥2; wired in `main.ts` `kill` handler; unit tests for pool reuse logic where extractable; suite green
- [x] 4.5 Level-up banner: `hud.toast(text, subtitle?)` with subtitle from `unlocksForLevel` (pluralized display names); death card: larger stat/cause type in style.css, tap-anywhere click handler on the over-menu root, hint line "TAP OR PRESS SPACE TO RETRY", RETRY keeps focus contract; suite + typecheck green

## 5. Debug hook

- [x] 5.1 Add guarded `window.__zh` hook in `main.ts`: `{ rendererInfo() → draw calls, debugAddWeight(side, w), carZ() }` for the verification pass; typecheck green

## 6. Verification & delivery

- [x] 6.1 `rtk vitest run` full suite + `bun run typecheck` + `bun run build` all green
- [x] 6.2 Headless-Chromium (CDP, dedicated process) evidence pass: screenshots (title / mid-run / tilt-danger via `debugAddWeight` / game-over) at desktop and 390×844; pixel sampling proves obstacle-vs-road and zombie-vs-road contrast at ~80–90 m and ~40 m; DOM probes confirm pips update on attach/remove, popup appears at kill position and fades, tap-anywhere retries, fire tap passes through popup/pip layers; `__zh.rendererInfo()` ≤ 120 draw calls with 8 zombies + full obstacle set
- [x] 6.3 Regression gotchas: game animates >3 s after PLAY (rAF tail intact), `style.css` still imported, coach/game-over/toast layering unchanged, dusk mood visible (warm horizon + fog band) in the 6.2 screenshots
- [x] 6.4 Commit from repo root via `rtk git` with scope `feat(zh): readability & HUD pass`
