# Design

## Context

The whole client is one ES module, `client/js/game.js` (1,037 lines): config, Three.js scene,
materials, player, world gen, input, collision, HUD wiring, and game loop inline. All world
surfaces use `MeshLambertMaterial` solid colors; buildings spawn with 8 random saturated hues
and one `BoxGeometry` mesh per window; the player is a static box assembly with a sine-bounce
"run"; the sky is a two-color gradient shader; the DOM overlay is system-font HTML with emoji
icons and class-toggled screens. Three.js 0.172 with `three/addons/` already mapped in the
importmap; ACES tone mapping and PCF soft shadows (1024) are already on. See proposal.md for
motivation and the spec deltas for the behavior contracts.

## Goals / Non-Goals

**Goals:**
- A coherent, modern look: PBR shading, textured track bed, recognizable props, animated
  character, progressing atmosphere, polished overlay.
- Measurable performance headroom: capture a draw-call/FPS baseline before touching anything,
  verify against it after.
- Small, reviewable structure: visual systems extracted into modules so each tier lands as an
  inspectable diff.

**Non-Goals:**
- Gameplay changes (power-up behavior, combo/multiplier rules, difficulty) — separate changes.
- Audio, pause, leaderboard/achievements UI.
- GLTF/model assets, HDR environment files, or any new network origin — everything procedural
  or bundled.
- Post-processing passes (bloom/SSAO) — explicitly avoided for mobile fill-rate.

## Decisions

### D1: Extract visual systems into `client/js/visual/` modules; game.js stays the entry
`textures.js` (procedural CanvasTextures), `props.js` (train/barrier/gantry factories),
`character.js` (rigged player + pose states), `atmosphere.js` (day/night ramp, sky, clouds),
`ui-motion.js` (score tween, punch, flash, transitions). Game loop and gameplay logic stay in
`game.js`, importing from these.
*Why*: the overhaul touches every visual subsystem; six workstreams editing one file is where
regressions hide. *Alternative considered*: keep everything in `game.js` — rejected; the file
doubles in size and every diff becomes unreviewable.

### D2: `MeshStandardMaterial` + procedural `RoomEnvironment` IBL
Swap all Lambert materials to Standard with tuned roughness/metalness (matte ground ≈0.95,
train body ≈0.4 metallic 0.6, coins roughness 0.2 metal 1.0). Environment: `PMREMGenerator
.fromScene(new RoomEnvironment())` — fully procedural, no HDR download.
*Why*: the single biggest visual lever; RoomEnvironment costs one 256px render at boot.
*Alternatives*: HDR from CDN — rejected (new origin, load cost); keep Lambert — rejected (the
problem itself).

### D3: Baked facade textures replace per-window boxes
3–4 building "types" (brick, concrete, slate, sand), each a curated palette + a `CanvasTexture`
facade with the window grid baked in, plus a matching emissive map for lit windows at night.
Buildings share one geometry per type, scaled per instance. This deletes the worst draw-call
offender (one mesh per window) *and* the random-window noise.
*Why*: one texture swap fixes both looks and perf. *Alternative*: InstancedMesh windows —
rejected as strictly worse than not having window meshes at all.

### D4: Track bed as tiled CanvasTexture + real rail profile
One 512×512 ballast texture (procedural gravel noise) plus sleepers baked into a second tiled
ground strip under the rails; rails become slightly larger profiled boxes with a metallic
material so they catch highlights. Texture repeats along GROUND_LENGTH with `RepeatWrapping`.
*Why*: cheapest way to make the world read as "subway"; sleepers sell it instantly.
*Alternative*: real sleeper geometry — rejected (hundreds of meshes for no visible gain at
gameplay camera distance).

