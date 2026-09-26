# Design — Readability & HUD Pass

## Context

The sim and render architecture is pooled and allocation-free; the HUD is DOM-based with per-frame dirty-checked updates; `GameEvents` is a typed emitter whose `kill` event currently carries `[type, viaScrape]` even though the session's `registerKill(type, viaScrape, wx, wz)` already holds the victim's world position and the awarded points. Colors are file-level constants in `src/render/*`; numeric tunables live in `src/config.ts`. Draw budget is ≤120 steady state (~91 used). Deps are frozen (three + dev tools only), so all visual work stays inside three.js primitives/materials — no post-processing stack.

See proposal.md for motivation and specs/render/readability + specs/ui/hud for the behavior contracts.

## Goals / Non-Goals

**Goals:**
- Every threat readable at reaction distance under the existing dusk scene, with zero new assets and zero new dependencies.
- The weight/tilt story legible at a glance; kills, level-ups, and deaths visibly rewarded.
- All additions respect pooling, the draw budget, and HUD click-through.

**Non-Goals:**
- Time-of-day arc, speed streaks, hit-stop (deferred Thread 3).
- Title-screen idle drive, runs/best-distance menus (deferred Thread 4).
- Any gameplay/balance change: weights, spawn logic, difficulty curve, scoring math are untouched (only the *display* of them changes).

## Decisions

### D1 — Exposure lift via light/material tuning, not post-processing
Raise hemisphere intensity (~0.7 → ~0.95), road albedo (`0x1c1c20` → ~`0x2b2b31`), fog color (`0x2a160c` → ~`0x3a2012`, keeps the warm dusk band), and modestly brighten sand/rail materials. All exact values become `CONFIG.world`/`CONFIG.readability` tunables.
*Alternatives:* ACES tonemapping + bloom — rejected: needs three's addons (dependency-risk, fill-rate cost on mid-range phones, restyles the whole game).

### D2 — Obstacle warning rings: one additive InstancedMesh (capacity = obstacle pool, 16)
A flat ring geometry, `AdditiveBlending`, `depthWrite: false`. Per-instance color lerps black→red with proximity — with additive blending, black adds nothing, so dark instance color *is* the fade; no per-instance opacity hack, 1 draw call. Proximity = `1 - (o.z - carZ)/warnDist`, clamped; instances beyond the distance park under the road (same trick zombie parts use). Computed inside `syncObstacleMeshes`, which already scans actives and receives `carZ`.
*Alternatives:* per-obstacle mesh with own material — 16 extra draw calls and material churn; shader-based road decal — complexity for no gain.

### D3 — Telegraph flash: one additive InstancedMesh (capacity = zombie pool, 24)
Flat red quad/ring at ground level under a telegraphing zombie, scale/alpha pulsing across the 0.35 s window using the pool's existing telegraph timer. Bound inside `updateZombieMeshes`, which already iterates every active slot and switches on state. 1 draw call, zero new allocation.
*Alternatives:* sprite per zombie (allocation), scaling the zombie itself (already used for crouch; doubling it reads as error, not signal).

### D4 — Car: tail lights + rear fill light + lifted body tone
Two `MeshBasicMaterial` red boxes on the rear face (mirroring the existing headlamp boxes at `z ≈ -2.24`) — unlit material means they glow regardless of lighting. Body `0xb3341f` → ~`0xc94b2e`. A dim second directional light from behind the car (~`0x664433`, intensity ~0.45, no shadows) lifts the camera-facing rear without moving the established sun.
*Alternatives:* flipping the sun position — rejected: changes every silhouette and the established look; PointLight on the car — per-fragment cost on phones for marginal gain.

### D5 — Zombie palette: retint the shared instance colors
Brighten `TORSO_TINT`/`HEAD_MAT`/`SKIN_MAT` (walker/runner pushed apart — runner toward yellow-green, walker stays mossy; head toward pale). Because tinting already flows through `instanceColor`, this is a constants-only change with no structural work. Brute keeps its dark red + 1.5× scale for silhouette identity.

