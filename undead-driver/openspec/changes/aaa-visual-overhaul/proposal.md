# Proposal

## Why

Undead Highway plays well but looks like a prototype: flat Lambert boxes, no shadows, no post-processing, no textures, and a HUD built from default-styled DOM. The game's logic, pooling, and fixed-step sim are solid and spec-pinned — visual fidelity is now the single biggest gap between this game and a modern AAA release. The player explicitly wants the game raised to AAA quality: "utterly perfect, visually beautiful, every single thing at AAA quality from textures to physics."

## What Changes

- **Lighting pipeline**: ACES filmic tonemapping, correct color-space management, a shadow-casting key light, image-based environment lighting, real headlight beams, and lamp cones with visible light shafts.
- **Procedural PBR materials**: runtime-generated (canvas) albedo/normal/roughness maps for asphalt, car paint with clearcoat and damage states, zombie skin, guardrails, and props — still zero binary asset files.
- **World art direction**: layered dusk sky with sun disc and god-ray mood, multi-depth skyline, dense roadside set dressing (wrecks, debris, fences, vegetation, destroyed props), wet-road reflections, upgraded fog/atmosphere.
- **Characters**: rebuilt car (body shells, glass, wheel wells, steering wheels, brake/glass detail, progressive damage) and rebuilt zombies (articulated limb rigs, per-type silhouettes, gore and dismemberment on kill, cloth/limb secondary motion).
- **VFX & post**: a post-processing stack (bloom, vignette, chromatic aberration, film grain, subtle depth-of-field mood), pooled particle systems (blood, smoke, sparks, dust, muzzle flash, explosions), ground decals, and physical-feel camera work (shake, hit-stop, recoil).
- **UI to AAA grade**: cinematic title screen and game-over flow, redesigned HUD (iconography, animated meters, hit markers, damage direction indicators, kill-cam moments), motion design on every transition.
- **Process**: implementation is fan-out across parallel sub-agent workstreams (one per capability), each looped against a deliberately harsh independent visual critic that runs blind side-by-side comparisons against AAA reference stills and rejects anything that does not clearly win or tie; loops continue until the critic is wowed on every workstream.
- Performance contract is restated and re-pinned for the new bar (see `render/quality-gate`): 60 fps target, new draw-call ceiling, zero steady-state allocation preserved, pooling preserved.

Not changed: gameplay logic (combat, difficulty, scoring, spawner, car physics model), controls, tests' pinned behaviors, the deps allowlist (`three` only — post-processing comes from `three/examples/jsm` shipped in the same package).

## Capabilities

### New Capabilities

- `render/lighting`: physically-credible lighting — tonemapping/color pipeline, shadowed sun, environment lighting, headlight/lamp beams.
- `render/materials`: procedural PBR materials and runtime-generated texture maps for every surface; no binary assets.
- `render/world`: environment art direction — sky, skyline, roadside set dressing, atmosphere, ground detail.
- `render/vfx`: particle systems, decals, post-processing stack, and camera feel (shake/hit-stop).
- `render/characters`: car and zombie visual fidelity — models, materials, damage states, animation polish, gore.
- `ui/hud`: AAA-grade HUD, menus, coach, and motion design (extends the in-flight `ui/hud` capability from `readability-hud-pass` with visual-fidelity requirements).
- `render/quality-gate`: the acceptance bar — blind side-by-side critic comparisons, per-workstream loop-until-wow process, and the re-pinned performance budget.

### Modified Capabilities

(none — `openspec/specs/` is empty; the in-flight `readability-hud-pass` change owns `render/readability` and `ui/hud` readability requirements, which this change extends rather than rewrites)

## Impact

- **Code**: `src/render/**` (largest — scene, world, carMesh, zombieMesh, fx, cameraRig), `src/ui/**` (hud, menus, coach, popups), `src/style.css`, `index.html`, `src/config.ts` (all new tunables), `src/main.ts` (composer render path), and a new `src/render/textures.ts` (procedural texture factory) + `src/render/postfx.ts`.
- **Contracts**: `.plan.md` "Visual spec (exact)" color/light values are superseded; draw-call budget moves from ≤120 to the new ceiling pinned in `render/quality-gate`; "all visuals are three.js primitives" is relaxed to "all visuals are procedurally generated in-code" (canvas-generated textures allowed, binary asset files still forbidden).
- **Dependencies**: none added. Post-processing uses `three/examples/jsm` (same `three` package). No fonts, images, audio files, or physics libraries — visible "physics" (impacts, ragdoll-ish death, debris) is delivered through animation and VFX, not a physics engine.
- **Invariants preserved**: fixed-step sim, pooling/zero steady-state allocation, `game/` stays three.js-free, `config.ts` holds every tunable, storage keys unchanged, `game/` pure-logic tests keep passing.
- **Verification**: render/UI changes need live browser evidence (headless Chromium over CDP, per AGENTS.md) plus the `render/quality-gate` critic loop; pure-logic suite and typecheck must stay green.