### D5: Props assembled from shared geometry; instancing is a contingency, not a default
Trains: `RoundedBoxGeometry` body + window-band box + door outlines + cylinder bogies,
assembled once per livery (2–3), cloned per spawn. Barriers: box with striped hazard
CanvasTexture. Overheads: truss-style gantry from thin boxes. Coins keep individual meshes but
share one geometry+material (≈30 alive ≈ 30 draw calls — acceptable).
*Why*: baseline measurement first; if the 1.5× draw-call budget holds without InstancedMesh,
skip the refactor risk. Instancing coins/buildings remains the documented fallback if
measurement says otherwise.

### D6: Procedural character rig with a 4-state pose mixer
Limbs become pivot-grouped boxes (shoulder/hip rotations), driven by a tiny pose mixer with
states: `run` (sin-driven limb swing, phase from distance), `jump` (tuck), `roll` (compact +
X-axis tumble), plus lateral lean (rotation.z lerp toward lane-change velocity). Landing dust:
pool of ~8 fading sprites at the feet.
*Why*: no asset pipeline exists; procedural keeps zero-load-cost and full art direction.
*Alternative*: download a GLTF character — rejected (CDN origin, load time, licensing).

### D7: Atmosphere as a pure function of distance
One `t` value = f(distance) (ramp: 0–1.5km day→sunset, 1.5–3km sunset→night, hold night;
tunable constant), driving: sky shader's three-stop color mix, fog color = sky bottom color,
key light intensity/color (warm at sunset, dim blue at night), facade `emissiveIntensity`
(night), and hemi light. Deterministic per the spec. Clouds: ~8 billboard planes with a soft
radial-gradient CanvasTexture, recycled ahead of the camera like buildings.
*Why*: one scalar orchestrates the whole mood shift; trivially testable.
*Alternative*: random weather — rejected (spec requires deterministic).

### D8: No post-processing; DOM handles vignette and flashes
Vignette, damage flash, and screen transitions are fixed-position DOM layers with CSS
transitions. Camera FOV lerps 65 → ~75 as speed ramps; landing kick is a small spring on
camera height.
*Why*: zero GPU cost, zero mobile risk; ACES + emissive materials already fake bloom
credibly. *Alternative*: EffectComposer + UnrealBloomPass — rejected (fill-rate on mobile for
marginal gain).

### D9: UI presentation via bundled font + small motion helpers
Display font: one OFL-licensed chunky woff2 (Bungee or similar, ~20–40KB subset) bundled in
`client/fonts/`, `font-display: swap`, added to the service-worker cache list; fallback stack
stays. Coin icon: inline SVG. Score: rAF tween of displayed value toward actual (~300ms).
Combo punch: CSS class re-trigger. Screen transitions: opacity/transform transition classes
replace instant `.hidden` toggles (transition ≤ 400ms).
*Alternative*: Google Fonts link — rejected (new origin, breaks offline requirement).

## Risks / Trade-offs

- [Night facades + emissive ramp blow out contrast or look flat] → cap emissiveIntensity,
  verify day/sunset/night screenshots at each checkpoint before proceeding.
- [Coin instancing deferred might exceed draw-call budget on low-end] → baseline captured in
  task 1 makes the breach observable; D5 documents the fallback.
- [Bundled font missing from SW cache breaks offline polish] → add font to SW cache list and
  include offline font check in verification.
- [Character rig jank (limb pop, roll clipping) reads worse than the bounce it replaces] →
  pose transitions lerp over ~100ms; checkpoint screenshots/video at each state.
- [Facade texture tiling visible on long buildings] → per-type texture variants + random UV
  offset per instance.

## Migration Plan

Client-only change; no server, db, or API edits. Land in tiers (materials → track → props →
character → atmosphere → UI), each tier a working, screenshot-verified checkpoint — the game
stays playable after every tier. Rollback is `git revert` per tier. Capture the draw-call/FPS
baseline *before* tier 1 lands.

## Open Questions

- Exact display typeface pick (any OFL chunky face satisfies the spec; Bungee is the default
  candidate) — decide at implementation, keep as a swappable asset.
- Night hold vs. day/night cycle after 3km — default holds at night (spec only requires the
  deterministic ramp); tunable constant if playtesting prefers a loop.
