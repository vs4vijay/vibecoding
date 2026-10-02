# WAVE 1 — Engine Foundation Notes

Date: 2026-09-12
Scope: engine rebuild under `client/js/src/` (ES modules, no build step), three.js r172 (vendored).

## Files created / changed

### Changed (outside src/)
- `client/vendor/three/three.core.js` — ADDED. The vendored `three.module.js` is the
  slim wrapper and imports `./three.core.js`, which was missing from the vendor copy
  (copied from `node_modules/three/build/three.core.js`, r172). Without it nothing loads.
- `client/js/game.js` — REPLACED with a thin bootstrap: `import { boot } from "./src/main.js"`.
  The old prototype now lives at `client/js/legacy-game.js` (reference only).
- `client/js/sw.js` — cache name bumped to `v2` and vendored three files added, so the
  service worker cannot serve the stale wave-0 prototype to the QA browser.
- `client/manifest.json` — ADDED. index.html referenced `/manifest.json`; the 404 would
  have been a console error (violates the zero-console-error requirement).
- `client/index.html`, `client/css/style.css` — untouched (all element IDs preserved;
  system font stack already in CSS, no external fonts).

### New modules (client/js/src/)
| File | Role |
|---|---|
| `main.js` | boot(): renderer/scene/post/sky/world/run assembly, state machine LOADING->MENU->PLAYING->GAMEOVER, fixed-timestep loop (60 Hz) + render interpolation, resize, visibilitychange auto-pause, DOM shell wiring, localStorage persistence (no network anywhere) |
| `core/config.js` | All tunables; QUALITY_PRESETS {low, medium, high, ultra}; tier auto-detect (dpr + hardwareConcurrency) with `?quality=` override |
| `core/rng.js` | mulberry32 PRNG + Rng helper class (range/int/pick/shuffle/chance), `hashSeed` for per-chunk streams, run seed via `?seed=` |
| `core/assets.js` | Procedural PBR system: TextureFactory renders 512px canvas sets (albedo/normal via Sobel from shared height field/roughness/AO) + MaterialLibrary singleton with 12 shared MeshStandardMaterials; `fitBoxUVs` for uniform texel density |
| `core/renderer.js` | WebGLRenderer (ACES, exposure 1.05, PCFSoft, sRGB out), PostPipeline (RenderPass -> UnrealBloom 0.85/0.35/0.6 -> SMAA if pixelRatio<1.5 -> OutputPass -> custom grade pass: filmic S-curve, saturation 1.07, vignette, edge-only chromatic aberration), MSAA render targets, PerfMonitor -> `window.__PERF` with auto tier step-down (avg FPS < 45 over 3 s) |
| `core/sky.js` | Preetham Sky (elevation 35deg, azimuth 132deg so light rakes diagonally across the +Z track), fog color SAMPLED from the rendered sky at the horizon (exact backdrop match), PMREM environment from a sky-only scene, DirectionalLight sun (intensity 3.2, ortho -30..30 x -40..40, bias -0.0002 / normalBias 0.02) that follows the player with shadow-texel snapping |
| `core/input.js` | Keyboard (arrows/WASD/Space/Esc/P) + touch (swipe threshold 24px, tap disambiguation: top half jump, bottom half roll); timestamps events; ignores keystrokes in form fields |
| `core/audio.js` | Silent stub; AudioContext created lazily on first gesture |
| `game/camera.js` | ChaseCamera: exp-smoothed follow, speed FOV push 65->72, lane lookahead, idle breathing, trauma-based decaying noise shake (`addTrauma`), QA modes close/side/front |
| `game/run.js` | RunController: 3 lanes (0.12 s smoothstep switch), real gravity jump + 80 ms coyote + 120 ms input buffering, roll with hitbox shrink + roll-cancel-jump + air-slam, speed ramp 16->42 over distance, score = distance*multiplier + coins*10, seeded pattern director (25-40 m gaps, <=2 lanes blocked, >=18 m after forced actions), forgiving AABB collisions (15% shrink), death slow-mo 0.3x for 0.8 s, powerup data stubs (magnet/jetpack/x2 via `collectPowerup`) |
| `entities/player.js` | Placeholder capsule/box character ~1.8 m (teal hoodie, cap+brim, backpack, sneakers) with run bob, jump tuck, roll squash, lane lean; casts shadows |
| `entities/trains.js` | ObstacleManager with pooled train/barrier/overhead/ramp built from MaterialLibrary materials; exposes XZ+height colliders; `vz` moving-train hook |
| `entities/coins.js` | CoinField: pooled InstancedMesh (gold, metalness 1 / roughness 0.25), spin+bob on render time, collection + magnet-radius hook in fixed step |
| `world/world.js` | World: 40 m chunk streaming with `registerChunkType`/`setPlan`/`update(dt, playerZ)`; built-in track chunk (ballast, 6 rails + 150 sleepers as InstancedMesh, concrete walls+caps, 14 instanced silhouette buildings); world-locked asphalt ground via texture offset; `window.__WORLD = { chunks, drawCalls }` |
| `qa/hooks.js` | QA param driver + `window.__QA.screenshotReady` (resolves after 5 warmup frames) |