### D6 — Kill event carries points + position
`GameEvents.kill` becomes `[type, viaScrape, points, worldX, worldZ]`. `registerKill` already receives `wx, wz` (it feeds the FX burst) and `Scoring.registerKill` already returns the awarded points — both are simply forwarded. Existing handlers (`(type, viaScrape)`) keep compiling; arity reduction is not a thing in TS callbacks. Used by popups; `viaScrape` kills can later style differently without new plumbing.

### D7 — Popups: preallocated DOM pool + pure projection helper
6 preallocated `<div class="score-popup">` nodes in the `#hud` root (pointer-events: none — click-through preserved), reused round-robin; re-trigger the existing rise/fade CSS animation via the class-restart idiom the streak badge already uses. Position from a pure `worldToScreen(x, y, z, camera, w, h)` helper in `src/ui/` (unit-testable with a stub camera). Points text: awarded points, plus `×N` when multiplier ≥2.

### D8 — Tilt gauge v2: rebuild inside the existing `.tilt-gauge` subtree
Grow the gauge (~120×64 px), keep the car silhouette, add: (a) severity classes `warn`/`critical` driven by `CONFIG.hud.warnAt` (0.5) / `critAt` (0.75) — CSS handles amber/red/flash; (b) 4+4 pip cells flanking the silhouette, filled from new `HudState.weights: { left, right }` (capacity units; `session.car.leftWeight/rightWeight` already hold exactly these units). All updates behind the established dirty-check pattern. Directional glow: two fixed screen-edge divs toggled by `(side, inCritical)` pairs — a binary state change per frame at most, CSS transition does the ramp.

### D9 — Level-up subtitle as a pure function
`unlocksForLevel(level)` in `difficulty.ts` returns types whose `unlockLevel === level` (level 2 → `["runner"]`, 3 → `["brute"]`). `hud.toast()` gains an optional subtitle; `main.ts`'s existing `levelUp` handler formats `RUNNERS UNLOCKED` (pluralized display names). Testable in node env, no DOM.

### D10 — Death card: tap-anywhere + type scale
Click handler on the over-menu root (bubbling from RETRY is harmless — both restart); hint line becomes "TAP OR PRESS SPACE TO RETRY". Stat values step up ~27 → ~34 px, cause line stays dominant. `RETRY` keeps `focus()` for the keyboard contract.

### D11 — Debug hook for browser verification
Add a minimal `window.__zh` hook (guarded, dev-only pattern already anticipated by `.plan.md`): `{ rendererInfo: () => renderer.info.render.calls, debugAddWeight(side, w), carZ: () => session.carZValue }`. The verification pass (draw budget, tilt visuals) needs it; ~10 lines in `main.ts`.

## Risks / Trade-offs

- [Brighter scene washes out the dusk mood] → Tunables in config; verification pass pins the mood check (warm horizon + fog band) alongside contrast checks; values tuned once against screenshots.
- [Additive rings z-fight or bloom over obstacles] → `depthWrite: false`, slight y offset above road (y ≈ 0.04), ring radius > obstacle footprint; verified in the browser pass.
- [Popups cause layout/paint jank on phones] → Preallocated pool, `transform`-only animation, dirty-checked updates; cap of 6 concurrent.
- [Extra directional light shifts zombie/car shading subtly] → Intentional (rear fill), intensity kept low; whole-scene screenshot diff in verification.
- [Kill event arity growth couples UI to session] → Payload is plain data; consumers destructure what they need; no behavior coupling.

## Migration Plan

Single deployable build (`bun run build`, base `./`). No persisted-state format changes (no new `zh.*` keys — the coach/best keys are untouched). Rollback = revert commit; nothing to migrate.

## Open Questions

None blocking. Exact hex values and distances are tunables to be settled against screenshots during the verification pass, which is why they land in `config.ts`.