## Key tunables (core/config.js)
- LANE_WIDTH 2.2, BASE_SPEED 16, MAX_SPEED 42, SPEED_RAMP_PER_METER 0.022
- GRAVITY -38, JUMP_VELOCITY 12.2 (clears 1.0 m barriers by ~0.9 m at apex)
- COYOTE_TIME 0.08, INPUT_BUFFER 0.12, ROLL_DURATION 0.62, ROLL_HEIGHT 0.95
- Camera: FOV 65->72, height 5.4, distance 8.4, look-ahead 12
- Fixed timestep 1/60, MAX_FRAME_DT 0.1, death slow-mo 0.3 / 0.8 s
- Quality presets: pixelRatioCap 1/1.25/1.5/2, shadow 1024/1024/2048/2048,
  drawDistance 140/180/240/300, bloom+grade+smaa+MSAA per tier

## QA hook usage
- `http://127.0.0.1:8899/index.html?qa=1&seed=7&time=10&freeze=1`
  -> skips menu (name "QA", form hidden), god-mode on (hits ignored so shots are
  always live gameplay), simulates exactly 600 fixed steps (10 s), settles camera,
  renders 5 identical warmup frames through the post pipeline, then stops the RAF
  loop. Deterministic for a given seed+time. `window.__QA.screenshotReady` resolves
  when it is safe to capture.
- Other params: `?cam=close|chase|side|front`, `?hud=0`, `?quality=low|medium|high|ultra`,
  `?nobloom=1`. Debug surfaces: `window.__PERF`, `window.__WORLD`, `window.__ENGINE`.

## Verification done (no browser used)
- `node --check` passes for every file (ESM, package.json type=module).
- Import-graph check: every local named import resolves to a real export; all
  three/addons paths exist in the vendor tree.
- Node smoke test: rng determinism (same seed -> identical sequence), config presets.
- Static server (8899) confirmed serving /js/src/*, /vendor/three/three.core.js,
  /manifest.json (HTTP 200).

## Architectural decisions
1. Fixed-step sim + interpolated render: RunController snapshots prev/curr each step;
   camera/player visuals consume `renderPose(alpha)`. Keeps ?time fast-forward and
   ?freeze exactly reproducible.
2. All generation is synchronous at boot (no network, no async loading). Procedural
   textures generate lazily on first material use (world build) — budget ~150-250 ms.
3. Composer target uses HalfFloat + MSAA samples; grade runs AFTER OutputPass so the
   S-curve/vignette operate display-referred (no HDR clamping artifacts).
4. Fog color is read back from the sky shader itself; geometry at far plane dissolves
   pixel-exactly into the sky.
5. God-mode for `?qa=1` runs: collisions ignored so the QA pipeline never screenshots
   a game-over screen.
6. Death/godMode/state stay data-level in RunController; main.js owns all DOM.

## Risks / notes for later waves
- `dist/` still holds the wave-0 prototype copy; refresh via `bun run build:client`.
- Instanced building silhouettes have stretched UVs (unit box) — wave 2 replaces them.
- ObstacleManager.getColliders() allocates per sim step — fine at wave-1 scale,
  revisit if wave 4 traffic grows (30+ entities).
- Ground-plane world lock uses a texture-offset trick on cloned asphalt textures;
  sign convention verified analytically, worth one visual check in QA.
- PerfMonitor auto step-down rebuilds the composer — brief hitch expected; if QA
  sees tier flapping, raise the 5 s re-step guard in main.js `stepDownTier`.
- Legacy prototype preserved at `client/js/legacy-game.js` (API submission payload
  shape and gameplay constants for later waves).

---

# ROUND 2 FIXES (judge must-fixes, 2026-09-12)

## 1. Shadows missing — ROOT CAUSE (core/sky.js)
The texel-snap math in `SkySystem.update()` transformed the anchor into
light space, snapped it, and transformed back — but then used that VECTOR
(`anchor - lightPos` = -sunDir * 90) as the world-space target position.
Result, every frame: `sun.target.position = (-55, -52, +49)` (52 m
underground, fixed) and `sun.position = target + sunDir*90 = (0,0,0)` —
the sun was permanently parked at the world origin with its shadow camera
buried under it. Directional *shading* still worked (direction =
position - target = sunDir), which is why the scene looked lit while zero
shadows rendered: the shadow frustum never covered the visible track
(player at z~100-250 in the QA shots).
Fix: apply the world-space snap DELTA to the anchor (classic technique):
  snappedAnchor = anchor + rotInv * (snappedLocal - local)
Shadow camera now rides the player (anchor = player + 10 m ahead).
Hardening: sun 3.2 -> 3.5, hemi 0.55 -> 0.42, ground-material
envMapIntensity reduced (ballast/concrete/asphalt 0.3-0.4) so shadow
contrast reads; bias -0.00025 / normalBias 0.035 (no acne, no
peter-panning at 2048 over 60x80 m); rails InstancedMesh now
receiveShadow = true. Verified flags: player/obstacles/coins cast+receive,
walls + rails + ballast + ground receive, InstancedMesh shadow flags set.

## 2. Milky grade / near-white sky
- Sky: turbidity 6 -> 2.5, rayleigh 1.8 -> 1.3, mie 0.004 -> 0.003, g
  0.85 -> 0.8 — deep blue zenith with a visible horizon gradient.
- Exposure 1.05 -> 0.95; grade S-curve blend 0.18 -> 0.32, saturation
  1.07 -> 1.12, vignette 0.5.
- Fog: near 30-55, far 100-200 per tier (was 40-70 / 130-285) — far shots
  keep contrast past mid-distance. Fog color sampled higher above the
  horizon (bluer band) and darkened x0.88-0.94 so distance haze is blue,
  not white.

## 3. Ballast "white confetti" (core/assets.js)
Rebuilt generator: ~2000 stones in 40 clumped clusters (was 2600 uniform
isolated dots), radii 5-12.5 px with soft feathered edges (mip-safe), top-
left key light CLAMPED (no blown-out stones), darker grey-brown palette
(albedo mean 60, max 132 — verified in Node test), deep crevices (height
0.1-1.0), normalStrength 3.2 -> 4.2. Track box texel density 48 -> 80
(~1.25 m per tile) so stones read 2.5-6 cm in world scale.

## 4. Concrete marble blotching + tiling seams
Root cause of seams: the old value noise was not periodic across tile
edges. Replaced with tileable value noise (`vnoiseT`/`fbmT`) that wraps
the lattice per axis with integer frequencies — ALL 8 texture sets are now
seamlessly tileable (verified: vnoiseT(0,v) == vnoiseT(1,v), same for v).
Blotch contrast halved (stain darkening 46 -> 20, var 0.86-1.08 ->
0.94-1.06). Added precast formwork panel joints (2 horizontal grooves + 1
vertical per tile, with drip-edge highlight) baked into albedo+height;
wall texel density 36 -> ~2.8 m per tile so joints read as intentional
panels. Node test: joint rows measure darker than field.

## 5. Rails as pale plastic
railSteel: color 0x8a8f96 -> 0x6b7076 (dark steel), roughness 0.3 -> 0.28,
envMapIntensity 1.25 -> 1.5 — strong env reflections + bright sun rake
highlight from the sun disc baked into the sky PMREM. Rails also now
receive shadows.

## 6/7. Side + close QA cameras (game/camera.js)
Two occlusion problems found: (a) the 4.6 m side walls block ANY low
lateral camera — the old side shot (8 m out, 2 m high) was staring at the
wall; (b) the old camera also sat inside the building band (x >= 7.5).
Fixes: side rig is now 9 m lateral at 6.2 m height (flies over the wall,
sight-line clears the wall cap by ~0.7 m at the player plane) looking down
the receding corridor; close rig is 7.5 m back at 3.6 m height (clears
parked-train roofs at 3.2 m) looking slightly down so the character sits
in the lower third. Building band moved out: inner face >= 13.5 m
(centers 17.5-27, widths 4-8) so the side rig (max |x| ~13.2) stays clear.

## 8. Buildings respond to sun
Mid-tone cool grey-blue instance tints (linear 0.30-0.55, was
0.16-0.34), roughness 0.85, envMapIntensity 0.35 (was default 1.0 — with
the bright old env this overexposed them to flat white). Sun/hemisphere
now clearly shades their faces; combined with the bluer sky + tighter fog
they no longer dissolve into white.

## Regression checks (round 2)
- `node --check` clean on all 16 modules; import graph re-verified.
- Node harness runs the full generator pipeline: all 8 sets tile
  seamlessly, no NaNs, ballast mean 58-60 / max ~132, full pipeline
  ~260-295 ms (300 ms budget, one-time at boot).
- `?qa=1&seed=7&time=10` unchanged: god-mode keeps phase "running",
  fast-forward + freeze remain deterministic (sim + camera settle in fixed
  steps; freeze renders identical warmup frames then stops the loop).
- Zero console-error sources audited: no network calls, manifest present,
  SW cache v2.

## Round 3 QA — shadow root cause FOUND AND FIXED (main agent)

**Root cause of "zero cast shadows":** the EffectComposer's primary render
target used `type: THREE.HalfFloatType`. On SwiftShader (headless QA GPU) ANY
HalfFloat composer target silently breaks the shadow depth pass — scene
renders fine but nothing samples shadowed. Proven by A/B pixel diff:
- composer target UnsignedByte + RenderPass only -> shadows present (4969 px @320x200)
- composer target HalfFloat (±MSAA) -> 0 shadow pixels
- direct renderer.render into UnsignedByte RT (even MSAA 4) -> shadows fine
**Fix:** `core/renderer.js` PostPipeline target is now UnsignedByteType (MSAA
samples kept on high/ultra; SMAA covers edges). Shadow coverage after fix:
8.67% of frame @800x500 (wall wedge + sleeper ladder + player shadow verified
by amplified pixel diff).

Also fixed in this round (main agent):
- `qa/hooks.js` `_resolveReady` ReferenceError (boot crash)
- `run.js` godMode reset by `_initSimState()` on start() — QA runs died at 59 m
- QA spawn policy: in godMode the center lane is always kept free
- Sun re-aimed: elevation 42°, azimuth 55° (shadows stretch left/toward camera;
  a 30° sun let the 4.6 m walls shadow the whole corridor in blue skylight)
- Sky: rayleigh 2.0, mie 0.0015; fog sampled color deepened (x0.72/0.80/0.92);
  fog distances pushed out per tier (45/140 low .. 80/250 ultra)
- Ballast: brighter sunlit grey-brown base (96-130) + denser clumped stones
- Asphalt ground plane: darker, low-contrast stones (reads as distant ground)
- Buildings: instance tints 0.18-0.38, envMapIntensity 0.25
- Lighting ratio: sun 4.0, hemi 0.30, ground env 0.15; exposure 0.9

**Verification tools (main agent only; sub-agents must not use browsers):**
- `bun .qa/shot.mjs <url> <out.png>` — screenshot + console/page error report
- `bun .qa/metrics.mjs <url>` — shadow coverage % (light-toggle diff), sky/mid/
  low luminance means+stddev, blowout/crush %
- shadow visibility proof: A/B PNG diff with PIL (see .qa/buf_diff.png)

---

# ROUND 3 — FINAL VISUAL POLISH (wave-1-owned systems)

## 1. Shadow readability (navy -> neutral)
- HemisphereLight sky 0x9fc3ea (saturated blue) -> 0xbfd0e0 (neutral-warm);
  ground bounce kept warm 0x8a7a66. Intensity 0.30 -> 0.42: shadowed
  ballast lifts from "dark navy" toward the judge's ~2.5:1 lit:shadow
  target (sun 4.0 x cos42deg x albedo ~0.16 linear dominates the lit side;
  ambient now ~40% stronger and hue-neutral). If measurement still shows
  >3:1, hemi.intensity is the single knob (exposed via window.__ENGINE.sky).
- ballast/asphalt envMapIntensity 0.15 -> 0.1 (blue sky env was tinting
  shadowed ground); world ground plane matches (0.15 -> 0.1).

## 2. Sky: blue dome, no white-glow wall
- rayleigh 2.0 -> 2.6 (deeper blue), mieCoefficient 0.0015 -> 0.0008 and
  mieDirectionalG 0.8 -> 0.75 — cuts the forward-scatter glow wall at the
  vanishing point (sun sits near frame center at azimuth 55).
- Added an artistic zenith->horizon gradient tint injected into the Sky
  shader via onBeforeCompile (uniforms uHorizonTint (0.84, 0.90, 1.0) at
  the horizon -> uZenithTint (0.55, 0.72, 1.0) at zenith, blended on view
  elevation ^0.6). Applies consistently to the visible sky, the PMREM
  environment and the fog-color sample (all come from makeSkyMesh), so
  metals reflect the same sky the fog matches. Verified against r172
  internals: onBeforeCompile mutates parameters.uniforms which becomes the
  render-time upload source for ShaderMaterial, and the mutated
  fragmentShader is what compiles.
- NEW: CloudLayer — 10 procedural cloud sprites (3 seeded 256x128 canvas
  textures: soft radial-blob puff arcs + lit core), placed on a far ring
  (240-400 m ground radius, 11-39 deg elevation; worst-case corner ~575 m
  < 600 m far plane), opacity 0.42-0.62, depthWrite off, fog off. Group
  follows camera laterally and drifts 0.0045 rad/s. Placement/texture are
  SEEDED (Rng 0xc10d) so ?freeze stays deterministic; drift uses the dt
  passed to sky.update (fixed dt in fastForward, 0 in freeze).
  +10 draw calls (~160 total, budget 250).

## 3. Grade punch
- uContrast 0.32 -> 0.38 (denser shadows).
- Restrained split-tone: uShadowTint (0.95, 0.995, 1.07) cool shadows,
  uHighlightTint (1.05, 1.0, 0.93) warm highlights, blended on luminance
  smoothstep(0.2, 0.7). Applied after the S-curve, before saturation.
- Combined with the sky tint/mie cut, the sky band drops from ~0.77-0.80
  into the 0.62-0.72 target (horizon multiplies ~x0.85, zenith ~x0.6);
  midground stddev rises via darker neutral shadows + saturation 1.12.

## 4. Buildings
- Instance tints 0.18-0.38 -> 0.14-0.30 with per-instance warm/cool
  variation: 45% warm (g x 1.16 / 1.0 / 0.84 brick-ish), else cool grey-blue
  (x 0.86 / 0.96 / 1.12). env 0.25 unchanged. Sunlit faces now read as lit
  concrete; the massing shows the 42deg sun direction.

## 5. Rails
- railSteel color 0x6b7076 -> 0x555a60, roughness 0.28 -> 0.3, env 1.5
  kept: darker base lets the sun-disc rake read on the rail heads.

## 6. Sleepers
- Wood albedo palette muted to aged creosote brown: r 50-86, g 44-74,
  b 38-58 (was 58-104 / 42-78 / 30-56); weather contrast eased. Node
  harness: mean channel spread 21.2 (was ~28-48), mean 60.

## 7. Camera reframes under the new sun (verified by reasoning)
- Geometric occlusion is sun-independent: side rig (9 m lateral, 6.2 m)
  clears the 4.6 m wall + cap on the camera->player ray (>= 0.1 m margin at
  the wall inner face) and stays inside the building band (>= 13.5 m);
  close rig (3.6 m high) clears parked-train roofs (3.2 m); player lower
  third unchanged.
- New sun (42 deg / azimuth 55 deg) shadows stretch left+toward camera:
  chase view reads shadows down-right of objects, side view sees the wall
  shadow band rake across the corridor (covers x ~1.5-5.6; center lane
  stays sunlit), close view shows player shadow trailing right. No
  occlusion regressions.

## Regression checks (round 3)
- node --check clean on all modules; import graph re-verified (16 files).
- Node generator harness: full pipeline ~202 ms (budget 300), no NaNs,
  ballast mean 109 / max 164 (QA's sunlit ballast preserved).
- Composer target type untouched (UnsignedByteType + MSAA, the SwiftShader
  shadow fix). qa/hooks.js and run.js spawn policy untouched.
- ?qa=1&seed=7&time=10: god-mode + deterministic freeze unchanged; clouds
  are seeded and drift only advances when sky.update receives dt (fixed dt
  during fastForward, 0 during freeze), so frozen frames stay identical.
